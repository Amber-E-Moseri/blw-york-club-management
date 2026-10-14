/**
 * Behavioural tests for the CSV import retry. The real client code (bulkImportContacts) runs against a fake
 * submit_contacts_batch that behaves like the database: a contact is written once per idempotency key, a known key is
 * replayed as already_imported, and tags and follow-ups are written only when the contact is written. Every assertion is on
 * the state the fake database ends in, not on the calls the client made.
 */
import { bulkImportContacts } from '../lib/queries/contacts';
import { startImportAttempt, fingerprintText } from '../lib/importAttempt';
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

/** The fake database. */
class FakeDatabase {
  private nextId = 0;
  /** Contacts by idempotency key. */
  contacts = new Map<string, { id: string; name: string }>();
  tagRows = 0;
  followUpRows = 0;
  /** Number of upcoming batches that commit and then report an error (the uncertain case). */
  uncertainBatches = 0;

  batch(rows: Array<{ contact_name: string; idempotency_key: string; tag_names: string[]; follow_up_assignee: string | null }>) {
    const outcomes = rows.map((r, i) => {
      const existing = this.contacts.get(r.idempotency_key);
      if (existing) {
        return { row_index: i + 1, outcome: 'already_imported', contact_id: existing.id, error_code: null };
      }
      const id = `contact-${++this.nextId}`;
      this.contacts.set(r.idempotency_key, { id, name: r.contact_name });
      this.tagRows += new Set(r.tag_names).size;
      if (r.follow_up_assignee) this.followUpRows += 1;
      return { row_index: i + 1, outcome: 'imported', contact_id: id, error_code: null };
    });
    return outcomes;
  }

  get count() { return this.contacts.size; }
  nameFor(key: string) { return this.contacts.get(key)?.name; }
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  // CRA resets mock implementations before each test, so the audit-log writer is set up here as well.
  mockFrom.mockImplementation((_table: string) => ({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) }));
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (_name: string, args: { p_rows: Parameters<FakeDatabase['batch']>[0] }) => {
    const data = db.batch(args.p_rows);
    if (db.uncertainBatches > 0) {
      db.uncertainBatches -= 1;
      return { data: null, error: { message: 'connection lost after commit' } };
    }
    return { data, error: null };
  });
});

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

describe('complete retries', () => {
  it('a duplicate submission of a fully imported file writes nothing new and reports the rows as already imported', async () => {
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
});

describe('corrected partial retries', () => {
  it('a corrected re-upload imports only the failed row, keeps its key, and never recreates completed rows', async () => {
    const original = [row(1, 'Ada One'), row(2, 'Ben Two', { cell_name: 'Nowhere' }), row(3, 'Cy Three')];
    const first = await bulkImportContacts(original, ACTOR, CELLS, USERS, attempt('att-P'));
    expect(first.imported).toBe(2);
    expect(first.failed).toBe(1);
    expect(first.nextAttempt).not.toBeNull();
    expect(db.count).toBe(2);

    // The user fixes row 2 and uploads the file again, under the same open attempt.
    const corrected = [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);

    expect(second.imported).toBe(1);
    expect(second.alreadyCompleted).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.nextAttempt).toBeNull();
    expect(db.count).toBe(3);
    // Only row 2 was sent in the second call, with its original file position as its key.
    const sentKeys = mockRpc.mock.calls[mockRpc.mock.calls.length - 1][1].p_rows.map((r: { idempotency_key: string }) => r.idempotency_key);
    expect(sentKeys).toEqual(['att-P:2']);
  });

  it('a row that becomes valid after correction does not shift the keys of the rows already written', async () => {
    const original = [row(1, 'Ada One', { cell_name: 'Nowhere' }), row(2, 'Ben Two'), row(3, 'Cy Three')];
    const first = await bulkImportContacts(original, ACTOR, CELLS, USERS, attempt('att-S'));
    expect(first.imported).toBe(2);
    // Ben (file row 2) and Cy (file row 3) are already written under keys att-S:2 and att-S:3.
    const corrected = [row(1, 'Ada One'), row(2, 'Ben Two'), row(3, 'Cy Three')];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.alreadyCompleted).toBe(2);
    expect(second.imported).toBe(1);
    expect(db.count).toBe(3);
    expect(db.nameFor('att-S:2')).toBe('Ben Two');
    expect(db.nameFor('att-S:3')).toBe('Cy Three');
  });
});

describe('tags and follow-ups stay exactly once', () => {
  it('a corrected retry adds no tags or follow-ups for rows already written', async () => {
    const original = [
      row(1, 'Ada One'),
      row(2, 'Ben Two', { follow_up_person: 'Ximena', cell_name: 'Nowhere' }),
    ];
    const first = await bulkImportContacts(original, ACTOR, CELLS, USERS, attempt('att-T'));
    expect(first.imported).toBe(1);
    expect(db.tagRows).toBe(2);
    expect(db.followUpRows).toBe(0);

    const corrected = [row(1, 'Ada One'), row(2, 'Ben Two', { follow_up_person: 'Ximena' })];
    const second = await bulkImportContacts(corrected, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.imported).toBe(1);
    expect(db.tagRows).toBe(4); // Ada's two tags, Ben's two tags, each written once
    expect(db.followUpRows).toBe(1); // Ben's follow-up, written once
  });
});

describe('uncertain success', () => {
  it('when the batch committed but the response was lost, a retry of the same attempt writes nothing twice', async () => {
    db.uncertainBatches = 1;
    const file = [row(1, 'Ada One'), row(2, 'Ben Two', { follow_up_person: 'Ximena' })];
    const first = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-U'));
    expect(first.imported).toBe(0);
    expect(first.failed).toBe(2);
    expect(db.count).toBe(2); // the database did commit both rows
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

describe('intentional new imports', () => {
  it('after a completed import, identical contents imported again are written again as a separate import', async () => {
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
});

describe('edits to already-written rows', () => {
  it('an edited, already-written row keeps the original contact and is reported as an edit that was not applied', async () => {
    // Ada (row 1) is written. Ben (row 2) fails, so the attempt stays open.
    const original = [row(1, 'Ada One'), row(2, 'Ben Two', { cell_name: 'Nowhere' })];
    const first = await bulkImportContacts(original, ACTOR, CELLS, USERS, attempt('att-E'));
    expect(first.imported).toBe(1);

    // The user renames Ada in the file and fixes Ben.
    const edited = [row(1, 'Ada Edited'), row(2, 'Ben Two')];
    const second = await bulkImportContacts(edited, ACTOR, CELLS, USERS, first.nextAttempt as ImportAttempt);
    expect(second.editedAfterImport).toBe(1);
    expect(second.alreadyCompleted).toBe(1);
    expect(second.imported).toBe(1);
    expect(db.nameFor('att-E:1')).toBe('Ada One');
  });
});

describe('no silent deduplication of distinct people', () => {
  it('two different contacts with the same email in one file are two contacts', async () => {
    const file = [
      row(1, 'Ada One', { email: 'shared@example.test' }),
      row(2, 'Ada Two', { email: 'shared@example.test' }),
    ];
    const result = await bulkImportContacts(file, ACTOR, CELLS, USERS, attempt('att-D'));
    expect(result.imported).toBe(2);
    expect(db.count).toBe(2);
  });
});

describe('row fingerprints', () => {
  it('differ for different content and match for identical content', () => {
    expect(fingerprintText('abc')).toBe(fingerprintText('abc'));
    expect(fingerprintText('abc')).not.toBe(fingerprintText('abd'));
  });
});
