// Email identity lookup must be an exact database comparison, never a LIKE/ILIKE pattern.
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
import fs from 'fs';
import path from 'path';
import { findPersonIdByEmail } from '../lib/queries/people';
import { supabase } from '../lib/supabase';

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

afterEach(() => jest.clearAllMocks());

test('findPersonIdByEmail sends the raw address to the exact-match RPC (no pattern characters are interpreted)', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'person-1', error: null });
  for (const email of ['john_smith@x.org', '100%@x.org', 'a*b@x.org', 'Mixed.Case@X.ORG', 'back\slash@x.org']) {
    await expect(findPersonIdByEmail(email)).resolves.toBe('person-1');
    expect(supabase.rpc).toHaveBeenLastCalledWith('find_person_by_email', { p_email: email });
  }
  expect(supabase.from).not.toHaveBeenCalled();
});

test('findPersonIdByEmail returns null for no match and surfaces database errors', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: null });
  await expect(findPersonIdByEmail('nobody@x.org')).resolves.toBeNull();
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
  await expect(findPersonIdByEmail('x@x.org')).rejects.toThrow('boom');
});

test('no .ilike() remains in an identity path (people/contact matching)', () => {
  const people = read('src/lib/queries/people.ts');
  expect(people).not.toMatch(/[.]ilike[(]'/);
  const migration = read('supabase/migrations/037_find_person_by_email.sql');
  expect(migration).toContain('normalize_identity_email(p.email) = public.normalize_identity_email(p_email)');
  expect(migration).toContain('security invoker');
});
