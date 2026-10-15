// Executes the migration 103 checks on an in-process PGlite database (no Docker, no hosted project).
// Usage: PGLITE_MODULE=file:///<path>/@electric-sql/pglite/dist/index.js node supabase/verification/identity_link_103_pglite_checks.mjs supabase/migrations/103_identity_link_queue_and_approval_gate.sql
// Adapted to the single queue RPC list_account_link_queue(p_reason) and the broadened approval gate (any pending profile with person_id NULL).
// Fixtures use the real signup trigger (099). GoTrue columns are added to the auth.users shim to match GoTrue (email_change, email_confirmed_at).
import fs from "fs";
import { openReplay, asRole, attempt } from "./pglite_replay.mjs";

const MIG = process.argv[2];
import { fileURLToPath } from "url";
import path from "path";
const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { db } = await openReplay(`${W}/supabase/migrations`, { lastFile: "102_rejected_profile_privacy.sql" });
const reasonQueue = "Desk check of applicant identity";

// GoTrue-shaped columns on auth.users. email_change holds the PENDING new address in GoTrue's own schema.
await db.exec(`
  alter table auth.users
    add column if not exists email_confirmed_at timestamptz,
    add column if not exists confirmed_at timestamptz,
    add column if not exists email_change text,
    add column if not exists email_change_token_new text,
    add column if not exists email_change_token_current text,
    add column if not exists email_change_sent_at timestamptz,
    add column if not exists email_change_confirm_status smallint default 0,
    add column if not exists deleted_at timestamptz;
`);
await db.exec(fs.readFileSync(MIG, "utf8").split("\n").filter((l) => !/^\s*create extension/i.test(l)).join("\n"));

const ids = {
  ADMIN: "00000000-0000-0000-0000-00000000a001", LINK: "00000000-0000-0000-0000-00000000b001",
  CHANGE: "00000000-0000-0000-0000-00000000b002", UNC: "00000000-0000-0000-0000-00000000b003",
  NEW: "00000000-0000-0000-0000-00000000b004", ORPH: "00000000-0000-0000-0000-00000000b005",
};
const P = {
  LINK: "00000000-0000-0000-0000-00000000c001", CHANGE: "00000000-0000-0000-0000-00000000c002",
  UNC: "00000000-0000-0000-0000-00000000c003", NEW: "00000000-0000-0000-0000-00000000c004",
};
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`); };

await asRole(db, "owner");
// Real signup path: people first, then auth users. handle_new_user (099) creates the profile and, when the email
// matches an existing person, leaves it UNLINKED. A new email creates a person and links it.
await db.exec(`
  alter table auth.users alter column created_at set default now(), alter column updated_at set default now();
  insert into public.people (id, full_name, email) values
   ('${P.LINK}', 'Link Person', 'link@x.org'), ('${P.CHANGE}', 'Change Person', 'change@x.org'),
   ('${P.UNC}', 'Unc Person', 'unc@x.org');
  insert into auth.users (id, email, email_confirmed_at) values ('${ids.ADMIN}', 'admin@x.org', now());
  update public.profiles set role = 'admin', status = 'active' where id = '${ids.ADMIN}';
  insert into auth.users (id, email, email_confirmed_at, email_change, email_change_token_new) values
   ('${ids.LINK}', 'link@x.org', now(), null, null),
   ('${ids.CHANGE}', 'change@x.org', now(), 'changed-to@other.org', 'tok'),
   ('${ids.UNC}', 'unc@x.org', null, null, null),
   ('${ids.NEW}', 'new@y.org', now(), null, null);
`);
const pr = await db.query("select person_id from public.profiles where id = $1", [ids.NEW]);
P.NEW = pr.rows[0].person_id;

const A = (uid, sql, params) => attempt(db, "authenticated", uid, sql, params);
const reason = "Confirmed by staff review";
const owner = async (sql, params) => { await asRole(db, "owner"); return db.query(sql, params); };

let r = await A(ids.ADMIN, `select public.link_pending_profile_to_person($1,$2,$3)`, [ids.CHANGE, P.CHANGE, reason]);
rec("1 link refuses an account with a pending email change", !r.ok && /pending email change/i.test(r.error), r.ok ? "LINKED" : r.error);

r = await A(ids.ADMIN, `select public.link_pending_profile_to_person($1,$2,$3)`, [ids.UNC, P.UNC, reason]);
rec("2 link refuses an unconfirmed email", !r.ok && r.code === "42501", r.ok ? "LINKED" : r.error);

r = await A(ids.ADMIN, `select public.link_pending_profile_to_person($1,$2,$3)`, [ids.LINK, P.LINK, "x"]);
rec("3 link refuses a short reason (22023)", !r.ok && r.code === "22023", r.error);

const auditQueue = async () => (await owner(`select count(*)::int n from public.identity_read_audit where target_kind='account_link'`)).rows[0].n;
const auditBefore = await auditQueue();
r = await A(ids.ADMIN, `select * from public.list_account_link_queue($1)`, [reasonQueue]);
const rows = r.rows ?? [];
const byId = Object.fromEntries(rows.map((x) => [x.profile_id, x]));
rec("4a queue lists confirmed, pending, unlinked matches only (LINK and CHANGE; not UNC unverified, not NEW linked)", r.ok && rows.length === 2 && byId[ids.LINK] && byId[ids.CHANGE] && !byId[ids.UNC] && !byId[ids.NEW], `rows=${rows.length} ${r.error ?? ""}`);
rec("4b the pending-email-change account stays listed (link refuses it, staff see why)", !!byId[ids.CHANGE], "");
rec("4c candidate id and name are the exact match", byId[ids.LINK]?.person_id === P.LINK && byId[ids.LINK]?.person_name === "Link Person", JSON.stringify(byId[ids.LINK] ?? null));
rec("4d queue returns exactly the five approved columns", rows.length > 0 && Object.keys(rows[0]).sort().join(",") === "created_at,display_name,person_id,person_name,profile_id", Object.keys(rows[0] ?? {}).join(","));
const dump = JSON.stringify(rows);
rec("4e queue output contains no email address", !dump.includes("@"), "");
rec("4f a queue read writes one account_link audit row", (await auditQueue()) === auditBefore + 1, "");
r = await A(ids.ADMIN, `select * from public.list_account_link_queue($1)`, ["x"]);
rec("4g queue refuses a short reason (22023) and writes no audit row", !r.ok && r.code === "22023" && (await auditQueue()) === auditBefore + 1, r.error);

r = await A(ids.LINK, `select * from public.list_account_link_queue($1)`, [reasonQueue]);
rec("5a member cannot read the queue (42501)", !r.ok && r.code === "42501", r.error);
r = await attempt(db, "anon", null, `select * from public.list_account_link_queue($1)`, [reasonQueue]);
rec("5b anon has no execute on the queue", !r.ok, r.error);

r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.LINK]);
rec("6a approve refuses an unlinked pending account whose email matches a person", !r.ok && r.code === "42501" && /before approving/.test(r.error), r.ok ? "APPROVED" : r.error);
// 6b. Broadened gate: a pending, unlinked account with NO matching person is also refused.
await owner(`insert into auth.users (id, email, email_confirmed_at) values ('${ids.ORPH}', 'orphan@z.org', now())`);
await owner(`update public.people set email = 'renamed-orphan@z.org' where id = (select person_id from public.profiles where id = '${ids.ORPH}')`);
await owner(`update public.profiles set person_id = null where id = '${ids.ORPH}'`);
r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.ORPH]);
rec("6b approve refuses an unlinked pending account even with no matching person (person_id NULL rule)", !r.ok && r.code === "42501", r.ok ? "APPROVED" : r.error);

r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.NEW]);
rec("7a new-member approval succeeds", r.ok && r.rows.length === 1 && r.rows[0].status === "active", r.error);
r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.NEW]);
rec("7b repeat approval is a no-op", r.ok && r.rows.length === 0, `rows=${r.rows?.length}`);
let c = await owner(`select count(*)::int n from public.profile_approval_audit where profile_id=$1`, [ids.NEW]);
rec("7c one approval audit row for the approval", c.rows[0].n === 1, `n=${c.rows[0].n}`);

r = await A(ids.ADMIN, `select public.link_pending_profile_to_person($1,$2,$3)`, [ids.LINK, P.LINK, reason]);
rec("8a link succeeds for a confirmed, matching, unchanged account", r.ok, r.error);
r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.LINK]);
rec("8b approval succeeds after linking", r.ok && r.rows.length === 1, r.error);
c = await owner(`select count(*)::int n from public.profile_link_audit where profile_id=$1 and action='attach'`, [ids.LINK]);
rec("8c link audit row written", c.rows[0].n === 1, `n=${c.rows[0].n}`);

r = await A(ids.LINK, `select * from public.approve_pending_member($1)`, [ids.CHANGE]);
rec("9 member cannot approve (42501)", !r.ok && r.code === "42501", r.error);

r = await A(ids.ADMIN, `insert into public.profile_approval_audit (profile_id, actor_id, action) values ($1,$1,'approve')`, [ids.ADMIN]);
rec("10a client cannot insert an approval audit row", !r.ok, r.error);
r = await A(ids.ADMIN, `select count(*) from public.profile_approval_audit`);
rec("10b client cannot read the approval audit", !r.ok, r.error);
let up; try { await owner(`update public.profile_approval_audit set action='approve' where profile_id=$1`, [ids.NEW]); up = "updated"; } catch (e) { up = e.message; }
rec("10c owner update of approval audit is refused by trigger", up !== "updated", up);
let del; try { await owner(`delete from public.profile_approval_audit where profile_id=$1`, [ids.NEW]); del = "deleted"; } catch (e) { del = e.message; }
rec("10d owner delete of approval audit is refused by trigger", del !== "deleted", del);

// 10f-10j. Client and owner DML on the approval audit: UPDATE, DELETE, TRUNCATE refused; audit rows survive.
r = await A(ids.ADMIN, `update public.profile_approval_audit set action = 'approve'`);
rec("10f client UPDATE of approval audit refused", !r.ok, r.error);
r = await A(ids.ADMIN, `delete from public.profile_approval_audit`);
rec("10g client DELETE of approval audit refused", !r.ok, r.error);
r = await A(ids.ADMIN, `truncate public.profile_approval_audit`);
rec("10h client TRUNCATE of approval audit refused", !r.ok, r.error);
let tr; try { await owner(`truncate public.profile_approval_audit`); tr = "truncated"; } catch (e) { tr = e.message; }
rec("10i owner TRUNCATE of approval audit refused by trigger", tr !== "truncated", tr);
c = await owner(`select count(*)::int n from public.profile_approval_audit`);
rec("10j approval audit rows survive all refused operations", c.rows[0].n >= 1, `n=${c.rows[0].n}`);

r = await A(ids.ADMIN, `select * from public.get_person_identity($1,$2)`, [P.LINK, reason]);
rec("11a staff reveal with a reason returns the person", r.ok && r.rows[0].email === "link@x.org", r.error);
r = await A(ids.LINK, `select * from public.get_person_identity($1,$2)`, [P.LINK, reason]);
rec("11b member cannot reveal a person (42501)", !r.ok && r.code === "42501", r.error);
c = await owner(`select count(*)::int n from public.identity_read_audit where target_id=$1`, [P.LINK]);
rec("11c reveal is audited", c.rows[0].n >= 1, `n=${c.rows[0].n}`);

// 12. False-positive guard: once GoTrue clears email_change (change confirmed or cancelled), linking works again.
await owner(`update auth.users set email_change = null, email_change_token_new = null where id = '${ids.CHANGE}'`);
r = await A(ids.ADMIN, `select public.link_pending_profile_to_person($1,$2,$3)`, [ids.CHANGE, P.CHANGE, reason]);
rec("12 link succeeds after the pending email change is cleared", r.ok, r.error);

// 13. Pinned search_path on the SECURITY DEFINER functions, and TRUNCATE refused on every audit table (owner too).
const cfg = (await owner(`select proname, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('approve_pending_member','link_pending_profile_to_person','list_account_link_queue') order by proname`)).rows;
rec("13a every SECURITY DEFINER function here pins search_path=pg_catalog, public", cfg.length === 3 && cfg.every((x) => (x.proconfig ?? []).includes("search_path=pg_catalog, public")), JSON.stringify(cfg.map((x) => x.proname)));
for (const t of ["identity_read_audit", "profile_link_audit"]) {
  let tt; try { await owner(`truncate public.${t}`); tt = "truncated"; } catch (e) { tt = e.message; }
  rec(`13b owner TRUNCATE of ${t} refused`, tt !== "truncated", tt);
}

const failed = results.filter((x) => !x.pass).length;
console.log(`\nSUMMARY ${results.length - failed} PASS, ${failed} FAIL`);
// A failed expectation must fail the run: exit 1 whenever any check did not pass.
process.exit(failed === 0 ? 0 : 1);
