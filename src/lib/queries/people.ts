import { supabase } from '../supabase';
import type {
  Person,
  ContactRelationship,
  CreatePersonInput,
} from '../../types/person';

// ─── Email identity matching ──────────────────────────────────────────────────

/**
 * Finds the person whose email equals `email` under the database identity rule
 * normalize_identity_email() = lower(trim(email)).
 *
 * This is an exact comparison performed in the database (RPC find_person_by_email, migration 037). It
 * deliberately does NOT use .ilike(): LIKE/ILIKE treat `_` and `%` as wildcards (and PostgREST also maps `*`),
 * so "john_smith@x.org" would match "johnXsmith@x.org" and silently merge two different people.
 */
export async function findPersonIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_person_by_email', { p_email: email });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// ─── Person creation ──────────────────────────────────────────────────────────

/**
 * Creates a minimal people record.
 * Callers are responsible for duplicate-checking before calling this.
 */
export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const { data, error } = await supabase
    .from('people')
    .insert({
      full_name: input.fullName.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    })
    .select('id, full_name, email, phone, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return mapPerson(data);
}

/**
 * Resolves the person a new contact belongs to. contacts.person_id is NOT NULL, so every contact needs one.
 * Returns the existing person with the same confirmed email, or creates a new person record.
 * Phone-only matches are ambiguous and are refused for staff review, never merged.
 */
export async function resolvePersonId(input: {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}): Promise<string> {
  // Duplicate guard: a confirmed email may identify the same person. Phone-only
  // matches are ambiguous and must be resolved by explicit staff review.
  let personId: string | null = null;
  if (input.email) {
    personId = await findPersonIdByEmail(input.email);
  }

  // Create person if not found
  if (!personId) {
    try {
      const person = await createPerson({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
      });
      personId = person.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/duplicate key|violates unique/i.test(msg)) {
        if (input.email && /email/i.test(msg)) {
          // Concurrent insert race: another request just created this person —
          // retry the lookup so both callers share the same person record.
          const retried = await findPersonIdByEmail(input.email);
          if (retried) {
            personId = retried;
          } else {
            throw err;
          }
        } else if (/phone/i.test(msg)) {
          throw new Error(
            'ambiguous-phone: a person with this phone number already exists and requires staff review before a new record can be created'
          );
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  if (!personId) throw new Error('Person could not be resolved for this contact.');
  return personId;
}

/**
 * Creates a person + contact relationship in a single logical operation.
 * This is the entry point for the "Log new contact" workflow.
 * Enforces ONE HUMAN = ONE PERSON RECORD by returning an existing person
 * when a matching email is found rather than creating a duplicate.
 */
export async function createContactPerson(input: {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  cellId: string;
  loggedBy: string;
  tag?: string | null;
  notes?: string | null;
  dateContacted?: string;
  idempotencyKey?: string;
}): Promise<{ person: Person; contact: ContactRelationship }> {
  const personId = await resolvePersonId({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
  });

  // Fetch the person row (either found or freshly created)
  const { data: personRow, error: personErr } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('id', personId)
    .single();
  if (personErr || !personRow) throw new Error(personErr?.message ?? 'Person not found after create');

  // Create contact relationship
  const { data: contactRow, error: contactErr } = await supabase
    .from('contacts')
    .insert({
      person_id: personId,
      contact_name: input.fullName.trim(),
      contact_phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      cell_id: input.cellId,
      logged_by: input.loggedBy,
      tag: input.tag ?? null,
      notes: input.notes ?? null,
      date_contacted: input.dateContacted ?? new Date().toISOString().split('T')[0],
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select(
      'id, person_id, cell_id, tag, follow_up_status, follow_up_assignee, ' +
      'date_contacted, notes, logged_by, archived, is_member, member_id'
    )
    .single();

  // A6b: On a unique-constraint violation (PostgreSQL code 23505), recover by
  // returning the existing contacts row rather than surfacing a raw DB error.
  // We check both the PG error code and a message regex so the guard is robust
  // regardless of how Supabase/PostgREST serialises the error.
  if (contactErr) {
    const isConstraintViolation =
      (contactErr as { code?: string }).code === '23505' ||
      /duplicate key|unique/i.test(contactErr.message ?? '');

    if (isConstraintViolation) {
      const selectFields =
        'id, person_id, cell_id, tag, follow_up_status, follow_up_assignee, ' +
        'date_contacted, notes, logged_by, archived, is_member, member_id';

      // Primary recovery: idempotency key (covers same-key concurrent submits).
      if (input.idempotencyKey) {
        const { data: existingContact, error: existingErr } = await supabase
          .from('contacts')
          .select(selectFields)
          .eq('logged_by', input.loggedBy)
          .eq('idempotency_key', input.idempotencyKey)
          .maybeSingle();
        if (existingErr) throw new Error(existingErr.message);
        if (existingContact) {
          return {
            person: mapPerson(personRow as unknown as Record<string, unknown>),
            contact: mapContact(existingContact as unknown as Record<string, unknown>),
          };
        }
      }

      // Fallback recovery: same person + logger + date (no idempotency key supplied).
      const dateContacted =
        input.dateContacted ?? new Date().toISOString().split('T')[0];
      const { data: existingByPerson, error: personLookupErr } = await supabase
        .from('contacts')
        .select(selectFields)
        .eq('person_id', personId)
        .eq('logged_by', input.loggedBy)
        .eq('date_contacted', dateContacted)
        .maybeSingle();
      if (personLookupErr) throw new Error(personLookupErr.message);
      if (existingByPerson) {
        return {
          person: mapPerson(personRow as unknown as Record<string, unknown>),
          contact: mapContact(existingByPerson as unknown as Record<string, unknown>),
        };
      }
    }

    throw new Error(contactErr.message ?? 'Contact insert failed');
  }

  if (!contactRow) throw new Error('Contact insert failed');

  return {
    person: mapPerson(personRow as unknown as Record<string, unknown>),
    contact: mapContact(contactRow as unknown as Record<string, unknown>),
  };
}

// ─── Person lookup ────────────────────────────────────────────────────────────

export async function findPersonByEmail(email: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('email', email.trim())
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

export async function findPersonByPhone(phone: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('phone', phone.trim())
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

export async function findPersonById(id: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapPerson(row: Record<string, unknown>): Person {
  return {
    id: row['id'] as string,
    fullName: row['full_name'] as string,
    email: (row['email'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function mapContact(row: Record<string, unknown>): ContactRelationship {
  return {
    id: row['id'] as string,
    personId: row['person_id'] as string,
    cellId: (row['cell_id'] as string | null) ?? null,
    tag: (row['tag'] as string | null) ?? null,
    followUpStatus: (row['follow_up_status'] as string | null) ?? null,
    followUpAssignee: (row['follow_up_assignee'] as string | null) ?? null,
    dateContacted: row['date_contacted'] as string,
    notes: (row['notes'] as string | null) ?? null,
    loggedBy: row['logged_by'] as string,
    archived: (row['archived'] as boolean) ?? false,
    isMember: (row['is_member'] as boolean) ?? false,
    memberId: (row['member_id'] as string | null) ?? null,
  };
}
