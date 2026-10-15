#!/usr/bin/env node
// Focused tests for scripts/f2_fingerprint_compare.js. Synthetic fingerprints only; no database. Run: node <this file>.
// Positive: the four CHECK constraints (eight text entries) that differ only in cast placement between a direct replay and
// a restored clone must compare equal. Negative: every change listed in the clone-parity requirements must fail.
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { canonicalCheck } = require(path.join(__dirname, "f2_fingerprint_compare.js"));

const COMPARE = path.join(__dirname, "f2_fingerprint_compare.js");
const REQUIRED = ["tables", "views", "functions", "extensions", "default_privileges", "storage_buckets", "storage_policies"];

// The four known pairs, as they appear in the direct replay (source) and in the restored clone.
const PAIRS = {
  email_log: {
    src: "email_log_template_type_check CHECK (((template_type)::text = ANY ((ARRAY['meeting_reminder_8am'::character varying, 'meeting_reminder_1hr'::character varying, 'message_notification'::character varying, 'habit_milestone'::character varying, 'devotional_reminder'::character varying, 'testimony_approved'::character varying, 'weekly_digest'::character varying, 'generic'::character varying])::text[])))",
    dst: "email_log_template_type_check CHECK (((template_type)::text = ANY (ARRAY[('meeting_reminder_8am'::character varying)::text, ('meeting_reminder_1hr'::character varying)::text, ('message_notification'::character varying)::text, ('habit_milestone'::character varying)::text, ('devotional_reminder'::character varying)::text, ('testimony_approved'::character varying)::text, ('weekly_digest'::character varying)::text, ('generic'::character varying)::text])))",
  },
  habit_entries: {
    src: "habit_entries_status_check CHECK (((status)::text = ANY ((ARRAY['done'::character varying, 'skipped'::character varying])::text[])))",
    dst: "habit_entries_status_check CHECK (((status)::text = ANY (ARRAY[('done'::character varying)::text, ('skipped'::character varying)::text])))",
  },
  weekly_messages_recurrence: {
    src: "weekly_messages_recurrence_type_check CHECK (((recurrence_type)::text = ANY ((ARRAY['none'::character varying, 'weekly'::character varying, 'biweekly'::character varying])::text[])))",
    dst: "weekly_messages_recurrence_type_check CHECK (((recurrence_type)::text = ANY (ARRAY[('none'::character varying)::text, ('weekly'::character varying)::text, ('biweekly'::character varying)::text])))",
  },
  weekly_messages_scope: {
    src: "weekly_messages_scope_check CHECK (((scope)::text = ANY ((ARRAY['org'::character varying, 'personal'::character varying])::text[])))",
    dst: "weekly_messages_scope_check CHECK (((scope)::text = ANY (ARRAY[('org'::character varying)::text, ('personal'::character varying)::text])))",
  },
};

function base() {
  const doc = {};
  for (const k of REQUIRED) doc[k] = [];
  doc.tables = {
    email_log: { owner: "postgres", rls: true, privileges: { authenticated: "SELECT", anon: "" }, constraints: [PAIRS.email_log.src, "email_log_pkey PRIMARY KEY (id)"], policies: ["email_log_admin_read | SELECT | {authenticated} | using=(is_admin())"] },
    habit_entries: { owner: "postgres", rls: true, privileges: { authenticated: "SELECT" }, constraints: [PAIRS.habit_entries.src, "habit_entries_user_fkey FOREIGN KEY (user_id) REFERENCES profiles(id)", "habit_entries_template_entry_date_key UNIQUE (template_id, user_id, entry_date)"] },
    weekly_messages: { owner: "postgres", rls: true, privileges: { authenticated: "SELECT" }, constraints: [PAIRS.weekly_messages_recurrence.src, PAIRS.weekly_messages_scope.src] },
    contacts: { owner: "postgres", rls: true, privileges: { authenticated: "SELECT,INSERT" }, constraints: [] },
  };
  doc.functions = { "is_admin()": { owner: "postgres", security: "definer", execute: { authenticated: true, anon: false } } };
  return doc;
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

function withSource(doc) {
  // Build the clone side from the source side by swapping in the restored (dst) rendering of each known pair.
  const c = clone(doc);
  c.tables.email_log.constraints[0] = PAIRS.email_log.dst;
  c.tables.habit_entries.constraints[0] = PAIRS.habit_entries.dst;
  c.tables.weekly_messages.constraints[0] = PAIRS.weekly_messages_recurrence.dst;
  c.tables.weekly_messages.constraints[1] = PAIRS.weekly_messages_scope.dst;
  return c;
}

const dir = require("fs").mkdtempSync(path.join(require("os").tmpdir(), "f2-fp-"));
let n = 0;
function run(name, srcDoc, dstText, expectCode) {
  n++;
  const s = path.join(dir, `s${n}.json`), d = path.join(dir, `d${n}.json`);
  require("fs").writeFileSync(s, typeof srcDoc === "string" ? srcDoc : JSON.stringify(srcDoc));
  require("fs").writeFileSync(d, typeof dstText === "string" ? dstText : JSON.stringify(dstText));
  const r = spawnSync(process.execPath, [COMPARE, s, d], { encoding: "utf8" });
  const ok = r.status === expectCode;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (exit ${r.status}, expected ${expectCode})`);
  if (!ok) {
    console.log((r.stdout + r.stderr).slice(0, 600));
    process.exitCode = 1;
  }
}

// Positive controls.
{
  const src = base();
  run("positive: the four known CHECK pairs (eight texts, formatting-only) compare equal", src, withSource(src), 0);
  run("positive: identical fingerprints compare equal", src, clone(src), 0);
  n++;
  const canonSrc = canonicalCheck(PAIRS.habit_entries.src.replace(/^habit_entries_status_check CHECK /, ""));
  const canonDst = canonicalCheck(PAIRS.habit_entries.dst.replace(/^habit_entries_status_check CHECK /, ""));
  console.log(`${canonSrc === canonDst ? "PASS" : "FAIL"}  positive: canonical token streams are equal for the habit_entries pair`);
  if (canonSrc !== canonDst) process.exitCode = 1;
}

// Negative controls 1-7.
{
  const src = base();
  // 1. Allowed value changes (a literal inside the CHECK).
  const c1 = withSource(src);
  c1.tables.habit_entries.constraints[0] = c1.tables.habit_entries.constraints[0].replace("'skipped'", "'skipd'");
  run("negative 1: an allowed value changes", src, c1, 1);

  // 2. A CHECK constraint is dropped.
  const c2 = withSource(src);
  c2.tables.habit_entries.constraints = c2.tables.habit_entries.constraints.slice(1);
  run("negative 2: a CHECK constraint is dropped", src, c2, 1);

  // 3a. A referenced column changes inside a CHECK.
  const c3a = withSource(src);
  c3a.tables.habit_entries.constraints[0] = c3a.tables.habit_entries.constraints[0].replace("(status)::text", "(user_id)::text");
  run("negative 3a: a referenced column changes inside a CHECK", src, c3a, 1);

  // 3b. An operator changes inside a CHECK.
  const c3b = withSource(src);
  c3b.tables.habit_entries.constraints[0] = c3b.tables.habit_entries.constraints[0].replace("= ANY", "<> ANY");
  run("negative 3b: an operator changes inside a CHECK", src, c3b, 1);

  // 3c. Array element order changes inside a CHECK.
  const c3c = withSource(src);
  c3c.tables.habit_entries.constraints[0] = c3c.tables.habit_entries.constraints[0].replace("'done'::character varying)::text, ('skipped'", "'skipped'::character varying)::text, ('done'");
  run("negative 3c: array element order changes inside a CHECK", src, c3c, 1);

  // 4. A non-CHECK constraint changes (a foreign key and a unique constraint).
  const c4a = withSource(src);
  c4a.tables.habit_entries.constraints[1] = c4a.tables.habit_entries.constraints[1].replace("REFERENCES profiles(id)", "REFERENCES profiles(id) ON DELETE CASCADE");
  run("negative 4a: a foreign key changes", src, c4a, 1);
  const c4b = withSource(src);
  c4b.tables.habit_entries.constraints[2] = "habit_entries_template_entry_date_key UNIQUE (template_id, entry_date)";
  run("negative 4b: a unique constraint changes", src, c4b, 1);

  // 5. Ownership, grant and RLS properties change.
  const c5a = withSource(src);
  c5a.functions["is_admin()"].owner = "ci_restore";
  run("negative 5a: a function owner changes", src, c5a, 1);
  const c5b = withSource(src);
  c5b.tables.contacts.privileges.authenticated = "SELECT";
  run("negative 5b: a table grant changes", src, c5b, 1);
  const c5c = withSource(src);
  c5c.tables.email_log.rls = false;
  run("negative 5c: RLS is disabled on a table", src, c5c, 1);
  const c5d = withSource(src);
  c5d.functions["is_admin()"].security = "invoker";
  run("negative 5d: SECURITY DEFINER changes to invoker", src, c5d, 1);

  // 5e. An otherwise identical cast-only difference in an UNAPPROVED CHECK constraint is refused. The same pattern as the
  // approved pairs, on a constraint that is not in the approved set, must compare exactly.
  const unapprovedSrc = clone(src);
  unapprovedSrc.tables.contacts.constraints = ["contacts_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[])))"];
  const unapprovedDst = clone(unapprovedSrc);
  unapprovedDst.tables.contacts.constraints = ["contacts_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('closed'::character varying)::text])))"];
  run("negative 5e: a cast-only difference in an unapproved CHECK constraint is refused", unapprovedSrc, unapprovedDst, 1);

  // 5f. An approved constraint name on a table that is not approved for it: the cast-only difference is refused.
  const wrongTableSrc = clone(src);
  wrongTableSrc.tables.contacts.constraints = [PAIRS.email_log.src];
  const wrongTableDst = clone(wrongTableSrc);
  wrongTableDst.tables.contacts.constraints = [PAIRS.email_log.dst];
  run("negative 5f: an approved constraint name on an unapproved table is refused", wrongTableSrc, wrongTableDst, 1);

  // 6. Malformed or incomplete fingerprint output.
  run("negative 6a: the clone fingerprint is not valid JSON", src, '{"tables":', 2);
  run("negative 6b: the clone fingerprint is empty", src, "", 2);
  const missing = withSource(src);
  delete missing.default_privileges;
  run("negative 6c: the clone fingerprint is missing a required section", src, missing, 2);
  run("negative 6d: the source fingerprint is not a JSON object", "[1,2,3]", withSource(src), 2);
}

if (!process.exitCode) console.log("FOCUSED COMPARE TESTS: all controls behaved as expected");
else console.log("FOCUSED COMPARE TESTS: at least one control failed");
