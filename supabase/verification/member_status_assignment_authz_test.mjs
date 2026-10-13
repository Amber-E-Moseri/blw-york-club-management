// Member-status and assignment authorization tests (migrations 080–085), run on PGlite.
//
// Replays migrations 000–085 with the same harness as pglite_replay.mjs, then runs every case as a database role with
// the caller's identity set the way Supabase sets it (request.jwt.claim.sub). Row Level Security, SECURITY DEFINER
// functions and the trusted-role guards therefore decide each outcome. Positive controls are included, so a check that
// refuses everything cannot pass. Each check uses its own fixture so results do not depend on order.
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL, not the Auth or PostgREST layer. The real-session
// certification (real_session_authz_certification.mjs) is still required against a local Supabase stack.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/member_status_assignment_authz_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const LAST = '085_saved_group_members_active_only.sql';

const results = [];
const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence ?? '') });
const refused = (r, code) => !r.ok && (code === undefined || r.code === code);

const { db } = await openReplay(MIGRATIONS, { lastFile: LAST });

// ─── fixtures (owner bypasses RLS) ──────────────────────────────────────────
const people = {
  coordinator: ['coordinator', 'active'],
  coordinator2: ['coordinator', 'active'],
  admin: ['admin', 'active'],
  admin2: ['admin', 'active'],
  leader: ['cell_leader', 'active'],
  // Each member fixture below is used by one check only.
  memberDeact: ['member', 'active'],     // admin deactivates
  memberForged: ['member', 'active'],    // forged claims
  memberBlank: ['member', 'active'],     // blank reason
  memberDirect: ['member', 'active'],    // direct UPDATE attempt
  memberRejectTarget: ['member', 'active'],
  inactive: ['member', 'inactive'],      // previously approved, deactivated
  rejectedReopen: ['member', 'rejected'],
  rejectedDirect: ['member', 'rejected'],
  pending: ['member', 'pending'],
  asAssignee: ['member', 'active'],
  roleHolder: ['member', 'active'],      // holds an admin_role
};
const ids = {};
for (const label of Object.keys(people)) ids[label] = crypto.randomUUID();
for (const [label, [role, status]] of Object.entries(people)) {
  // Creating the auth user runs handle_new_user(), which creates a pending profile. Set the real role and status on it.
  await db.query('insert into auth.users (id, email, aud, role, created_at) values ($1, $2, $3, $4, now())',
    [ids[label], `${label}@test.example`, 'authenticated', 'authenticated']);
  await db.query('update public.profiles set full_name = $2, role = $3, status = $4 where id = $1',
    [ids[label], label, role, status]);
}
// A member-role account that holds an admin_role is staff for the status rule (048 treats admin_role the same way).
await db.query("update public.profiles set admin_role = 'content' where id = $1", [ids.roleHolder]);

const statusOf = async (label) => (await db.query('select status from public.profiles where id = $1', [ids[label]])).rows[0]?.status;
const auditOf = async (label) => (await db.query('select count(*)::int n from public.member_status_audit where member_id = $1', [ids[label]])).rows[0].n;
const setStatus = (asLabel, targetLabel, to, reason = 'Test reason') =>
  attempt(db, 'authenticated', ids[asLabel], 'select * from public.set_member_status($1::uuid, $2::text, $3::text)', [ids[targetLabel], to, reason]);

// ─── positive controls ──────────────────────────────────────────────────────
{
  const r = await setStatus('admin', 'memberDeact', 'inactive', 'Left the cell');
  check('admin can deactivate a member (active -> inactive) with a reason', r.ok && (await statusOf('memberDeact')) === 'inactive', r.error);
  check('a successful change writes one audit row', (await auditOf('memberDeact')) === 1);
}
{
  const r = await setStatus('coordinator', 'admin2', 'inactive', 'Stepped down');
  check('a coordinator can change an admin account', r.ok && (await statusOf('admin2')) === 'inactive', r.error);
}
{
  const r = await setStatus('admin', 'inactive', 'active', 'Returned after leave');
  check('a previously approved, deactivated member can be reactivated (inactive -> active)', r.ok && (await statusOf('inactive')) === 'active', r.error);
}
{
  const reopen = await setStatus('admin', 'rejectedReopen', 'pending', 'Reconsidering application');
  check('a rejected member can be reopened as pending (rejected -> pending)', reopen.ok && (await statusOf('rejectedReopen')) === 'pending', reopen.error);
  const approve = await attempt(db, 'authenticated', ids.admin, 'select * from public.approve_pending_member($1::uuid)', [ids.rejectedReopen]);
  check('the reopened member is activated through approve_pending_member (the approval path)', approve.ok && (await statusOf('rejectedReopen')) === 'active', approve.error);
}

// ─── staff accounts ─────────────────────────────────────────────────────────
{
  // admin2 was deactivated by the coordinator control above. A real change (to active) is attempted, so the refusal
  // comes from the staff rule and not from the already-has-that-status check.
  const r = await setStatus('admin', 'admin2', 'active', 'Attempted peer change');
  check('an admin cannot change another admin account', refused(r, '42501') && (await statusOf('admin2')) === 'inactive', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'admin2', 'inactive', 'Same-status probe');
  check('a refused admin gets the authorization error even when the requested status is the current one (no status leak)', refused(r, '42501'), `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'roleHolder', 'inactive', 'Admin-role holder');
  check('an admin cannot change an account that holds an admin_role (staff by admin_role)', refused(r, '42501') && (await statusOf('roleHolder')) === 'active', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('coordinator', 'roleHolder', 'inactive', 'Admin-role holder');
  check('a coordinator can change an account that holds an admin_role', r.ok && (await statusOf('roleHolder')) === 'inactive', r.error);
}
{
  const r = await setStatus('admin', 'coordinator2', 'inactive', 'Attempted coordinator change');
  check('an admin cannot change a coordinator account', refused(r, '42501') && (await statusOf('coordinator2')) === 'active', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('coordinator', 'coordinator2', 'inactive', 'Attempted peer change');
  check('a coordinator cannot change another coordinator account', refused(r, '42501') && (await statusOf('coordinator2')) === 'active', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('coordinator', 'coordinator', 'inactive', 'Self change');
  check('no one changes their own status (self-change refused)', refused(r, '42501') && (await statusOf('coordinator')) === 'active', `${r.code} ${r.error}`);
}

// ─── approval cannot be bypassed ────────────────────────────────────────────
{
  const r = await setStatus('admin', 'rejectedDirect', 'active', 'Skip approval');
  check('a rejected member cannot be reactivated directly (rejected -> active refused)', refused(r, 'P0001') && (await statusOf('rejectedDirect')) === 'rejected', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'pending', 'inactive', 'Skip approval');
  check('a pending account cannot be deactivated here (pending -> inactive refused)', refused(r, 'P0001') && (await statusOf('pending')) === 'pending', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'pending', 'active', 'Skip approval');
  check('a pending account cannot be activated here (pending -> active refused)', refused(r, 'P0001') && (await statusOf('pending')) === 'pending', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'memberRejectTarget', 'rejected', 'Wrong path');
  check('an active member cannot be set to rejected here (active -> rejected refused)', refused(r, 'P0001') && (await statusOf('memberRejectTarget')) === 'active', `${r.code} ${r.error}`);
}

// ─── input and audit ────────────────────────────────────────────────────────
{
  const r = await setStatus('admin', 'memberBlank', 'inactive', '   ');
  check('a blank reason is refused', refused(r, '22023') && (await statusOf('memberBlank')) === 'active', `${r.code} ${r.error}`);
}
{
  const r = await setStatus('admin', 'memberBlank', 'deleted', 'Invalid status');
  check('an unknown status value is refused', refused(r, '22023') && (await statusOf('memberBlank')) === 'active', `${r.code} ${r.error}`);
}
{
  const before = await auditOf('memberBlank');
  await setStatus('admin', 'memberBlank', 'inactive', '   ');
  check('a refused change writes no audit row', (await auditOf('memberBlank')) === before);
}

// ─── identity cannot be spoofed ─────────────────────────────────────────────
{
  const r = await setStatus('memberForged', 'memberForged', 'inactive', 'Member acting on self');
  check('a plain member cannot call set_member_status (not admin or coordinator)', refused(r, '42501') && (await statusOf('memberForged')) === 'active', `${r.code} ${r.error}`);
}
{
  await attempt(db, 'authenticated', ids.memberForged, `select set_config('request.jwt.claims', '{"role":"coordinator","sub":"${ids.memberForged}"}', false)`);
  const r = await attempt(db, 'authenticated', ids.memberForged, 'select * from public.set_member_status($1::uuid, $2::text, $3::text)', [ids.memberRejectTarget, 'inactive', 'Forged claim']);
  check('a forged JWT role claim does not grant staff rights (authority is the profile row)', refused(r, '42501') && (await statusOf('memberRejectTarget')) === 'active', `${r.code} ${r.error}`);
  await db.exec("select set_config('request.jwt.claims', '', false)");
}
{
  const r = await attempt(db, 'anon', null, 'select * from public.set_member_status($1::uuid, $2::text, $3::text)', [ids.memberDirect, 'inactive', 'Anonymous']);
  check('anonymous callers cannot execute set_member_status', !r.ok, r.error);
}
{
  await attempt(db, 'authenticated', ids.admin, 'update public.profiles set status = $2 where id = $1', [ids.memberDirect, 'inactive']);
  check('direct UPDATE of profiles.status by an admin changes nothing (set_member_status is the only path)', (await statusOf('memberDirect')) === 'active');
}

// ─── saved groups: members must be active (079 rule, enforced on the table by 084) ───
{
  const grp = crypto.randomUUID();
  await db.query("insert into public.saved_groups (id, name, created_by, is_active) values ($1, 'Test group', $2, true)", [grp, ids.admin]);
  const ok = await attempt(db, 'authenticated', ids.admin, 'insert into public.saved_group_members (group_id, profile_id, added_by) values ($1, $2, $3)', [grp, ids.memberDirect, ids.admin]);
  check('staff can add an active member to a saved group by direct insert (control)', ok.ok, ok.error);
  const pending = await attempt(db, 'authenticated', ids.admin, 'insert into public.saved_group_members (group_id, profile_id, added_by) values ($1, $2, $3)', [grp, ids.pending, ids.admin]);
  check('staff cannot add a pending account to a saved group by direct insert', refused(pending, '22023'), `${pending.code} ${pending.error}`);
  const rejected = await attempt(db, 'authenticated', ids.coordinator, 'insert into public.saved_group_members (group_id, profile_id, added_by) values ($1, $2, $3)', [grp, ids.rejectedDirect, ids.coordinator]);
  check('a coordinator cannot add a rejected account to a saved group by direct insert', refused(rejected, '22023'), `${rejected.code} ${rejected.error}`);
  const count = (await db.query('select count(*)::int n from public.saved_group_members where group_id = $1 and profile_id = $2', [grp, ids.pending])).rows[0].n;
  check('the refused pending account is not stored in the group', count === 0);
}

// ─── assignments: assignee restrictions ─────────────────────────────────────
const taskId = crypto.randomUUID();
await db.query(
  `insert into public.assignments (id, title, description, assigned_to, assigned_by, status, priority)
   values ($1, 'Follow up', 'Call the member', $2, $3, 'pending', 'normal')`,
  [taskId, ids.asAssignee, ids.coordinator],
);
const task = async () => (await db.query('select title, status, reviewed_at, assigned_to from public.assignments where id = $1', [taskId])).rows[0];
const asAssignee = (sql, params = []) => attempt(db, 'authenticated', ids.asAssignee, sql, params);

{
  const r = await asAssignee("update public.assignments set status = 'in_progress' where id = $1", [taskId]);
  check('assignee can advance their own task status (control)', r.ok && (await task()).status === 'in_progress', r.error);
}
{
  const r = await asAssignee("update public.assignments set title = 'Changed by assignee' where id = $1", [taskId]);
  check('assignee cannot rewrite the task title', refused(r, '42501') && (await task()).title === 'Follow up', `${r.code} ${r.error}`);
}
{
  const r = await asAssignee('update public.assignments set reviewed_at = now() where id = $1', [taskId]);
  check('assignee cannot mark their own task reviewed', refused(r, '42501') && (await task()).reviewed_at === null, `${r.code} ${r.error}`);
}
{
  const r = await asAssignee('update public.assignments set assigned_to = $2 where id = $1', [taskId, ids.memberDirect]);
  check('assignee cannot reassign the task to someone else', !r.ok && (await task()).assigned_to === ids.asAssignee, `${r.code} ${r.error}`);
}
{
  await db.query("update public.assignments set status = 'completed' where id = $1", [taskId]);
  const r = await asAssignee("update public.assignments set status = 'pending' where id = $1", [taskId]);
  check('assignee cannot change a completed task (RLS), and the row is unchanged', (await task()).status === 'completed', `${r.ok} ${r.error ?? ''}`);
}

// ─── assignments: trusted and manager operations ────────────────────────────
{
  await db.query("update public.assignments set status = 'pending' where id = $1", [taskId]);
  const r = await attempt(db, 'authenticated', ids.coordinator, "update public.assignments set title = 'Renamed by coordinator' where id = $1", [taskId]);
  check('coordinator can edit a task (manager control)', r.ok && (await task()).title === 'Renamed by coordinator', r.error);
}
{
  const r = await attempt(db, 'service_role', null, "update public.assignments set title = 'Trusted backfill' where id = $1", [taskId]);
  check('a trusted service_role maintenance write is allowed', r.ok && (await task()).title === 'Trusted backfill', r.error);
}
{
  const r = await attempt(db, 'owner', null, "update public.assignments set description = 'Repair from SQL editor' where id = $1", [taskId]);
  check('a database-owner repair is allowed', r.ok, r.error);
}
{
  await attempt(db, 'authenticated', ids.asAssignee, `select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  const forged = await asAssignee("update public.assignments set title = 'Forged service role' where id = $1", [taskId]);
  check('a forged JWT role claim of service_role does not bypass the assignee guard', refused(forged, '42501') && (await task()).title !== 'Forged service role', `${forged.code} ${forged.error}`);
  await db.exec("select set_config('request.jwt.claims', '', false)");
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -- ${r.evidence}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
