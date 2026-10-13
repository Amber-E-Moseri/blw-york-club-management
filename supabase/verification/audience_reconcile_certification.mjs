// Audience reconciliation certification: real database roles, real RLS, real RPCs.
//
// Usage (after installing PGlite somewhere; see pglite_replay.mjs):
//   PGLITE_MODULE=file:///.../node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/audience_reconcile_certification.mjs [migrationsDir]
//
// Exits non-zero on any FAIL. Each check runs as the role a real client would use (authenticated with a JWT
// subject, anon, service_role or the owner). Fixtures are created inside a fresh database each run.

import path from 'path';
import { fileURLToPath } from 'url';
import { openReplay, attempt, asRole } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.argv[2] ?? path.join(here, '..', 'migrations');

const results = [];
const record = (area, name, ok, evidence = '') => {
  results.push({ area, name, ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${area.padEnd(14)} ${name}${evidence ? `  [${evidence}]` : ''}`);
};
const expectDenied = (area, name, r, code = null) => {
  const ok = !r.ok && (code === null || r.code === code);
  record(area, name, ok, r.ok ? 'statement succeeded' : `${r.code}: ${r.error.slice(0, 90)}`);
};
const expectAllowed = (area, name, r, evidence = '') => record(area, name, r.ok, r.ok ? evidence : r.error.slice(0, 120));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = uid(1), LA = uid(2), LB = uid(3), LC = uid(4);
const A1 = uid(11), A2 = uid(12), B1 = uid(13), PEND = uid(14), REJ = uid(15);
const CELL_A = uid(21), CELL_B = uid(22), CELL_C = uid(23);
const G = uid(31), H = uid(32);

const arr = (xs) => (xs === null || xs === undefined ? null : `{${xs.join(',')}}`);
const count = async (db, sql, params = []) => (await db.query(sql, params)).rows[0].n;

async function createSpec(db, role, who, mode, o = {}) {
  return attempt(db, role, who,
    `select public.create_audience_spec($1, $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[]) as id`,
    [mode, arr(o.cells ?? null), arr(o.groups ?? null), arr(o.profiles ?? null),
      arr(o.xcells ?? null), arr(o.xgroups ?? null), arr(o.xprofiles ?? null)]);
}

/** Recipients of a spec, computed by the owner (internal resolver, bypasses RLS). */
async function recipients(db, specId) {
  const r = await db.query('select profile_id from public.resolve_audience_all($1) order by 1', [specId]);
  return r.rows.map((x) => x.profile_id).sort();
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === [...b].sort()[i]);

async function main() {
  const { db, applied } = await openReplay(migrationsDir);
  console.log(`replayed ${applied.length} migrations from ${path.relative(process.cwd(), migrationsDir)}\n`);

  // ── Fixtures (owner). handle_new_user creates the profile; we upsert the app fields. ─────────
  await db.exec(`
    insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
    select v.id::uuid, v.id || '@cert.invalid', 'x', 'authenticated', 'authenticated', now(), now()
    from (values ('${ADMIN}'),('${LA}'),('${LB}'),('${LC}'),('${A1}'),('${A2}'),('${B1}'),('${PEND}'),('${REJ}')) v(id);
    insert into public.profiles (id, email, full_name, role, status, cell_id) values
      ('${ADMIN}','admin@cert.invalid','Admin','coordinator','active',null),
      ('${LA}','la@cert.invalid','Leader A','cell_leader','active','${CELL_A}'),
      ('${LB}','lb@cert.invalid','Leader B','cell_leader','active','${CELL_B}'),
      ('${LC}','lc@cert.invalid','Leader C','cell_leader','active',null),
      ('${A1}','a1@cert.invalid','A1','member','active','${CELL_A}'),
      ('${A2}','a2@cert.invalid','A2','member','active','${CELL_A}'),
      ('${B1}','b1@cert.invalid','B1','member','active','${CELL_B}'),
      ('${PEND}','pend@cert.invalid','Pending','member','active',null),
      ('${REJ}','rej@cert.invalid','Rejected','member','rejected',null)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
      status = excluded.status, cell_id = excluded.cell_id;
    insert into public.cells (id, name, leader_id) values
      ('${CELL_A}','A','${LA}'),('${CELL_B}','B','${LB}'),('${CELL_C}','C (no members)','${LC}');
    insert into public.saved_groups (id, name, created_by, is_active) values
      ('${G}','Group G','${ADMIN}',true),('${H}','Group H','${ADMIN}',true);
    insert into public.saved_group_members (group_id, profile_id, added_by) values
      ('${G}','${A1}','${ADMIN}'),('${G}','${B1}','${ADMIN}'),('${G}','${PEND}','${ADMIN}'),('${H}','${A2}','${ADMIN}');
    -- 085 requires saved-group members to be active at INSERT time. The pending state is applied afterwards, so the
    -- stored membership of PEND exists and the audience resolver must still exclude it.
    update public.profiles set status = 'pending' where id = '${PEND}';
  `);

  const activeIds = [ADMIN, LA, LB, LC, A1, A2, B1].sort();

  // ── 1. Unauthorized enumeration ────────────────────────────────────────────────────────────
  const specAll = await createSpec(db, 'authenticated', ADMIN, 'all');
  expectAllowed('enumeration', 'admin creates an all-active spec via create_audience_spec', specAll);
  const allId = specAll.rows[0].id;

  const memberResolve = await attempt(db, 'authenticated', A1,
    `select profile_id from public.resolve_audience($1)`, [allId]);
  record('enumeration', 'member resolve_audience(all-spec) returns only their own row',
    memberResolve.ok && memberResolve.rows.length === 1 && memberResolve.rows[0].profile_id === A1,
    memberResolve.ok ? `rows=${memberResolve.rows.length}` : memberResolve.error);

  expectDenied('enumeration', 'member cannot call resolve_audience_all', await attempt(db, 'authenticated', A1,
    `select profile_id from public.resolve_audience_all($1)`, [allId]));

  expectDenied('enumeration', 'anon cannot call resolve_audience', await attempt(db, 'anon', null,
    `select profile_id from public.resolve_audience($1)`, [allId]));

  const pendingResolve = await attempt(db, 'authenticated', PEND,
    `select count(*)::int n from public.resolve_audience($1)`, [allId]);
  record('enumeration', 'pending member resolves to nothing', pendingResolve.ok && pendingResolve.rows[0].n === 0,
    pendingResolve.ok ? `rows=${pendingResolve.rows[0].n}` : pendingResolve.error);

  const memberSpecs = await attempt(db, 'authenticated', A1, `select count(*)::int n from public.audience_specs`);
  record('enumeration', 'member cannot read audience_specs', memberSpecs.ok && memberSpecs.rows[0].n === 0,
    memberSpecs.ok ? `rows=${memberSpecs.rows[0].n}` : memberSpecs.error);

  const memberGroupMembers = await attempt(db, 'authenticated', A1,
    `select count(*)::int n from public.saved_group_members`);
  record('enumeration', 'member cannot read saved-group memberships',
    memberGroupMembers.ok && memberGroupMembers.rows[0].n === 0, memberGroupMembers.ok ? `rows=${memberGroupMembers.rows[0].n}` : memberGroupMembers.error);

  expectDenied('enumeration', 'member cannot insert an audience spec directly', await attempt(db, 'authenticated', A1,
    `insert into public.audience_specs (mode, cell_ids, created_by) values ('cells', array[$1]::uuid[], $2)`,
    [CELL_A, A1]), '42501');

  expectDenied('enumeration', 'member cannot create a spec through the RPC', await createSpec(db, 'authenticated', A1, 'cells', { cells: [CELL_A] }), '42501');

  expectDenied('enumeration', 'member cannot delete a saved group', await attempt(db, 'authenticated', ADMIN,
    `delete from public.saved_groups where id = $1`, [H]), '42501');

  // ── 2. Audience types and deduplication (real RPC, recipients checked by owner resolver) ──
  const specCells = await createSpec(db, 'authenticated', LA, 'cells', { cells: [CELL_A] });
  expectAllowed('audience types', 'leader creates a spec for own cell', specCells);
  record('audience types', 'cells spec resolves to active members of cell A (leader A, A1, A2)',
    sameSet(await recipients(db, specCells.rows[0].id), [LA, A1, A2].sort()));

  const specGroup = await createSpec(db, 'authenticated', ADMIN, 'saved_groups', { groups: [G] });
  expectAllowed('audience types', 'admin creates a saved-group spec', specGroup);
  record('audience types', 'group spec excludes the pending member',
    sameSet(await recipients(db, specGroup.rows[0].id), [A1, B1].sort()));

  const specExplicit = await createSpec(db, 'authenticated', ADMIN, 'explicit', { profiles: [A1, PEND] });
  expectAllowed('audience types', 'explicit spec naming a pending person with an active person is accepted', specExplicit);
  record('audience types', 'explicit spec drops the pending person at resolution',
    sameSet(await recipients(db, specExplicit.rows[0].id), [A1]));

  const specComposite = await createSpec(db, 'authenticated', ADMIN, 'composite',
    { cells: [CELL_A], groups: [G], profiles: [B1] });
  expectAllowed('audience types', 'composite spec (cell + group + person) accepted', specComposite);
  const compositeSet = await recipients(db, specComposite.rows[0].id);
  record('deduplication', 'overlapping cell, group and person reach each person exactly once',
    sameSet(compositeSet, [LA, A1, A2, B1].sort()) && new Set(compositeSet).size === compositeSet.length,
    `count=${compositeSet.length}`);

  const specExcl = await createSpec(db, 'authenticated', ADMIN, 'all', { xcells: [CELL_B], xprofiles: [A2] });
  expectAllowed('exclusion', 'all-minus-cell-B-minus-person spec accepted', specExcl);
  record('exclusion', 'exclusions remove cell B and A2 from everyone',
    sameSet(await recipients(db, specExcl.rows[0].id), [ADMIN, LA, LC, A1].sort()));

  expectDenied('audience types', 'mode all with included kinds is refused (no silent broadcast)',
    await createSpec(db, 'authenticated', ADMIN, 'all', { cells: [CELL_A] }), '22023');

  expectDenied('audience types', 'archived group cannot seed a new spec', await (async () => {
    await db.exec(`update public.saved_groups set is_active = false where id = '${H}'`);
    return createSpec(db, 'authenticated', ADMIN, 'saved_groups', { groups: [H] });
  })(), '22023');
  await db.exec(`update public.saved_groups set is_active = true where id = '${H}'`);

  // ── 3. Cross-cell isolation for leaders ───────────────────────────────────────────────────
  expectDenied('cross-cell', 'leader A cannot target cell B', await createSpec(db, 'authenticated', LA, 'cells', { cells: [CELL_B] }), '42501');
  expectDenied('cross-cell', 'leader A cannot target a group', await createSpec(db, 'authenticated', LA, 'saved_groups', { groups: [G] }), '42501');
  expectDenied('cross-cell', 'leader A cannot create a composite spec', await createSpec(db, 'authenticated', LA, 'composite', { cells: [CELL_A], profiles: [B1] }), '42501');
  expectDenied('cross-cell', 'leader A cannot use exclusions', await createSpec(db, 'authenticated', LA, 'cells', { cells: [CELL_A], xprofiles: [A2] }), '42501');
  expectDenied('cross-cell', 'leader A cannot target everyone', await createSpec(db, 'authenticated', LA, 'all'), '42501');
  expectDenied('cross-cell', 'leader A cannot pass two cells, one of them their own', await createSpec(db, 'authenticated', LA, 'cells', { cells: [CELL_A, CELL_B] }), '42501');
  expectDenied('audience types', 'leader of an empty cell cannot create an audience nobody can reach',
    await createSpec(db, 'authenticated', LC, 'cells', { cells: [CELL_C] }), '22023');

  // ── 4. Content publication: targeted visibility and isolation ─────────────────────────────
  const annCellA = await attempt(db, 'authenticated', LA,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
     values ('Cell A news', 'body', $1, 'Leader A', $2) returning id`, [LA, specCells.rows[0].id]);
  expectAllowed('publication', 'leader A publishes to their own cell', annCellA);
  const annCellAId = annCellA.rows?.[0]?.id;

  const seeA1 = await attempt(db, 'authenticated', A1, `select count(*)::int n from public.announcements where id = $1`, [annCellAId]);
  record('isolation', 'cell A member sees the cell A announcement', seeA1.ok && seeA1.rows[0].n === 1);
  const seeB1 = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.announcements where id = $1`, [annCellAId]);
  record('isolation', 'cell B member does not see the cell A announcement', seeB1.ok && seeB1.rows[0].n === 0);
  const seePend = await attempt(db, 'authenticated', PEND, `select count(*)::int n from public.announcements where id = $1`, [annCellAId]);
  record('isolation', 'pending cell A member does not see it', seePend.ok && seePend.rows[0].n === 0);

  expectDenied('publication', 'leader A cannot post a broadcast (no spec)', await attempt(db, 'authenticated', LA,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id) values ('bcast','b',$1,'LA',null)`, [LA]), '42501');
  expectDenied('publication', 'leader A cannot post to cell B', await attempt(db, 'authenticated', LA,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id) values ('x','b',$1,'LA',$2)`,
    [LA, (await createSpec(db, 'authenticated', ADMIN, 'cells', { cells: [CELL_B] })).rows[0].id]), '42501');

  const annAll = await attempt(db, 'authenticated', ADMIN,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id) values ('Fellowship','b',$1,'Admin',null) returning id`, [ADMIN]);
  expectAllowed('publication', 'admin posts a fellowship-wide broadcast (explicit NULL spec)', annAll);
  const seeBroadcast = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.announcements where id = $1`, [annAll.rows[0].id]);
  record('publication', 'broadcast is visible to every active member', seeBroadcast.ok && seeBroadcast.rows[0].n === 1);

  // Affirmations (confessions): targeted to group G, declaration guard.
  const groupSpecId = specGroup.rows[0].id;
  const conf = await attempt(db, 'authenticated', ADMIN,
    `insert into public.confessions (title, body, scheduled_date, created_by, audience_spec_id)
     values ('Group affirmation','body','2026-10-14',$1,$2) returning id`, [ADMIN, groupSpecId]);
  expectAllowed('affirmations', 'admin publishes an affirmation to group G', conf);
  const confId = conf.rows[0].id;
  const confSeeB1 = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.confessions where id = $1`, [confId]);
  record('isolation', 'group member sees the targeted affirmation', confSeeB1.ok && confSeeB1.rows[0].n === 1);
  const confSeeA2 = await attempt(db, 'authenticated', A2, `select count(*)::int n from public.confessions where id = $1`, [confId]);
  record('isolation', 'non-recipient A2 does not see the targeted affirmation', confSeeA2.ok && confSeeA2.rows[0].n === 0);
  expectDenied('affirmations', 'non-recipient cannot declare the affirmation', await attempt(db, 'authenticated', A2,
    `insert into public.confession_declarations (confession_id, user_id) values ($1, $2)`, [confId, A2]), '42501');
  expectAllowed('affirmations', 'recipient can declare the affirmation', await attempt(db, 'authenticated', B1,
    `insert into public.confession_declarations (confession_id, user_id) values ($1, $2)`, [confId, B1]));

  // Events: targeted to explicit A1; legacy broadcast stays visible.
  const specA1 = await createSpec(db, 'authenticated', ADMIN, 'explicit', { profiles: [A1] });
  const ev = await attempt(db, 'authenticated', ADMIN,
    `insert into public.events (title, date, time, location, created_by, audience, audience_spec_id)
     values ('Private event','2026-11-01','10:00','hall',$1,'explicit',$2) returning id`, [ADMIN, specA1.rows[0].id]);
  expectAllowed('events', 'admin creates a targeted event', ev);
  const evId = ev.rows[0].id;
  const evSeeA1 = await attempt(db, 'authenticated', A1, `select count(*)::int n from public.events where id = $1`, [evId]);
  record('isolation', 'targeted event is visible to its recipient', evSeeA1.ok && evSeeA1.rows[0].n === 1);
  const evSeeB1 = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.events where id = $1`, [evId]);
  record('isolation', 'targeted event is not visible to a non-recipient', evSeeB1.ok && evSeeB1.rows[0].n === 0);

  const legacy = await attempt(db, 'authenticated', ADMIN,
    `insert into public.events (title, date, time, location, created_by, audience)
     values ('Fellowship event','2026-11-02','10:00','hall',$1,'all') returning id`, [ADMIN]);
  const legacyId = legacy.rows?.[0]?.id;
  const legacySeen = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.events where id = $1`, [legacyId]);
  record('publication', 'fellowship event (audience all, no spec) is visible to members', legacySeen.ok && legacySeen.rows[0].n === 1);

  // Refuse publication when the audience has emptied since the spec was created (fail closed, no broadcast).
  await db.exec(`update public.profiles set status = 'pending' where id = '${A1}'`);
  expectDenied('publication', 'targeted event refused when its audience now resolves to nobody', await attempt(db, 'authenticated', ADMIN,
    `insert into public.events (title, date, time, location, created_by, audience, audience_spec_id)
     values ('Ghost','2026-11-03','10:00','hall',$1,'explicit',$2)`, [ADMIN, specA1.rows[0].id]), '22023');
  await db.exec(`update public.profiles set status = 'active' where id = '${A1}'`);

  // ── 5. Membership changes after publication ───────────────────────────────────────────────
  const annG = await attempt(db, 'authenticated', ADMIN,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
     values ('Group G news','b',$1,'Admin',$2) returning id`, [ADMIN, groupSpecId]);
  expectAllowed('membership', 'announcement to group G published', annG);
  const annGId = annG.rows[0].id;

  await db.exec(`insert into public.saved_group_members (group_id, profile_id, added_by) values ('${G}','${A2}','${ADMIN}')`);
  const joinedLate = await attempt(db, 'authenticated', A2, `select count(*)::int n from public.announcements where id = $1`, [annGId]);
  record('membership', 'person added to the group AFTER publication cannot see it (snapshot)', joinedLate.ok && joinedLate.rows[0].n === 0);

  await db.exec(`delete from public.saved_group_members where group_id = '${G}' and profile_id = '${B1}'`);
  const leftGroup = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.announcements where id = $1`, [annGId]);
  record('membership', 'person removed from the group keeps access they were given at publication', leftGroup.ok && leftGroup.rows[0].n === 1);

  await db.exec(`update public.profiles set cell_id = '${CELL_B}' where id = '${A2}'`);
  const movedIn = await attempt(db, 'authenticated', A2, `select count(*)::int n from public.announcements where id = $1`, [annCellAId]);
  record('membership', 'member moved to another cell keeps access to earlier cell A content', movedIn.ok && movedIn.rows[0].n === 1);
  const movedInB = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.announcements where id = $1`, [annCellAId]);
  record('membership', 'cell B member still cannot see cell A content', movedInB.ok && movedInB.rows[0].n === 0);

  await db.exec(`update public.profiles set status = 'rejected' where id = '${B1}'`);
  const rejectedNow = await attempt(db, 'authenticated', B1, `select count(*)::int n from public.announcements where id = $1`, [annGId]);
  record('membership', 'rejected recipient loses access even with a snapshot row', rejectedNow.ok && rejectedNow.rows[0].n === 0);
  await db.exec(`update public.profiles set status = 'active' where id = '${B1}'`);

  // ── 6. Immutability and deletion ─────────────────────────────────────────────────────────
  expectDenied('immutability', 'announcement audience cannot be re-pointed after publication', await attempt(db, 'authenticated', LA,
    `update public.announcements set audience_spec_id = $1 where id = $2`, [allId, annCellAId]), '42501');
  expectDenied('immutability', 'announcement audience cannot be cleared to a broadcast', await attempt(db, 'authenticated', ADMIN,
    `update public.announcements set audience_spec_id = null where id = $1`, [annGId]), '42501');
  expectDenied('immutability', 'event audience cannot be changed after publication', await attempt(db, 'authenticated', ADMIN,
    `update public.events set audience = 'all' where id = $1`, [evId]), '42501');
  expectDenied('immutability', 'audience spec cannot be updated by any client', await attempt(db, 'authenticated', ADMIN,
    `update public.audience_specs set mode = 'all' where id = $1`, [specCells.rows[0].id]), '42501');
  expectDenied('immutability', 'audience spec cannot be deleted by the owner role while content references it', await attempt(db, 'owner', null,
    `delete from public.audience_specs where id = $1`, [specCells.rows[0].id]));
  record('immutability', 'published cell A content still reads its original cell A audience after the attempts',
    (await count(db, `select count(*)::int n from public.announcements where id = $1 and audience_spec_id is not null`, [annCellAId])) === 1);

  // Archiving a group does not change content already published to it, and cannot seed new content.
  const archivedSpecId = (await createSpec(db, 'authenticated', ADMIN, 'saved_groups', { groups: [H] })).rows[0].id;
  const hAnn = await attempt(db, 'authenticated', ADMIN,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
     values ('Group H news','b',$1,'Admin',$2) returning id`, [ADMIN, archivedSpecId]);
  await db.exec(`update public.saved_groups set is_active = false where id = '${H}'`);
  const hSeen = await attempt(db, 'authenticated', A2, `select count(*)::int n from public.announcements where id = $1`, [hAnn.rows[0].id]);
  record('immutability', 'archiving a group keeps the snapshot readable by its recipient', hSeen.ok && hSeen.rows[0].n === 1);
  expectDenied('immutability', 'archived group cannot be used to publish new targeted content', await attempt(db, 'authenticated', ADMIN,
    `insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
     values ('H again','b',$1,'Admin',$2)`, [ADMIN, archivedSpecId]), '22023');

  // ── 7. Consumers: notify and messaging paths ─────────────────────────────────────────────
  const notifyRows = await attempt(db, 'service_role', null,
    `select count(*)::int n from public.audience_content_recipients('event', $1)`, [evId]);
  record('notify', 'service role reads the frozen recipients of a targeted event',
    notifyRows.ok && notifyRows.rows[0].n === 1, notifyRows.ok ? `rows=${notifyRows.rows[0].n}` : notifyRows.error);
  expectDenied('notify', 'authenticated user cannot read another item’s recipients', await attempt(db, 'authenticated', B1,
    `select count(*) from public.audience_content_recipients('event', $1)`, [evId]), '42501');

  const msgExplicit = await attempt(db, 'authenticated', ADMIN,
    `select public.send_message($1,$2,$3,$4::uuid[],$5::uuid[],$6::uuid[],$7::text[],$8::uuid) as id`,
    ['Hello', 'Only A1', 'explicit', null, null, arr([A1]), '{inbox}', uid(901)]);
  expectAllowed('messaging', 'admin sends a message to one person through the shared spec path', msgExplicit);
  const msgCount = await count(db, `select count(*)::int n from public.communication_recipients where message_id = $1`,
    [msgExplicit.rows?.[0]?.id ?? uid(0)]);
  record('messaging', 'message reaches exactly the named person', msgCount === 1, `rows=${msgCount}`);

  expectDenied('messaging', 'leader A cannot send to cell B', await attempt(db, 'authenticated', LA,
    `select public.send_message($1,$2,$3,$4::uuid[],$5::uuid[],$6::uuid[],$7::text[],$8::uuid)`,
    ['x', 'y', 'cells', arr([CELL_B]), null, null, '{inbox}', uid(902)]), '42501');

  // ── Summary ──────────────────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(`  - [${f.area}] ${f.name}: ${f.evidence}`));
    process.exitCode = 1;
  }
  await db.close?.();
}

main().catch((e) => {
  console.error('CERTIFICATION ABORTED:', e.message);
  process.exitCode = 2;
});

export { asRole };
