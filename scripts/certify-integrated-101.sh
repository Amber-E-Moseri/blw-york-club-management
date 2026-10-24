#!/usr/bin/env bash
# Certification gate for the complete integrated migration chain (000-101). It replays EVERY migration, verifies the
# frontier by last version AND applied count, clones the result, runs the membership SQL suite on the clone, and checks a
# CANDIDATE schema fingerprint against the schema contract. It never reads or writes the authoritative golden fingerprint.
#
# Fails closed: a missing suite, a missing verdict, a declared/recorded count mismatch, any failed check, a frontier or
# count mismatch, or a missing output directory all exit nonzero.
#
# Authorization: the same as scripts/certify-f2.sh (F2_DISPOSABLE_PROJECT_ID, config.toml match, GITHUB_ACTIONS=true or
# F2_CONFIRM_PROJECT, and a running supabase_db_<id> container). Additionally:
#   F2_OUT_DIR  an existing directory outside the repository for the candidate fingerprint and the logs (required).
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/f2_target_guard.sh

ID="${F2_DISPOSABLE_PROJECT_ID:-}"
if [[ -z "$ID" ]]; then
  echo "refused: set F2_DISPOSABLE_PROJECT_ID to the disposable project id" >&2
  exit 2
fi
f2_guard_static "$ID" || exit 2
NAMES="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
f2_guard_container "$ID" "$NAMES" || exit 2

OUT="${F2_OUT_DIR:?set F2_OUT_DIR to an existing directory outside the repository}"
[[ -d "$OUT" ]] || { echo "refused: F2_OUT_DIR '$OUT' is not a directory" >&2; exit 2; }

C="supabase_db_$ID"
ADMIN="${F2_DB_ADMIN:-postgres}"
PSQL=(docker exec -i "$C" psql -U "$ADMIN" -X -At)
MIG_DIR="supabase/migrations"
TARGET_VERSION="101"
MANDATORY_DECLARED=68

# Historical gate: the chain as it stood at 101. Migrations above 101 are held aside for this replay only, exactly as
# scripts/certify-f2.sh does, and restored afterwards. The repository's chain is not changed. The current head is certified
# separately by scripts/certify-integrated-105.sh.
HOLD_DIR="$(mktemp -d)"
MOVED=()
source scripts/f2_frontier_lib.sh
trap 'restore_moved; rm -rf "$HOLD_DIR"' EXIT

TOTAL="$(expected_count "$TARGET_VERSION")"
[[ "$TOTAL" -gt 0 ]] || { echo "FAIL: no migrations at or below $TARGET_VERSION in $MIG_DIR" >&2; exit 1; }

echo "==> 1. Replay the chain through $TARGET_VERSION ($TOTAL files; migrations above $TARGET_VERSION held aside)"
hold_above "$TARGET_VERSION"
npx supabase db reset --local

got_max="$("${PSQL[@]}" -d postgres -c "select max(version) from supabase_migrations.schema_migrations")"
got_cnt="$("${PSQL[@]}" -d postgres -c "select count(*) from supabase_migrations.schema_migrations")"
if [[ "$got_max" != "$TARGET_VERSION" || "$got_cnt" != "$TOTAL" ]]; then
  echo "FRONTIER: expected last $TARGET_VERSION with $TOTAL migrations, found $got_max with $got_cnt" >&2
  exit 1
fi
echo "frontier $TARGET_VERSION verified: $got_cnt migrations applied"
restore_moved

echo "==> 2. Clone the replay as f2_integrated101"
bash scripts/f2_clone_db.sh "$C" postgres f2_integrated101

echo "==> 3. Membership SQL suite on f2_integrated101 (grants layer)"
LOG="$OUT/membership-101.log"
set +e
F2_PSQL_CMD="docker exec -i $C psql -U $ADMIN" F2_ALLOWED_DBS="f2_integrated101" \
  bash supabase/verification/run_f2_sql.sh f2_integrated101 grants supabase/verification/f2_suite_membership.sql > "$LOG" 2>&1
code=$?
set -e
cat "$LOG"
verdict="$(grep -o 'F2 SQL VERDICT: .*' "$LOG" | tail -1 || true)"
if [[ -z "$verdict" ]]; then
  echo "FAIL: membership suite printed no verdict" >&2
  exit 1
fi
if [[ "$code" -ne 0 ]]; then
  echo "FAIL: membership suite exited $code" >&2
  exit 1
fi
if [[ "$verdict" != "F2 SQL VERDICT: $MANDATORY_DECLARED checks recorded (declared $MANDATORY_DECLARED), 0 failed" ]]; then
  echo "FAIL: membership verdict does not match the declared $MANDATORY_DECLARED checks with 0 failed: $verdict" >&2
  exit 1
fi
echo "membership suite: $verdict"

echo "==> 4. Candidate schema fingerprint and contract check (no golden is read or written)"
FP="$OUT/schema_fingerprint.candidate-101.json"
"${PSQL[@]}" -d postgres -q < supabase/verification/schema_fingerprint.sql > "$FP"
[[ -s "$FP" ]] || { echo "FAIL: fingerprint is empty" >&2; exit 1; }
# The contract as it stood at 101 (supabase/verification/history/schema_contract.101.json, taken from 4d4eb3d). The current
# contract covers 102-105 and would reject a correct 101 frontier.
node supabase/verification/check_schema_contract.mjs "$FP" --contract supabase/verification/history/schema_contract.101.json > "$OUT/contract-check-101.txt" 2>&1 || {
  cat "$OUT/contract-check-101.txt"
  echo "FAIL: schema contract check failed (see $OUT/contract-check-101.txt)" >&2
  exit 1
}
tail -1 "$OUT/contract-check-101.txt"
echo "PASS: integrated 101 frontier certified (candidate fingerprint written to $FP)"
