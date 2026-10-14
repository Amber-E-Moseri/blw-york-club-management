/**
 * @jest-environment node
 */
// Real-code integration test: runs the ACTUAL createContact() from src/lib/queries/contacts.ts (which calls the
// submit_contact RPC) against a LOCAL Supabase stack as real, throwaway accounts, and sends direct PostgREST writes as
// ordinary members to prove the bypass is closed. Skipped unless CERT_SUPABASE_URL is 127.0.0.1/localhost with
// CERT_SUPABASE_ANON_KEY, CERT_SUPABASE_SERVICE_ROLE_KEY, CERT_COORDINATOR_EMAIL and CERT_COORDINATOR_PASSWORD.
// In this environment the suite is SKIPPED: the HTTP/JWT layer is not running. Its results are UNVERIFIED until it runs.
import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Jest's node environment does not expose the Node 18+ web globals that supabase-js needs. Fill in only what is
// missing, using the same implementations (undici) that Node ships with. The code under test is unchanged.
const webGlobals = globalThis as { fetch?: unknown; Headers?: unknown; WebSocket?: unknown };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const undiciGlobals = require('undici');
if (typeof webGlobals.fetch === 'undefined') webGlobals.fetch = undiciGlobals.fetch;
if (typeof webGlobals.Headers === 'undefined') webGlobals.Headers = undiciGlobals.Headers;
if (typeof webGlobals.WebSocket === 'undefined') webGlobals.WebSocket = undiciGlobals.WebSocket;

const url = process.env.CERT_SUPABASE_URL ?? '';
const anonKey = process.env.CERT_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.CERT_SUPABASE_SERVICE_ROLE_KEY ?? '';
const coordEmail = process.env.CERT_COORDINATOR_EMAIL ?? '';
const coordPassword = process.env.CERT_COORDINATOR_PASSWORD ?? '';
const enabled = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) && !!anonKey && !!serviceKey && !!coordEmail && !!coordPassword;
const maybe = enabled ? describe : describe.skip;
jest.setTimeout(30000);

// The module under test imports `supabase` from ../lib/supabase; point it at the signed-in test client.
jest.mock('../lib/supabase', () => ({
  get supabase() {
    return (globalThis as unknown as { __certClient: unknown }).__certClient;
  },
}));

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const rnd = () => randomUUID().replace(/-/g, '').slice(0, 10);

maybe('submit_contact through createContact (real code, real database, real JWTs)', () => {
  let admin: SupabaseClient;
  let coordinator: { id: string; client: SupabaseClient };
  let leader: { id: string; client: SupabaseClient };
  let member: { id: string; client: SupabaseClient };
  let cellId: string;
  let otherCellId: string;
  const userIds: string[] = [];
  const contactIds = new Set<string>();
  let createContact: typeof import('../lib/queries/contacts').createContact;

  async function signedIn(email: string, password: string) {
    const client = createClient(url, anonKey, opts);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(error?.message ?? 'sign-in failed');
    return { id: data.user.id, client };
  }

  // Accounts start pending. A coordinator activates them through approve_pending_member and sets the role.
  async function makeUser(label: string, role: string, approver: SupabaseClient) {
    const email = `cert.f2.${label}.${rnd()}@example.test`;
    const password = `${rnd()}Aa1!${rnd()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    userIds.push(data.user.id);
    const { error: approveErr } = await approver.rpc('approve_pending_member', { target_member_id: data.user.id });
    if (approveErr) throw new Error(`approve ${label}: ${approveErr.message}`);
    const { error: roleErr } = await approver.from('profiles').update({ role }).eq('id', data.user.id);
    if (roleErr) throw new Error(`role ${label}: ${roleErr.message}`);
    return signedIn(email, password);
  }

  const use = (u: { client: SupabaseClient }) => {
    (globalThis as unknown as { __certClient: unknown }).__certClient = u.client;
  };

  beforeAll(async () => {
    admin = createClient(url, serviceKey, opts);
    coordinator = await signedIn(coordEmail, coordPassword);
    leader = await makeUser('leader', 'cell_leader', coordinator.client);
    member = await makeUser('member', 'member', coordinator.client);
    const { data } = await admin.from('cells').insert({ name: `Cert F2 ${rnd()}`, leader_id: leader.id }).select('id').single();
    cellId = data!.id;
    const { data: other } = await admin.from('cells').insert({ name: `Cert F2 other ${rnd()}` }).select('id').single();
    otherCellId = other!.id;
    use(coordinator);
    ({ createContact } = await import('../lib/queries/contacts'));
  }, 90000);

  afterAll(async () => {
    if (contactIds.size) await admin.from('contacts').delete().in('id', Array.from(contactIds));
    await admin.from('cells').delete().in('id', [cellId, otherCellId]);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }, 90000);

  const log = async (who: { client: SupabaseClient }, input: Record<string, unknown>) => {
    use(who);
    const saved = await createContact({
      contact_name: 'F2 Contact',
      cell_id: cellId,
      phone_hidden: false,
      tag: '',
      follow_up_status: '',
      date_contacted: new Date().toISOString().split('T')[0],
      is_member: false,
      ...input,
    } as Parameters<typeof createContact>[0]);
    contactIds.add(saved.id);
    return saved;
  };

  test('name-only Quick Add creates a contact in the chosen cell', async () => {
    const saved = await log(member, { cell_id: cellId, contact_name: 'Quick Name Only' });
    expect(saved.id).toBeTruthy();
    expect(saved.cell_id).toBe(cellId);
  });

  test('an unassigned Quick Add is stored with a null cell', async () => {
    const saved = await log(member, { cell_id: '', contact_name: 'Quick Unassigned' });
    expect(saved.cell_id).toBeNull();
  });

  test('the same idempotency key returns the same contact', async () => {
    const key = randomUUID();
    const a = await log(member, { contact_name: 'Replay One', idempotency_key: key });
    const b = await log(member, { contact_name: 'Replay Two', idempotency_key: key });
    expect(b.id).toBe(a.id);
  });

  test('a member cannot log into another cell (refused with the database message)', async () => {
    await expect(log(member, { cell_id: otherCellId, contact_name: 'Wrong Cell' }))
      .rejects.toThrow('You cannot log a contact in that cell.');
  });

  test('a cell leader logs into their own cell', async () => {
    const saved = await log(leader, { cell_id: cellId, contact_name: 'Leader Log' });
    expect(saved.cell_id).toBe(cellId);
  });

  test('a direct PostgREST insert into people is refused for an ordinary member', async () => {
    use(member);
    const { error } = await member.client.from('people').insert({ full_name: 'Direct', email: `direct.${rnd()}@example.test` });
    expect(error?.code).toBe('42501');
  });

  test('a direct PostgREST insert into contacts is refused for an ordinary member', async () => {
    use(member);
    const { error } = await member.client.from('contacts').insert({
      contact_name: 'Direct Contact', cell_id: cellId, logged_by: member.id,
      person_id: randomUUID(), phone_hidden: false, is_member: false, archived: false,
    });
    expect(error?.code).toBe('42501');
  });

  test('an ordinary member cannot read canonical people.email', async () => {
    use(member);
    const { error } = await member.client.from('people').select('email').limit(1);
    expect(error?.code).toBe('42501');
  });

  test('an ordinary member cannot reassign a contact to another person through PostgREST', async () => {
    use(member);
    const saved = await log(member, { contact_name: 'Reassign Target' });
    const { error } = await member.client.from('contacts').update({ person_id: randomUUID() }).eq('id', saved.id);
    expect(error?.code).toBe('42501');
  });
});
