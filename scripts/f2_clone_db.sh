#!/usr/bin/env bash
# Clones database SRC into a NEW database DST inside container C, through pg_dump and pg_restore. Unlike
# CREATE DATABASE ... TEMPLATE, this works while other sessions are connected to SRC (a Supabase stack keeps sessions open
# on the postgres database). The clone is checked against the source: the function and policy counts must match.
#   usage: f2_clone_db.sh <container> <source database> <new database>
#   F2_DB_ADMIN names the superuser role that restores the clone (default postgres; must be a superuser).
set -euo pipefail
ROLE="${F2_DB_ADMIN:-postgres}"
C="${1:?container}"; SRC="${2:?source database}"; DST="${3:?new database}"

for n in "$SRC" "$DST"; do
  case "$n" in
    *canon*|*prod*|*live*|*blw*) echo "refused: '$n' is a protected name" >&2; exit 2 ;;
  esac
done
if [[ ! "$DST" =~ ^f2_[a-z0-9_]+$ ]]; then
  echo "refused: the new database '$DST' must start with f2_ and use lowercase letters, digits or underscores" >&2
  exit 2
fi
if [[ "$SRC" == "$DST" ]]; then
  echo "refused: source and new database are the same" >&2
  exit 2
fi

DUMP="/tmp/${DST}.dump"
q() { docker exec -i "$C" psql -U "$ROLE" -d "$1" -X -At -c "$2"; }

docker exec "$C" pg_dump -U "$ROLE" -Fc -f "$DUMP" "$SRC"
docker exec "$C" psql -U "$ROLE" -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DST\""
docker exec "$C" createdb -U "$ROLE" "$DST"
docker exec "$C" pg_restore -U "$ROLE" -d "$DST" --exit-on-error "$DUMP"
docker exec "$C" rm -f "$DUMP"

# The clone must have the same functions and policies as the source, or it is refused.
probe="select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace), (select count(*) from pg_policy)"
src_probe="$(q "$SRC" "$probe")"
dst_probe="$(q "$DST" "$probe")"
if [[ "$src_probe" != "$dst_probe" ]]; then
  echo "CLONE MISMATCH: $SRC=[$src_probe] $DST=[$dst_probe]" >&2
  exit 1
fi
# Ownership, SECURITY DEFINER mode and owner, EXECUTE and table grants, and RLS: the clone's full security fingerprint must
# equal the source's, byte for byte. A changed owner, a dropped grant or a flipped RLS flag refuses the clone.
FP_SQL="$(dirname "$0")/../supabase/verification/schema_fingerprint.sql"
[[ -f "$FP_SQL" ]] || { echo "refused: $FP_SQL is missing; the clone cannot be verified" >&2; exit 2; }
src_fp="$(docker exec -i "$C" psql -U "$ROLE" -d "$SRC" -X -q -At < "$FP_SQL")"
dst_fp="$(docker exec -i "$C" psql -U "$ROLE" -d "$DST" -X -q -At < "$FP_SQL")"
# Fail closed on invalid or incomplete output: both documents must parse as JSON and carry every required section,
# each non-null. Two identical truncated documents must not pass as parity.
FP_CHECK='
  const fs = require("fs");
  const required = ["tables", "views", "functions", "extensions", "default_privileges", "storage_buckets", "storage_policies"];
  for (const f of process.argv.slice(1)) {
    let d;
    try { d = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.error("invalid JSON in " + f); process.exit(1); }
    const missing = required.filter((k) => !(k in d));
    if (missing.length) { console.error("incomplete fingerprint, missing: " + missing.join(", ")); process.exit(1); }
  }'
FP_TMP="$(mktemp -d)"
printf '%s\n' "$src_fp" > "$FP_TMP/src.json"
printf '%s\n' "$dst_fp" > "$FP_TMP/dst.json"
if ! node -e "$FP_CHECK" "$FP_TMP/src.json" "$FP_TMP/dst.json"; then
  rm -rf "$FP_TMP"
  echo "CLONE FINGERPRINT INVALID: refused. The fingerprint of $SRC or $DST is not complete JSON." >&2
  exit 1
fi
rm -rf "$FP_TMP"
if [[ -z "$src_fp" || "$src_fp" != "$dst_fp" ]]; then
  echo "CLONE FINGERPRINT MISMATCH: $DST does not match $SRC in owners, SECURITY DEFINER, grants or RLS" >&2
  # Diagnostics only (names and counts; no row data): which top-level sections and which entries differ.
  DIAG_DIR="$(mktemp -d)"
  printf '%s\n' "$src_fp" > "$DIAG_DIR/src.json"
  printf '%s\n' "$dst_fp" > "$DIAG_DIR/dst.json"
  node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const x = a[k], y = b[k];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      console.error("differing section: " + k);
      if (x && y && typeof x === "object" && !Array.isArray(x)) {
        const names = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((n) => JSON.stringify(x[n]) !== JSON.stringify(y[n]));
        console.error("  entries differing (" + names.length + "): " + names.slice(0, 40).join(", "));
        const short = (v) => JSON.stringify(v).slice(0, 200);
        for (const n of names.slice(0, 12)) {
          if (x[n] === undefined || y[n] === undefined) {
            console.error("  " + n + ": " + (x[n] === undefined ? "missing in source" : "missing in clone"));
            continue;
          }
          const props = [...new Set([...Object.keys(x[n] || {}), ...Object.keys(y[n] || {})])]
            .filter((p) => JSON.stringify(x[n][p]) !== JSON.stringify(y[n][p]));
          for (const p of props) {
            const sv = x[n][p], dv = y[n][p];
            if (Array.isArray(sv) && Array.isArray(dv)) {
              const os = sv.filter((v) => !dv.includes(v)), od = dv.filter((v) => !sv.includes(v));
              console.error("  " + n + "." + p + " only in source (" + os.length + "): " + os.slice(0, 6).map((v) => String(v).slice(0, 200)).join(" | "));
              console.error("  " + n + "." + p + " only in clone (" + od.length + "): " + od.slice(0, 6).map((v) => String(v).slice(0, 200)).join(" | "));
            } else {
              console.error("  " + n + "." + p + " source=" + short(sv) + " clone=" + short(dv));
            }
          }
        }
      } else if (Array.isArray(x) && Array.isArray(y)) {
        const onlySrc = x.filter((v) => !y.includes(v)), onlyDst = y.filter((v) => !x.includes(v));
        console.error("  only in source (" + onlySrc.length + "): " + onlySrc.slice(0, 20).map((v) => String(v).slice(0, 160)).join(" | "));
        console.error("  only in clone (" + onlyDst.length + "): " + onlyDst.slice(0, 20).map((v) => String(v).slice(0, 160)).join(" | "));
      }
    }' "$DIAG_DIR/src.json" "$DIAG_DIR/dst.json" || echo "diagnostic could not parse the fingerprints" >&2
  rm -rf "$DIAG_DIR"
  exit 1
fi
echo "cloned $SRC -> $DST ($dst_probe functions|policies; security fingerprint matches)"
