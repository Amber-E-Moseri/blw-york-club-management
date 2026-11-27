// Shared audience infrastructure (migration 061) on PGlite, full chain. Positive and negative authorization controls.
// Writes that RLS filters return zero rows, so each is verified by a read through the owner connection.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/audience_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [audience061] ${name}${detail ? ' :: ' + String(detail).slice(0, 170) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  coord: 'f0000000-0000-4000-8000-000000000001', memberA: 'f0000000-0000-4000-8000-000000000002',
  memberB: 'f0000000-0000-4000-8000-000000000003', pending: 'f0000000-0000-4000-8000-000000000004',
  rejected: 'f0000000-0000-4000-8000-000000000005', inactive: 'f0000000-0000-4000-8000-000000000006',
  member: 'f0000000-0000-4000-8000-000000000007',
};
const CELL_A = 'f1000000-0000-4000-8000-00000000000a', CELL_B = 'f1000000-0000-4000-8000-00000000000b';
const G_ACTIVE = 'f2000000-0000-4000-8000-000000000001', G_INACTIVE = 'f2000000-0000-4000-8000-000000000002';
const S = { all: 'f3000000-0000-4000-8000-000000000001', cells: 'f3000000-0000-4000-8000-000000000002', explicit: 'f3000000-0000-4000-8000-000000000003', groups: 'f3000000-0000-4000-8000-000000000004', inactiveGroup: 'f3000000-0000-4000-8000-000000000005' };

for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.aud061@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.memberA]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.memberB]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.member]);
await owner(`update public.profiles set role='member', status='rejected' where id=$1`, [U.rejected]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactive]);
await owner(`insert into public.cells (id,name) values ($1,'A'),($2,'B')`, [CELL_A, CELL_B]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL_A, U.memberA]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL_B, U.memberB]);
await owner(`insert into public.saved_groups (id,name,created_by,is_active) values ($1,'Active group',$2,true),($3,'Retired group',$2,false)`, [G_ACTIVE, U.coord, G_INACTIVE]);
await owner(`insert into public.saved_group_members (group_id,profile_id,added_by) values ($1,$2,$3),($1,$4,$3),($5,$4,$3)`, [G_ACTIVE, U.memberA, U.coord, U.memberB, G_INACTIVE]);
const mk = (id, mode, extra) => owner(`insert into public.audience_specs (id,mode,cell_ids,group_ids,profile_ids,created_by) values ($1,$2,$3,$4,$5,$6)`, [id, mode, extra.cells ?? null, extra.groups ?? null, extra.profiles ?? null, U.coord]);
await mk(S.all, 'all', {});
await mk(S.cells, 'cells', { cells: [CELL_A] });
await mk(S.explicit, 'explicit', { profiles: [U.memberB] });
await mk(S.groups, 'saved_groups', { groups: [G_ACTIVE] });
await mk(S.inactiveGroup, 'saved_groups', { groups: [G_INACTIVE] });
const resolved = async (spec, uid = U.coord, role = 'authenticated') => {
  const r = await as(uid, `select profile_id from public.resolve_audience($1)`, [spec], role);
  return r.ok ? new Set(r.rows.map((x) => x.profile_id)) : { error: r.error };
};

// Positive: staff resolve each mode correctly and never include non-active accounts.
let s = await resolved(S.all);
check("'all' resolves to every active account, and excludes pending, rejected and inactive", s instanceof Set && s.has(U.memberA) && s.has(U.memberB) && s.has(U.coord) && !s.has(U.pending) && !s.has(U.rejected) && !s.has(U.inactive), s.error ?? [...(s.size ? s : [])].length);
s = await resolved(S.cells);
check("'cells' resolves only to members of the named cell", s instanceof Set && s.has(U.memberA) && !s.has(U.memberB), s.error);
s = await resolved(S.explicit);
check("'explicit' resolves only to the named profile", s instanceof Set && s.size === 1 && s.has(U.memberB), s.error);
s = await resolved(S.groups);
check("'saved_groups' resolves to the active group's members", s instanceof Set && s.has(U.memberA) && s.has(U.memberB) && s.size === 2, s.error);
s = await resolved(S.inactiveGroup);
check("'saved_groups' with a retired group resolves to nobody", s instanceof Set && s.size === 0, s.error);
s = await resolved(S.all, null, 'service_role');
check('the dispatch service (service_role) may resolve an audience', s instanceof Set && s.has(U.memberA), s.error);

// Positive: an active member reads active groups; staff read memberships.
let r = await as(U.memberA, `select id from public.saved_groups`);
check('an active member reads active saved groups (names only, no membership)', r.ok && r.rows.some((x) => x.id === G_ACTIVE) && !r.rows.some((x) => x.id === G_INACTIVE), r.error);
r = await as(U.coord, `select profile_id from public.saved_group_members`);
check('a coordinator reads saved-group membership', r.ok && r.rows.length === 3, r.error ?? r.rows.length);

// Negative: ordinary, pending and rejected accounts cannot enumerate audiences or memberships.
for (const [label, uid] of [['an ordinary member', U.member], ['a pending account', U.pending], ['a rejected account', U.rejected]]) {
  r = await as(uid, `select profile_id from public.resolve_audience($1)`, [S.all]);
  check(`negative: ${label} cannot resolve an audience`, !r.ok || r.rows.length === 0, r.error ?? `returned ${r.rows.length} rows`);
}
r = await as(U.pending, `select id from public.saved_groups`);
check('negative: a pending account reads no saved groups', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.rejected, `select id from public.saved_groups`);
check('negative: a rejected account reads no saved groups', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.member, `select profile_id from public.saved_group_members`);
check('negative: an ordinary member reads no saved-group membership', r.ok && r.rows.length === 0, r.error ?? r.rows.length);
r = await as(null, `select id from public.saved_groups`, [], 'anon');
check('negative: anonymous visitors read no saved groups', !r.ok || r.rows.length === 0, r.error ?? r.rows.length);
r = await as(U.member, `insert into public.audience_specs (mode, profile_ids, created_by) values ('explicit', $1, $2)`, [[U.member], U.member]);
check('negative: an ordinary member cannot create an audience spec', r.ok === false, r.error ?? 'created');
r = await as(U.member, `insert into public.saved_groups (name, created_by, is_active) values ('Mine', $1, true)`, [U.member]);
check('negative: an ordinary member cannot create a saved group', r.ok === false, r.error ?? 'created');

// Negative: audience specs are immutable after creation.
r = await as(U.coord, `update public.audience_specs set mode='all' where id=$1`, [S.explicit]);
const mode = (await owner(`select mode from public.audience_specs where id=$1`, [S.explicit])).rows[0].mode;
check('negative: an audience spec cannot be updated after creation', mode === 'explicit', r.error ?? `now ${mode}`);

const failed = results.filter((x) => !x).length;
console.log(`\nAUDIENCE 061 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
