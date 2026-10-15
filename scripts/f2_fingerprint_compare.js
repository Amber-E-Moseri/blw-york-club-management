#!/usr/bin/env node
// Clone-parity comparison for scripts/f2_clone_db.sh. Compares a SOURCE and a CLONE schema fingerprint (the output of
// supabase/verification/schema_fingerprint.sql). It is the only place that normalizes anything, and it is used only by
// the clone check. The canonical fingerprint and its golden are not changed.
//
// Exit codes: 0 parity; 1 mismatch (differences printed by name and property, no row data); 2 malformed or incomplete input.
//
// The single normalization: a CHECK constraint is compared by a canonical token stream in which only these PostgreSQL
// rendering differences are removed, and only where they wrap a string literal or an ARRAY of literals:
//   - a type cast (::text, ::character varying, ::varchar, and the array forms ::text[] and ::character varying[]) that
//     follows a string literal or a parenthesized literal or ARRAY group;
//   - parentheses that enclose exactly one string literal, or exactly one ARRAY group.
// Column names, operators, literal values, array elements and their order, and every other token are compared exactly.
// Non-CHECK constraints are compared exactly. Anything that does not match the pattern stays as written, so it is
// compared exactly and a difference fails closed.
"use strict";
const fs = require("fs");

const REQUIRED = ["tables", "views", "functions", "extensions", "default_privileges", "storage_buckets", "storage_policies"];
const CAST = /^::(?:text|character varying|varchar)(?:\[\])?$/;
// The only CHECK constraints whose cast placement is normalized: the four confirmed table/constraint pairs from the
// PG17 clone diagnosis. Keyed by table and constraint name together, so the same name on another table does not match.
const APPROVED_CHECKS = new Set([
  "email_log/email_log_template_type_check",
  "habit_entries/habit_entries_status_check",
  "weekly_messages/weekly_messages_recurrence_type_check",
  "weekly_messages/weekly_messages_scope_check",
]);

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function load(path, label) {
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (e) {
    fail(2, `${label}: cannot read the fingerprint file`);
  }
  if (!text.trim()) fail(2, `${label}: the fingerprint is empty`);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    fail(2, `${label}: the fingerprint is not valid JSON`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(2, `${label}: the fingerprint is not a JSON object`);
  const missing = REQUIRED.filter((k) => !(k in doc));
  if (missing.length) fail(2, `${label}: the fingerprint is incomplete, missing: ${missing.join(", ")}`);
  return doc;
}

// Tokens: quoted literals (with doubled quotes), casts, identifiers, numbers, punctuation and operators.
function tokenize(expr) {
  const re = /'(?:[^']|'')*'|::[A-Za-z][A-Za-z ]*(?:\[\])?|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|\S/g;
  const out = [];
  let m;
  let consumed = 0;
  while ((m = re.exec(expr)) !== null) {
    if (m.index !== consumed && expr.slice(consumed, m.index).trim() !== "") return null;
    out.push(m[0].replace(/\s+/g, " "));
    consumed = re.lastIndex;
  }
  if (expr.slice(consumed).trim() !== "") return null;
  return out;
}

const isLiteral = (t) => t !== undefined && t.startsWith("'");

// Index of the "(" matching the ")" at index i, or -1.
function matchOpen(tokens, i) {
  let depth = 0;
  for (let k = i; k >= 0; k--) {
    if (tokens[k] === ")") depth++;
    else if (tokens[k] === "(") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// Does the parenthesized group [open..close] wrap exactly one string literal, or exactly one ARRAY group?
function wrapsLiteralOrArray(tokens, open, close) {
  const inner = tokens.slice(open + 1, close);
  if (inner.length === 1 && isLiteral(inner[0])) return "literal";
  if (inner.length > 1 && inner[0].toUpperCase() === "ARRAY" && inner[1] === "[") {
    // ARRAY [ ... ] must occupy the whole group.
    let depth = 0;
    for (let k = 1; k < inner.length; k++) {
      if (inner[k] === "[") depth++;
      else if (inner[k] === "]") {
        depth--;
        if (depth === 0) return k === inner.length - 1 ? "array" : null;
      }
    }
  }
  return null;
}

function canonicalCheck(expr) {
  let tokens = tokenize(expr);
  if (!tokens) return null;
  // Remove casts that follow a literal or a literal/ARRAY group, then parentheses around a single literal or ARRAY.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < tokens.length; i++) {
      if (!CAST.test(tokens[i].toLowerCase())) continue;
      const prev = tokens[i - 1];
      let ok = false;
      if (isLiteral(prev)) ok = true;
      else if (prev === ")") {
        const open = matchOpen(tokens, i - 1);
        if (open >= 0 && wrapsLiteralOrArray(tokens, open, i - 1)) ok = true;
      }
      if (ok) {
        tokens.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "(") continue;
      const close = matchClose(tokens, i);
      if (close < 0) return null;
      if (close === i + 2 && isLiteral(tokens[i + 1])) {
        tokens.splice(close, 1);
        tokens.splice(i, 1);
        changed = true;
        break;
      }
      if (close > i + 2 && tokens[i + 1].toUpperCase() === "ARRAY" && wrapsLiteralOrArray(tokens, i, close) === "array") {
        tokens.splice(close, 1);
        tokens.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return tokens.join(" ");
}

function matchClose(tokens, open) {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    if (tokens[k] === "(") depth++;
    else if (tokens[k] === ")") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// Canonical form of one constraint entry, "<name> <definition>". Only CHECK definitions are normalized.
function canonicalConstraint(table, entry) {
  const m = /^(\S+) CHECK (.*)$/s.exec(entry);
  if (!m) return entry;
  // Only the approved (table, constraint) pairs are normalized. Any other CHECK is compared exactly, even if it has the
  // same cast pattern: a cast-only difference there is a mismatch.
  if (!APPROVED_CHECKS.has(`${table}/${m[1]}`)) return entry;
  const canon = canonicalCheck(m[2]);
  // Unrecognized CHECK text is kept exactly as written, so any difference in it fails closed.
  return canon === null ? entry : `${m[1]} CHECK ${canon}`;
}

function normalize(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  for (const t of Object.keys(copy.tables || {})) {
    const cons = copy.tables[t] && copy.tables[t].constraints;
    if (Array.isArray(cons)) copy.tables[t].constraints = cons.map((e) => canonicalConstraint(t, e));
  }
  return copy;
}

function diff(a, b) {
  const sections = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const lines = [];
  for (const k of sections) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    lines.push(`differing section: ${k}`);
    if (x && y && typeof x === "object" && !Array.isArray(x)) {
      const names = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((n) => JSON.stringify(x[n]) !== JSON.stringify(y[n]));
      lines.push(`  entries differing (${names.length}): ${names.slice(0, 40).join(", ")}`);
      for (const n of names.slice(0, 12)) {
        if (x[n] === undefined || y[n] === undefined) {
          lines.push(`  ${n}: ${x[n] === undefined ? "missing in source" : "missing in clone"}`);
          continue;
        }
        const props = [...new Set([...Object.keys(x[n] || {}), ...Object.keys(y[n] || {})])].filter((p) => JSON.stringify(x[n][p]) !== JSON.stringify(y[n][p]));
        for (const p of props) {
          const sv = x[n][p], dv = y[n][p];
          if (Array.isArray(sv) && Array.isArray(dv)) {
            const os = sv.filter((v) => !dv.includes(v)), od = dv.filter((v) => !sv.includes(v));
            lines.push(`  ${n}.${p} only in source (${os.length}): ${os.slice(0, 6).map((v) => String(v).slice(0, 200)).join(" | ")}`);
            lines.push(`  ${n}.${p} only in clone (${od.length}): ${od.slice(0, 6).map((v) => String(v).slice(0, 200)).join(" | ")}`);
          } else {
            lines.push(`  ${n}.${p} source=${JSON.stringify(sv).slice(0, 200)} clone=${JSON.stringify(dv).slice(0, 200)}`);
          }
        }
      }
    } else if (Array.isArray(x) && Array.isArray(y)) {
      const os = x.filter((v) => !y.includes(v)), od = y.filter((v) => !x.includes(v));
      lines.push(`  only in source (${os.length}): ${os.slice(0, 20).map((v) => String(v).slice(0, 160)).join(" | ")}`);
      lines.push(`  only in clone (${od.length}): ${od.slice(0, 20).map((v) => String(v).slice(0, 160)).join(" | ")}`);
    } else {
      lines.push(`  source=${JSON.stringify(x).slice(0, 200)} clone=${JSON.stringify(y).slice(0, 200)}`);
    }
  }
  return lines;
}

module.exports = { canonicalCheck, canonicalConstraint, normalize, diff, tokenize };

if (require.main === module) {
  const [srcPath, dstPath] = process.argv.slice(2);
  if (!srcPath || !dstPath) fail(2, "usage: f2_fingerprint_compare.js <source.json> <clone.json>");
  const src = load(srcPath, "source");
  const dst = load(dstPath, "clone");
  const a = normalize(src), b = normalize(dst);
  const lines = diff(a, b);
  if (lines.length === 0) {
    console.log("PARITY: the clone's security fingerprint equals the source's (CHECK expressions compared by canonical token stream)");
    process.exit(0);
  }
  console.error("CLONE FINGERPRINT MISMATCH: differing properties (names and metadata only; no row data)");
  for (const l of lines) console.error(l);
  process.exit(1);
}
