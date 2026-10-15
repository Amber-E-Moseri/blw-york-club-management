// Executes the migration 103 checks on an in-process PGlite database (no Docker, no hosted project).
// Usage: PGLITE_MODULE=file:///<path>/@electric-sql/pglite/dist/index.js node supabase/verification/identity_link_103_pglite_checks.mjs supabase/migrations/103_identity_link_queue_and_approval_gate.sql
// Fixtures use the real signup trigger (099). GoTrue columns are added to the auth.users shim to match GoTrue (email_change, email_confirmed_at).
import fs from "fs";
import { openReplay, asRole, attempt } from "./pglite_replay.mjs";

const MIG = process.argv[2];
import { fileURLToPath } from "url";
import path from "path";
const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { db } = await openReplay(`${W}/supabase/migrations`, { lastFile: "102_rejected_profile_privacy.sql" });

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
  NEW: "00000000-0000-0000-0000-00000000b004",
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

r = await A(ids.ADMIN, `select * from public.list_identity_link_queue(50)`);
const rows = r.rows ?? [];
const byId = Object.fromEntries(rows.map((x) => [x.profile_id, x]));
rec("4a queue lists the three pending matches and not the new member", r.ok && rows.length === 3 && !byId[ids.NEW], `rows=${rows.length} ${r.error ?? ""}`);
rec("4b queue reports the pending email change", byId[ids.CHANGE]?.pending_email_change === true, `pending_email_change=${byId[ids.CHANGE]?.pending_email_change}`);
const dump = JSON.stringify(rows);
rec("4c queue output contains no full address", !/(link|change|unc)@x\.org|@other\.org/.test(dump), "");

r = await A(ids.LINK, `select * from public.list_identity_link_queue(50)`);
rec("5a member cannot read the queue (42501)", !r.ok && r.code === "42501", r.error);
r = await attempt(db, "anon", null, `select * from public.list_identity_link_queue(50)`);
rec("5b anon has no execute on the queue", !r.ok, r.error);

r = await A(ids.ADMIN, `select * from public.approve_pending_member($1)`, [ids.LINK]);
rec("6 approve refuses an unlinked account whose email matches a person", !r.ok && r.code === "42501" && /before approving/.test(r.error), r.ok ? "APPROVED" : r.error);

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

console.log(`\nSUMMARY ${results.filter((x) => x.pass).length} PASS, ${results.filter((x) => !x.pass).length} FAIL`);
process.exit(0);
