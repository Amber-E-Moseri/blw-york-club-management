/**
 * @jest-environment node
 */
// Real-code integration test: runs the ACTUAL createContactPerson() from src/lib/queries/people.ts against a LOCAL
// Supabase stack as real (throwaway) accounts. Unlike the mirror in p0_behavioural_certification.mjs it proves the
// shipped code. Skipped unless CERT_SUPABASE_URL is 127.0.0.1/localhost with CERT_SUPABASE_ANON_KEY and
// CERT_SUPABASE_SERVICE_ROLE_KEY. This is a behavioural test; it is NOT a source-text assertion.
import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Jest's node environment does not expose the Node 18+ web globals that supabase-js needs (fetch, Headers and,
// for realtime, WebSocket). Fill in only what is missing, using the same implementations (undici) that Node ships
// with. This does not touch the code under test: createContactPerson still runs against the real database.
const webGlobals = globalThis as { fetch?: unknown; Headers?: unknown; WebSocket?: unknown };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const undiciGlobals = require('undici');
if (typeof webGlobals.fetch === 'undefined') webGlobals.fetch = undiciGlobals.fetch;
if (typeof webGlobals.Headers === 'undefined') webGlobals.Headers = undiciGlobals.Headers;
if (typeof webGlobals.WebSocket === 'undefined') webGlobals.WebSocket = undiciGlobals.WebSocket;

const url = process.env.CERT_SUPABASE_URL ?? '';
const anonKey = process.env.CERT_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.CERT_SUPABASE_SERVICE_ROLE_KEY ?? '';
const enabled = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) && !!anonKey && !!serviceKey;
const maybe = enabled ? describe : describe.skip;
// Each test makes real round-trips to the local database. Under the full parallel Jest run the default 5s limit is
// too tight for the first test, so give this file a longer limit. Assertions are unchanged.
jest.setTimeout(30000);

// The module under test imports `supabase` from ../lib/supabase; point it at the signed-in test client.
jest.mock('../lib/supabase', () => ({
  get supabase() {
    return (globalThis as unknown as { __certClient: unknown }).__certClient;
  },
}));

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const rnd = () => randomUUID().replace(/-/g, '').slice(0, 10);

maybe('createContactPerson (real code, real database)', () => {
  let admin: SupabaseClient;
  let coordinator: { id: string; client: SupabaseClient };
  let leader: { id: string; client: SupabaseClient };
  let cellId: string;
  const userIds: string[] = [];
  const personIds = new Set<string>();
  let createContactPerson: typeof import('../lib/queries/people').createContactPerson;

  async function makeUser(label: string, role: string) {
    const email = `cert.qa.${label}.${rnd()}@example.test`;
    const password = `${rnd()}Aa1!${rnd()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    userIds.push(data.user.id);
    await admin.from('profiles').update({ role, status: 'active' }).eq('id', data.user.id);
    const client = createClient(url, anonKey, opts);
    const { error: signErr } = await client.auth.signInWithPassword({ email, password });
    if (signErr) throw new Error(signErr.message);
    return { id: data.user.id, client };
  }

  const use = (u: { client: SupabaseClient }) => {
    (globalThis as unknown as { __certClient: unknown }).__certClient = u.client;
  };
  const log = async (u: { id: string; client: SupabaseClient }, over: Record<string, unknown>) => {
    use(u);
    const res = await createContactPerson({
      fullName: 'Cert Person',
      cellId,
      loggedBy: u.id,
      idempotencyKey: randomUUID(),
      ...over,
    } as Parameters<typeof createContactPerson>[0]);
    personIds.add(res.person.id);
    return res;
  };
  const countPeople = async (normalizedEmail: string) =>
    (await admin.from('people').select('id,email')).data!.filter((p) => (p.email ?? '').trim().toLowerCase() === normalizedEmail.trim().toLowerCase()).length;

  beforeAll(async () => {
    admin = createClient(url, serviceKey, opts);
    coordinator = await makeUser('coord', 'coordinator');
    leader = await makeUser('leader', 'cell_leader');
    const { data } = await admin.from('cells').insert({ name: `Cert QA ${rnd()}`, leader_id: leader.id }).select('id').single();
    cellId = data!.id;
    use(coordinator);
    ({ createContactPerson } = await import('../lib/queries/people'));
  }, 90000);

  afterAll(async () => {
    const ids = Array.from(personIds);
    if (ids.length) {
      await admin.from('contacts').delete().in('person_id', ids);
      await admin.from('people').delete().in('id', ids);
    }
    if (cellId) await admin.from('cells').delete().eq('id', cellId);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }, 90000);

  test('a new contact creates a person and a contact', async () => {
    const r = await log(coordinator, { email: `new.${rnd()}@example.test` });
    expect(r.person.id).toBeTruthy();
    expect(r.contact.id).toBeTruthy();
  });

  test('an email that differs only by case or whitespace resolves to the same person', async () => {
    const email = `case.${rnd()}@example.test`;
    const a = await log(coordinator, { email });
    const b = await log(coordinator, { email: `  ${email.toUpperCase()} ` });
    expect(b.person.id).toBe(a.person.id);
    expect(await countPeople(email)).toBe(1);
  });

  test("'_' is a literal: john_x@ must NOT match johnZx@ (no wildcard merge)", async () => {
    const tag = rnd();
    const a = await log(coordinator, { fullName: 'Underscore', email: `john_${tag}@example.test` });
    const b = await log(coordinator, { fullName: 'Different Z', email: `johnZ${tag}@example.test` });
    expect(b.person.id).not.toBe(a.person.id);
    const again = await log(coordinator, { fullName: 'Underscore again', email: `JOHN_${tag}@EXAMPLE.TEST` });
    expect(again.person.id).toBe(a.person.id);
  });

  test("'%' and '*' are literals: they never match other addresses", async () => {
    const tag = rnd();
    const pct = await log(coordinator, { fullName: 'Percent', email: `p%${tag}@example.test` });
    const other = await log(coordinator, { fullName: 'Other', email: `pzz${tag}@example.test` });
    expect(other.person.id).not.toBe(pct.person.id);
    const star = await log(coordinator, { fullName: 'Star', email: `s*${tag}@example.test` });
    const other2 = await log(coordinator, { fullName: 'Other2', email: `szz${tag}@example.test` });
    expect(other2.person.id).not.toBe(star.person.id);
  });

  test('an ambiguous shared phone is refused explicitly and never merges or duplicates', async () => {
    const phone = `+1416${Math.floor(Math.random() * 9000000 + 1000000)}`;
    const owner = await log(coordinator, { fullName: 'Phone Owner', phone });
    await expect(log(coordinator, { fullName: 'Someone Else', phone })).rejects.toThrow(/ambiguous-phone|staff review/i);
    const { data } = await admin.from('people').select('id,full_name').eq('phone', phone);
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(owner.person.id);
  });

  test('two legitimate same-day contacts with one person are both recorded', async () => {
    const email = `sameday.${rnd()}@example.test`;
    const today = new Date().toISOString().split('T')[0];
    const a = await log(coordinator, { email, dateContacted: today });
    const b = await log(coordinator, { email, dateContacted: today });
    expect(b.person.id).toBe(a.person.id);
    expect(b.contact.id).not.toBe(a.contact.id);
  });

  test('retrying with the identical idempotency key returns the original contact', async () => {
    const email = `retry.${rnd()}@example.test`;
    const key = randomUUID();
    const a = await log(coordinator, { email, idempotencyKey: key });
    const b = await log(coordinator, { email, idempotencyKey: key });
    expect(b.contact.id).toBe(a.contact.id);
    const { count } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  test('concurrent duplicate submissions (same key) all succeed and leave one contact', async () => {
    const email = `race.${rnd()}@example.test`;
    const key = randomUUID();
    use(coordinator);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => createContactPerson({ fullName: 'Race', email, cellId, loggedBy: coordinator.id, idempotencyKey: key })),
    );
    results.forEach((r) => r.status === 'fulfilled' && personIds.add(r.value.person.id));
    const failures = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.message);
    expect(failures).toEqual([]);
    const { count } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(count).toBe(1);
    expect(await countPeople(email)).toBe(1);
  });

  test('concurrent first contacts with one new email (different keys) share one person', async () => {
    const email = `race2.${rnd()}@example.test`;
    use(coordinator);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createContactPerson({ fullName: 'Race2', email, cellId, loggedBy: coordinator.id, idempotencyKey: randomUUID() })),
    );
    results.forEach((r) => r.status === 'fulfilled' && personIds.add(r.value.person.id));
    const failures = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.message);
    expect(failures).toEqual([]);
    expect(await countPeople(email)).toBe(1);
  });

  test('logged_by cannot be attributed to another user', async () => {
    await expect(log(leader, { email: `spoof.${rnd()}@example.test`, loggedBy: coordinator.id })).rejects.toThrow();
  });

  test('a cell leader can log in their own cell only', async () => {
    const ok = await log(leader, { email: `lead.${rnd()}@example.test` });
    expect(ok.contact.id).toBeTruthy();
    const { data: other } = await admin.from('cells').insert({ name: `Cert QA other ${rnd()}` }).select('id').single();
    try {
      await expect(log(leader, { email: `lead2.${rnd()}@example.test`, cellId: other!.id })).rejects.toThrow();
    } finally {
      await admin.from('cells').delete().eq('id', other!.id);
    }
  });
});
