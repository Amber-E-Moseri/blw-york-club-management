// Server-side fail-closed checks for role and approval status, run on PGlite.
//
// Replays the real migrations through 103, then checks that an administrator or coordinator who is NOT active (pending,
// rejected or inactive) gets no staff authority from the database:
//   FC-1  current_user_role() returns null, so role-gated policies see no role
//   FC-2  is_admin_or_coordinator() and has_admin_permission() return false
//   FC-3  approve_pending_member() refuses (42501) and the target stays pending
//   FC-4  an unknown or missing profile has no role and no authority
//   FC-5  an active administrator is still authorised (control, so the denials above are not vacuous)
//   FC-6  a rejected administrator cannot read another account's profile row
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL and SECURITY DEFINER paths, not GoTrue or PostgREST.
// It touches no hosted or Docker database.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/approval_status_fail_closed_pglite_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, asRole, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const LAST = '103_identity_link_queue_and_approval_gate.sql';

const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${String(evidence).slice(0, 160)}]` : ''}`);
};
const denied = (r) => !r.ok && r.code === '42501';

const { db, applied } = await openReplay(MIGRATIONS, { lastFile: LAST });
console.log(`replayed ${applied.length} migrations through ${applied[applied.length - 1]}`);

// Fixtures. The owner bypasses RLS and the privilege layer, as the database owner does in a real replay.
const ids = {
  adminPending: '00000000-0000-4000-8000-000000000001',
  adminRejected: '00000000-0000-4000-8000-000000000002',
  adminInactive: '00000000-0000-4000-8000-000000000003',
  adminActive: '00000000-0000-4000-8000-000000000004',
  pendingMember: '00000000-0000-4000-8000-000000000005',
  activeMember: '00000000-0000-4000-8000-000000000006',
  missing: '00000000-0000-4000-8000-000000000099',
};
const fixtures = [
  [ids.adminPending, 'admin', 'pending'],
  [ids.adminRejected, 'admin', 'rejected'],
  [ids.adminInactive, 'admin', 'inactive'],
  [ids.adminActive, 'admin', 'active'],
  [ids.pendingMember, 'member', 'pending'],
  [ids.activeMember, 'member', 'active'],
];
for (const [id, role, status] of fixtures) {
  await db.query(
    'insert into auth.users (id, email, aud, role, created_at, email_confirmed_at) values ($1, $2, $3, $4, now(), now())',
    [id, `${status}.${role}@example.test`, 'authenticated', 'authenticated'],
  );
  // The signup trigger (handle_new_user, migration 019) creates the profile row as member and pending. Set the fixture
  // role and status on that row. The owner session bypasses the privileged-column guard, as in a real replay.
  await db.query(
    'update public.profiles set role = $2, status = $3, full_name = $4 where id = $1',
    [id, role, status, `${status} ${role}`],
  );
}

// FC-1, FC-2, FC-3 for each unapproved administrator.
for (const [label, uid] of [['pending', ids.adminPending], ['rejected', ids.adminRejected], ['inactive', ids.adminInactive]]) {
  const role = await attempt(db, 'authenticated', uid, 'select public.current_user_role() as r');
  check(`FC-1 ${label} administrator has no role for RLS`, role.ok && role.rows[0].r === null, `role=${role.rows?.[0]?.r}`);

  const staff = await attempt(db, 'authenticated', uid, 'select public.is_admin_or_coordinator() as v');
  check(`FC-2 ${label} administrator is not admin or coordinator`, staff.ok && staff.rows[0].v === false, `v=${staff.rows?.[0]?.v}`);

  const perm = await attempt(db, 'authenticated', uid, "select public.has_admin_permission('reports.generate') as v");
  check(`FC-2 ${label} administrator has no admin permission`, perm.ok && perm.rows[0].v === false, `v=${perm.rows?.[0]?.v}`);

  const approve = await attempt(db, 'authenticated', uid, 'select * from public.approve_pending_member($1)', [ids.pendingMember]);
  const still = await db.query('select status from public.profiles where id = $1', [ids.pendingMember]);
  check(
    `FC-3 ${label} administrator cannot approve a pending member`,
    denied(approve) && still.rows[0].status === 'pending',
    `code=${approve.code} status=${still.rows[0].status}`,
  );
}

// FC-4: a signed-in user with no profile row.
const noRow = await attempt(db, 'authenticated', ids.missing, 'select public.current_user_role() as r');
check('FC-4 account with no profile row has no role', noRow.ok && noRow.rows[0].r === null, `role=${noRow.rows?.[0]?.r}`);
const noRowStaff = await attempt(db, 'authenticated', ids.missing, 'select public.is_admin_or_coordinator() as v');
check('FC-4 account with no profile row is not staff', noRowStaff.ok && noRowStaff.rows[0].v === false, `v=${noRowStaff.rows?.[0]?.v}`);

// FC-5: an active administrator keeps authority (control).
const activeStaff = await attempt(db, 'authenticated', ids.adminActive, 'select public.is_admin_or_coordinator() as v');
check('FC-5 active administrator is still authorised (control)', activeStaff.ok && activeStaff.rows[0].v === true, `v=${activeStaff.rows?.[0]?.v}`);

// FC-6: a rejected administrator cannot read another account's profile row.
const rejectedRead = await attempt(db, 'authenticated', ids.adminRejected, 'select id from public.profiles where id = $1', [ids.activeMember]);
check('FC-6 rejected administrator cannot read another active profile', rejectedRead.ok && rejectedRead.rows.length === 0, `rows=${rejectedRead.rows?.length}`);

await asRole(db, 'owner');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
