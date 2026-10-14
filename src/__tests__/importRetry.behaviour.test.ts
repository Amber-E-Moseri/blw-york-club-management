/**
 * Behavioural tests for CSV import identity. The real client (bulkImportContacts) runs against a fake submit_contacts_batch
 * that behaves like the database: a contact is written once per idempotency key, a known key is replayed as already_imported,
 * and tags and follow-ups are written only when a contact is written. Every assertion is on the state the fake database ends
 * in (contacts, tags, follow-ups), not on the calls the client made.
 *
 * The three cases the release requires are kept apart:
 *   retry            the same logical import again: nothing is written twice
 *   correction       a corrected file (invalid rows fixed, rows inserted, removed or reordered): only the new rows are written
 *   new import       an intentional second import: identical rows are written again, but only after the user starts it
 */
import { bulkImportContacts } from '../lib/queries/contacts';
import { startImportAttempt } from '../lib/importAttempt';
import type { BulkImportRow, Cell, ImportAttempt, User } from '../types';

const mockRpc = jest.fn();
const mockFrom = jest.fn((_table: string) => ({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) }));

jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));

const ACTOR = 'actor-1';
const CELLS = [{ id: 'cell-north', name: 'North', leader_id: null }] as unknown as Cell[];
const USERS = [{ id: 'user-x', email: 'x@example.test', full_name: 'Ximena' }] as unknown as Array<Pick<User, 'id' | 'email' | 'full_name'>>;

type Batch = Array<{ contact_name: string; idempotency_key: string; tag_names: string[]; follow_up_assignee: string | null }>;

/** The fake database: contacts by idempotency key, plus the tag and follow-up rows written with them. */
class FakeDatabase {
  private nextId = 0;
  contacts = new Map<string, { id: string; name: string }>();
  tagRows = 0;
  followUpRows = 0;
  uncertainBatches = 0;

  batch(rows: Batch) {
    return rows.map((r, i) => {
      const existing = this.contacts.get(r.idempotency_key);
      if (existing) return { row_index: i + 1, outcome: 'already_imported', contact_id: existing.id, error_code: null };
      const id = `contact-${++this.nextId}`;
      this.contacts.set(r.idempotency_key, { id, name: r.contact_name });
      this.tagRows += new Set(r.tag_names).size;
      if (r.follow_up_assignee) this.followUpRows += 1;
      return { row_index: i + 1, outcome: 'imported', contact_id: id, error_code: null };
    });
  }

  get count() { return this.contacts.size; }
  names() { return Array.from(this.contacts.values()).map((c) => c.name).sort(); }
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  mockFrom.mockImplementation((_table: string) => ({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) }));
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (_name: string, args: { p_rows: Batch }) => {
    const data = db.batch(args.p_rows);
    if (db.uncertainBatches > 0) {
      db.uncertainBatches -= 1;
      return { data: null, error: { message: 'connection lost after commit' } };
    }
    return { data, error: null };
  });
});

const lastKeysSent = () =>
  (mockRpc.mock.calls[mockRpc.mock.calls.length - 1][1].p_rows as Batch).map((r) => r.idempotency_key);

const row = (fileRow: number, name: string, extra: Partial<BulkImportRow> = {}): BulkImportRow => ({
  contact_name: name,
  phone: '',
  email: `${name.replace(/\s/g, '.').toLowerCase()}@example.test`,
  cell_name: 'North',
  notes: '',
  tags: 'vip;north',
  ...extra,
  file_row: fileRow,
} as BulkImportRow);

const attempt = (id: string): ImportAttempt => startImportAttempt(() => id);

describe('retry of the same logical import', () => {
  it('a duplicate submission of a finished import writes nothing new: the server replays every row', async () => {
    const file = [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three')];
    const first = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-A'));
    expect(first.imported).toBe(3);
    expect(first.nextAttempt).toBeNull();

    // The same attempt is submitted again, as a double click before the page cleared its state.
    const again = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-A'));
    expect(again.imported).toBe(0);
    expect(again.alreadyCompleted).toBe(3);
    expect(db.count).toBe(3);
    expect(db.tagRows).toBe(6);
  });

  it('a retry after an uncertain response writes nothing twice, and the tags and follow-up are written once', async () => {
    db.uncertainBatches = 1;
    const file = [row(1, 'Ada One'), row(2, 'Ben Two', { follow_up_person: 'Ximena' })];
    const first = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-U'));
    expect(first.imported).toBe(0);
    expect(first.failed).toBe(2);
    expect(db.count).toBe(2); // the database committed both rows before the response was lost
    expect(first.nextAttempt).not.toBeNull();

    const retry = await bulkImportContacts(file, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(retry.imported).toBe(0);
    expect(retry.alreadyCompleted).toBe(2);
    expect(retry.failed).toBe(0);
    expect(db.count).toBe(2);
    expect(db.tagRows).toBe(4);
    expect(db.followUpRows).toBe(1);
  });
});

describe('correction of a partially imported file', () => {
  it('a fixed invalid row is written, and the rows already written are matched, not written again', async () => {
    const original = [row(1, 'Ada One'), row(2, 'Ben Two', { cell_name: 'Nowhere' }), row(3, 'Cy Three')];
    const first = await bulkImportContacts(original, ACTOR, CELLS, USERS, attempt('att-P'));
    expect(first.imported).toBe(2);
    expect(first.failed).toBe(1);
    expect(first.nextAttempt).not.toBeNull();

    const corrected = [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.imported).toBe(1);
    expect(second.alreadyCompleted).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.heldChanged).toEqual([]);
    expect(second.nextAttempt).toBeNull();
    expect(db.names()).toEqual(['Ada One', 'Ben Two', 'Cy Three']);
    expect(lastKeysSent()).toHaveLength(1); // only Ben was sent
  });

  // The three cases below start from an UNFINISHED import (one invalid row), so the attempt is open and the correction is
  // a correction of that import, not a new import.

  it('an INSERTED row is written, and no row already written is written again or lost', async () => {
    const first = await bulkImportContacts(
      [row(1, 'Ada One'), row(2, 'Bad Row', { cell_name: 'Nowhere' }), row(3, 'Cy Three')], ACTOR, CELLS, USERS, attempt('att-I'),
    );
    expect(first.imported).toBe(2);
    expect(first.nextAttempt).not.toBeNull();

    // Ben is inserted at position 2, and the bad row is fixed in place at position 4.
    const corrected = [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three'), row(4, 'Bad Row')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.imported).toBe(2); // Ben (inserted) and the fixed row
    expect(second.alreadyCompleted).toBe(2); // Ada and Cy
    expect(second.heldChanged).toEqual([]); // position 2 held the bad row, not an edited contact
    expect(db.names()).toEqual(['Ada One', 'Bad Row', 'Ben Two', 'Cy Three']);
  });


  it('an row INSERTED AT A WRITTEN POSITION is written, not held: the row that was there is still in the file', async () => {
    const first = await bulkImportContacts(
      [row(1, 'Ada One'), row(2, 'Cy Three'), row(3, 'Bad Row', { cell_name: 'Nowhere' })], ACTOR, CELLS, USERS, attempt('att-W'),
    );
    expect(first.imported).toBe(2); // position 1 holds Ada, position 2 holds Cy

    // Ben is inserted at position 1. Ada moves to position 2 and Cy to position 3, and the bad row is fixed at position 4.
    const corrected = [row(1, 'Ben Two'), row(2, 'Ada One'), row(3, 'Cy Three'), row(4, 'Bad Row')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.heldChanged).toEqual([]);
    expect(second.imported).toBe(2); // Ben and the fixed row
    expect(second.alreadyCompleted).toBe(2); // Ada and Cy
    expect(db.names()).toEqual(['Ada One', 'Bad Row', 'Ben Two', 'Cy Three']);
  });

  it('a REMOVED row does not remove or duplicate anything; the rows left are matched', async () => {
    const first = await bulkImportContacts(
      [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three'), row(4, 'Bad Row', { cell_name: 'Nowhere' })],
      ACTOR, CELLS, USERS, attempt('att-R'),
    );
    expect(first.imported).toBe(3);

    // Ben is removed from the file, and the bad row is fixed.
    const corrected = [row(1, 'Ada One'), row(2, 'Cy Three'), row(3, 'Bad Row')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.imported).toBe(1); // the fixed row only
    expect(second.alreadyCompleted).toBe(2);
    expect(second.heldChanged).toEqual([]);
    expect(db.names()).toEqual(['Ada One', 'Bad Row', 'Ben Two', 'Cy Three']);
  });

  it('a REORDERED file writes only the row that is actually new: every other row is matched by its content', async () => {
    const first = await bulkImportContacts(
      [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three'), row(4, 'Bad Row', { cell_name: 'Nowhere' })],
      ACTOR, CELLS, USERS, attempt('att-O'),
    );
    expect(first.imported).toBe(3);

    const reordered = [row(1, 'Cy Three'), row(2, 'Bad Row'), row(3, 'Ada One'), row(4, 'Ben Two')];
    const second = await bulkImportContacts(reordered, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.imported).toBe(1); // the bad row, now valid
    expect(second.alreadyCompleted).toBe(3);
    expect(second.heldChanged).toEqual([]);
    expect(db.names()).toEqual(['Ada One', 'Bad Row', 'Ben Two', 'Cy Three']);
    expect(db.tagRows).toBe(8);
  });

  it('an EDITED row at a written position is HELD, not written, and is written only when the user imports it as new', async () => {
    const first = await bulkImportContacts([row(1, 'Ada One'), row(2, 'Ben Two', { cell_name: 'Nowhere' })], ACTOR, CELLS, USERS, attempt('att-E'));
    expect(first.imported).toBe(1);

    const edited = [row(1, 'Ada Edited'), row(2, 'Ben Two')];
    const held = await bulkImportContacts(edited, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(held.heldChanged).toEqual([1]);
    expect(held.imported).toBe(1); // Ben, the new row
    expect(held.nextAttempt).not.toBeNull();
    expect(db.names()).toEqual(['Ada One', 'Ben Two']); // the edit was not written

    const explicit = await bulkImportContacts(
      edited, ACTOR, CELLS, USERS, held.nextAttempt as ImportAttempt, { importChangedAsNew: true },
    );
    expect(explicit.imported).toBe(1);
    expect(explicit.heldChanged).toEqual([]);
    expect(db.names()).toEqual(['Ada Edited', 'Ada One', 'Ben Two']);
    expect(explicit.nextAttempt).toBeNull();
  });

  it('two identical rows in one file are two contacts, and a correction matches each copy once', async () => {
    const first = await bulkImportContacts(
      [row(1, 'Ada One'), row(2, 'Ada One'), row(3, 'Bad Row', { cell_name: 'Nowhere' })], ACTOR, CELLS, USERS, attempt('att-D'),
    );
    expect(first.imported).toBe(2);
    expect(db.count).toBe(2);

    const corrected = [row(1, 'Ada One'), row(2, 'Ada One'), row(3, 'Ben Two')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.alreadyCompleted).toBe(2);
    expect(second.imported).toBe(1);
    expect(db.names()).toEqual(['Ada One', 'Ada One', 'Ben Two']);
  });
});

describe('an intentional new import', () => {
  it('after a finished import, identical contents with a new attempt are written again', async () => {
    const file = [row(1, 'Ada One'), row(2, 'Ben Two')];
    const first = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-1'));
    expect(first.imported).toBe(2);
    expect(first.nextAttempt).toBeNull();

    const second = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-2'));
    expect(second.imported).toBe(2);
    expect(second.alreadyCompleted).toBe(0);
    expect(db.count).toBe(4);
    expect(db.tagRows).toBe(8);
  });

  it('an email shared by two different contacts is not a reason to merge them', async () => {
    const file = [
      row(1, 'Ada One', { email: 'shared@example.test' }),
      row(2, 'Ada Two', { email: 'shared@example.test' }),
    ];
    const result = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-M'));
    expect(result.imported).toBe(2);
    expect(db.count).toBe(2);
  });
});
