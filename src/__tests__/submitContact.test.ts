/**
 * Client contract for contact writes after F2 (migrations 097 and 098).
 *
 * These are unit tests against a mocked Supabase client. They prove what the client SENDS and how it MAPS responses.
 * They do not prove what the database accepts or refuses. That is covered by
 * supabase/verification/authz_f2_submit_contact_test.sql, and the HTTP/JWT behaviour is covered by the real-stack
 * integration test, which is not runnable in this environment.
 */
import { createContact, updateContact, bulkImportContacts } from '../lib/queries/contacts';
import {
  getClaimIdentity,
  listIdentityClaims,
  resolveIdentityClaim,
  validateIdentityReason,
} from '../lib/queries/identityReview';
import type { ContactInput, Cell, BulkImportRow, ImportAttempt } from '../types';

const mockRpc = jest.fn();
const mockFromCalls: Array<{ table: string; op: string; payload?: unknown }> = [];
let mockContactRow: Record<string, unknown> = {};
let mockSelectError: { message: string } | null = null;

/** A chainable query that records the write and resolves with the configured read/write result. */
function mockChain(table: string) {
  const state: { op: string; payload?: unknown } = { op: 'select' };
  const api: Record<string, unknown> = {};
  const ret = () => api;
  api.select = (..._args: unknown[]) => ret();
  api.insert = (payload: unknown) => { state.op = 'insert'; state.payload = payload; mockFromCalls.push({ table, op: 'insert', payload }); return ret(); };
  api.update = (payload: unknown) => { state.op = 'update'; state.payload = payload; mockFromCalls.push({ table, op: 'update', payload }); return ret(); };
  api.delete = () => { state.op = 'delete'; mockFromCalls.push({ table, op: 'delete' }); return ret(); };
  for (const m of ['eq', 'in', 'is', 'order', 'gte', 'lte', 'ilike', 'neq']) api[m] = () => ret();
  api.single = async () => ({ data: mockContactRow, error: mockSelectError });
  api.maybeSingle = async () => ({ data: mockContactRow, error: mockSelectError });
  api.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return api;
}

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => mockChain(table),
  },
}));

const attemptOf = (attemptId: string): ImportAttempt => ({ attemptId, written: [] });

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const CELL = '00000000-0000-4000-8000-0000000000c1';

const baseInput = (over: Partial<ContactInput> = {}): ContactInput & { logged_by: string } => ({
  cell_id: CELL,
  contact_name: 'Ada Lovelace',
  contact_phone: '+1 416 555 0100',
  phone_hidden: false,
  email: 'ada@example.test',
  tag: 'General',
  follow_up_status: 'new',
  date_contacted: '2026-10-14',
  notes: 'Met after service',
  is_member: false,
  logged_by: ACTOR,
  idempotency_key: 'key-1',
  ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockFromCalls.length = 0;
  mockContactRow = { id: 'contact-1', contact_name: 'Ada Lovelace', cell_id: CELL };
  mockSelectError = null;
});

describe('createContact sends only what the database accepts, through submit_contact', () => {
  it('calls submit_contact and never sends logged_by or person_id', async () => {
    mockRpc.mockResolvedValue({ data: [{ contact_id: 'contact-1', outcome: 'logged' }], error: null });
    await createContact(baseInput());
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('submit_contact');
    expect(args).not.toHaveProperty('p_logged_by');
    expect(args).not.toHaveProperty('p_person_id');
    expect(JSON.stringify(args)).not.toContain(ACTOR);
    expect(args.p_contact_name).toBe('Ada Lovelace');
    expect(args.p_email).toBe('ada@example.test');
    expect(args.p_idempotency_key).toBe('key-1');
  });

  it('sends an empty cell as null, never as an empty string (contacts.cell_id is a uuid)', async () => {
    mockRpc.mockResolvedValue({ data: [{ contact_id: 'contact-1', outcome: 'logged' }], error: null });
    await createContact(baseInput({ cell_id: '' }));
    expect(mockRpc.mock.calls[0][1].p_cell_id).toBeNull();
  });

  it('keeps a real cell uuid', async () => {
    mockRpc.mockResolvedValue({ data: [{ contact_id: 'contact-1', outcome: 'logged' }], error: null });
    await createContact(baseInput({ cell_id: CELL }));
    expect(mockRpc.mock.calls[0][1].p_cell_id).toBe(CELL);
  });

  it('sends a name-only Quick Add with no identity fields', async () => {
    mockRpc.mockResolvedValue({ data: [{ contact_id: 'contact-1', outcome: 'logged' }], error: null });
    await createContact(baseInput({ contact_phone: undefined, email: undefined }));
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_contact_phone).toBeNull();
    expect(args.p_email).toBeNull();
  });

  it('returns the contact re-read under the ordinary read policy, not a write result', async () => {
    mockRpc.mockResolvedValue({ data: [{ contact_id: 'contact-1', outcome: 'logged' }], error: null });
    const saved = await createContact(baseInput());
    expect(saved).toEqual(mockContactRow);
    expect(mockFromCalls.filter((c) => c.op === 'insert' && c.table === 'contacts')).toHaveLength(0);
  });

  it('surfaces the database message verbatim and never writes contacts directly', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'You cannot log a contact in that cell.' } });
    await expect(createContact(baseInput())).rejects.toThrow('You cannot log a contact in that cell.');
    expect(mockFromCalls.some((c) => c.table === 'contacts' && c.op === 'insert')).toBe(false);
  });

  it('fails cleanly when the function returns no contact id', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(createContact(baseInput())).rejects.toThrow('The contact could not be saved.');
  });
});

describe('updateContact writes only the columns the database grants (migration 098)', () => {
  it('strips logged_by, idempotency_key and person_id from an edit payload', async () => {
    await updateContact('contact-1', {
      ...baseInput(),
      person_id: 'person-x',
    } as unknown as Partial<ContactInput>);
    const update = mockFromCalls.find((c) => c.op === 'update' && c.table === 'contacts');
    expect(update).toBeDefined();
    const payload = update!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('logged_by');
    expect(payload).not.toHaveProperty('idempotency_key');
    expect(payload).not.toHaveProperty('person_id');
    expect(payload.contact_name).toBe('Ada Lovelace');
    expect(payload.notes).toBe('Met after service');
  });

  it('sends an unassigned cell as null and leaves cell_id out when it is not changed', async () => {
    await updateContact('contact-1', { cell_id: '' });
    expect((mockFromCalls.at(-1)!.payload as Record<string, unknown>).cell_id).toBeNull();
    await updateContact('contact-1', { notes: 'only notes' });
    expect(mockFromCalls.at(-1)!.payload).not.toHaveProperty('cell_id');
  });
});

describe('bulk CSV import repairs the missing person link through submit_contacts_batch', () => {
  const cells: Cell[] = [{ id: CELL, name: 'North', leader_id: null } as unknown as Cell];
  const rows = (n: number): BulkImportRow[] =>
    Array.from({ length: n }, (_, i) => ({
      contact_name: `Import Person ${i}`,
      phone: '',
      email: `import${i}@example.test`,
      cell_name: 'North',
      notes: '',
      tags: '',
    }) as BulkImportRow);

  it('calls the batch function, not a direct contacts insert', async () => {
    mockRpc.mockResolvedValue({ data: [
      { row_index: 1, outcome: 'imported', contact_id: 'c1', error_code: null },
      { row_index: 2, outcome: 'imported', contact_id: 'c2', error_code: null },
    ], error: null });
    const result = await bulkImportContacts(rows(2), ACTOR, cells, [], attemptOf('att-test'));
    expect(mockRpc).toHaveBeenCalledWith('submit_contacts_batch', expect.any(Object));
    expect(mockFromCalls.some((c) => c.table === 'contacts' && c.op === 'insert')).toBe(false);
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('gives every row its own idempotency key, so a repeated import cannot duplicate rows', async () => {
    mockRpc.mockResolvedValue({ data: [{ row_index: 1, outcome: 'imported', contact_id: 'c1', error_code: null }], error: null });
    await bulkImportContacts(rows(1), ACTOR, cells, [], attemptOf('att-test'));
    const sent = mockRpc.mock.calls[0][1].p_rows as Array<{ idempotency_key: string }>;
    expect(sent[0].idempotency_key).toMatch(/^att-test:[0-9a-f]{16}:0$/);
  });

  it('reports each refused row on its own line with a message that carries no identity', async () => {
    mockRpc.mockResolvedValue({ data: [
      { row_index: 1, outcome: 'imported', contact_id: 'c1', error_code: null },
      { row_index: 2, outcome: 'rejected', contact_id: null, error_code: 'not_authorized' },
    ], error: null });
    const result = await bulkImportContacts(rows(2), ACTOR, cells, [], attemptOf('att-test'));
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ row: 2, message: 'You cannot log a contact in that cell.' }]);
  });

  it('splits imports larger than 500 rows into batches of at most 500', async () => {
    mockRpc.mockImplementation(async (_name: string, args: { p_rows: unknown[] }) => ({
      data: args.p_rows.map((_, i) => ({ row_index: i + 1, outcome: 'imported', contact_id: `c${i}`, error_code: null })),
      error: null,
    }));
    const result = await bulkImportContacts(rows(501), ACTOR, cells, [], attemptOf('att-test'));
    const sizes = mockRpc.mock.calls.map((c) => (c[1].p_rows as unknown[]).length);
    expect(sizes).toEqual([500, 1]);
    expect(result.imported).toBe(501);
  });
});

describe('identity review client', () => {
  it('validates the reason with the same 3 to 500 character rule as the database', () => {
    expect(validateIdentityReason('ab')).not.toBeNull();
    expect(validateIdentityReason('abc')).toBeNull();
    expect(validateIdentityReason(' ab ')).not.toBeNull();
    expect(validateIdentityReason('x'.repeat(501))).not.toBeNull();
    expect(validateIdentityReason('x'.repeat(500))).toBeNull();
  });

  it('refuses to reveal identity without a valid reason and never calls the function', async () => {
    await expect(getClaimIdentity('claim-1', 'x')).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keep_separate sends no candidate', async () => {
    mockRpc.mockResolvedValue({ data: 'kept_separate', error: null });
    await resolveIdentityClaim('claim-1', 'keep_separate', 'person-9', 'Different people');
    expect(mockRpc.mock.calls[0][1].p_candidate_id).toBeNull();
  });

  it('attach requires a candidate', async () => {
    await expect(resolveIdentityClaim('claim-1', 'attach', null, 'Same person')).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('lists claims by name only: the summary carries no identity fields', async () => {
    mockRpc.mockResolvedValue({ data: [{
      claim_id: 'claim-1', contact_id: 'contact-1', contact_name: 'Ada', cell_id: CELL, status: 'open',
      candidate_person_ids: ['person-9'], candidate_names: ['Ada Person'], created_at: '2026-10-14T00:00:00Z',
    }], error: null });
    const [summary] = await listIdentityClaims('open', 10);
    expect(summary.candidateNames).toEqual(['Ada Person']);
    expect(Object.keys(summary)).not.toEqual(expect.arrayContaining(['email', 'phone', 'submittedEmail', 'submittedPhone']));
  });
});

describe('CSV import: the attempt id is the only key source; retries replay; separate attempts are independent', () => {
  const cellsFor = (): Cell[] => [{ id: CELL, name: 'North', leader_id: null } as unknown as Cell];
  const sample = (name: string): BulkImportRow[] => [{
    contact_name: name, phone: '', email: `${name.replace(/\s/g, '.')}@example.test`, cell_name: 'North', notes: '', tags: 'vip;north',
  } as BulkImportRow];
  const keysSent = () => (mockRpc.mock.calls[mockRpc.mock.calls.length - 1][1].p_rows as Array<{ idempotency_key: string }>).map((r) => r.idempotency_key);
  const okFor = (n: number) => mockRpc.mockResolvedValue({
    data: Array.from({ length: n }, (_, i) => ({ row_index: i + 1, outcome: 'imported', contact_id: `c${i + 1}`, error_code: null })),
    error: null,
  });


  it('keys are derived from the attempt id and the row number, and nothing else', async () => {
    okFor(1);
    await bulkImportContacts(sample('Ada Keys'), ACTOR, cellsFor(), [], attemptOf('att-A'));
    expect(keysSent()).toEqual([expect.stringMatching(/^att-A:[0-9a-f]{16}:0$/)]);
  });

  it('a retry of the same attempt sends identical keys (replay, not duplicate)', async () => {
    okFor(1);
    await bulkImportContacts(sample('Ada Retry'), ACTOR, cellsFor(), [], attemptOf('att-R'));
    const first = keysSent();
    await bulkImportContacts(sample('Ada Retry'), ACTOR, cellsFor(), [], attemptOf('att-R'));
    expect(keysSent()).toEqual(first);
  });

  it('an intentionally new attempt with identical content gets different keys (independent rows)', async () => {
    okFor(1);
    await bulkImportContacts(sample('Ada Repeat'), ACTOR, cellsFor(), [], attemptOf('att-1'));
    const one = keysSent();
    await bulkImportContacts(sample('Ada Repeat'), ACTOR, cellsFor(), [], attemptOf('att-2'));
    expect(keysSent()).not.toEqual(one);
  });

  it('the client never writes contact_tags or contact_follow_ups; the database writes them with the contact', async () => {
    okFor(1);
    await bulkImportContacts(sample('Ada Tags'), ACTOR, cellsFor(), [], attemptOf('att-T'));
    const tables = mockFromCalls.filter((c) => c.op === 'insert').map((c) => c.table);
    expect(tables).not.toContain('contact_tags');
    expect(tables).not.toContain('contact_follow_ups');
    const sent = mockRpc.mock.calls[0][1].p_rows as Array<{ tag_names: string[] }>;
    expect(sent[0].tag_names).toEqual(['vip', 'north']);
  });

  it('rows an earlier attempt already completed are reported separately and not as newly imported', async () => {
    mockRpc.mockResolvedValue({ data: [
      { row_index: 1, outcome: 'already_imported', contact_id: 'c1', error_code: null },
      { row_index: 2, outcome: 'imported', contact_id: 'c2', error_code: null },
    ], error: null });
    const rows = [...sample('Ada A'), ...sample('Ada B')];
    const result = await bulkImportContacts(rows, ACTOR, cellsFor(), [], attemptOf('att-P'));
    expect(result.imported).toBe(1);
    expect(result.alreadyCompleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('an uncertain response marks the rows failed with a retry message and assumes nothing was written', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    const result = await bulkImportContacts(sample('Ada Uncertain'), ACTOR, cellsFor(), [], attemptOf('att-U'));
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toMatch(/Retry this import/);
  });
});

describe('the contact write path has no remaining identity lookups or direct writes', () => {
  it('contacts.ts does not call the retired lookup, reads people, or inserts contacts directly', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const source: string = require('fs').readFileSync(require('path').join(__dirname, '../lib/queries/contacts.ts'), 'utf8');
    expect(source).not.toContain('find_person_by_email');
    expect(source).not.toMatch(/from\('people'\)/);
    expect(source).not.toMatch(/from\('contacts'\)\s*\.insert/);
    expect(source).not.toMatch(/\.ilike\(['"]email/);
  });
});
