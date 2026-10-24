#!/usr/bin/env bash
# Certification gate for the complete integrated migration chain (000-105). It replays EVERY migration, verifies the
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
TARGET_VERSION="105"
MANDATORY_DECLARED=68

version_of() { local base; base="$(basename "$1")"; echo $((10#${base%%_*})); }
TOTAL=0
for f in "$MIG_DIR"/*.sql; do TOTAL=$((TOTAL + 1)); done
[[ "$TOTAL" -gt 0 ]] || { echo "FAIL: no migrations found in $MIG_DIR" >&2; exit 1; }
LAST_FILE="$(ls "$MIG_DIR" | grep -E '^[0-9]{3}_.*\.sql$' | tail -1)"
if [[ "${LAST_FILE%%_*}" != "$TARGET_VERSION" ]]; then
  echo "FAIL: repository's last migration is ${LAST_FILE}, not ${TARGET_VERSION}" >&2
  exit 1
fi

# Exact chain validation. Fails closed: no fallback to an older range, no gaps, no duplicates, no stray files.
# F2_EXPECTED_SHA: the commit the workflow was asked to certify. It must equal HEAD (no silent substitution).
# F2_HISTORY_BASE: the reviewed commit whose 000-103 migrations are the accepted history. Each of those files must match it.
validate_chain() {
  local dir="$1" expect_count=106 n=0 seen=" " f base v i
  for f in "$dir"/*; do
    base="$(basename "$f")"
    if [[ ! "$base" =~ ^([0-9]{3})_[a-z0-9_]+\.sql$ ]]; then
      echo "FAIL: unexpected file in $dir: $base" >&2; return 1
    fi
    v=$((10#${BASH_REMATCH[1]}))
    if [[ "$seen" == *" $v "* ]]; then
      echo "FAIL: duplicate migration number $v ($base)" >&2; return 1
    fi
    seen="$seen$v "
    n=$((n + 1))
  done
  if [[ "$n" -ne "$expect_count" ]]; then
    echo "FAIL: expected $expect_count migrations, found $n" >&2; return 1
  fi
  for ((i = 0; i <= 105; i++)); do
    if [[ "$seen" != *" $i "* ]]; then
      echo "FAIL: migration number $i is missing (chain must be contiguous 000-105)" >&2; return 1
    fi
  done
  echo "chain: $n migrations, contiguous 000-105, no duplicates"
}

validate_chain "$MIG_DIR" || exit 1

[[ -n "${F2_EXPECTED_SHA:-}" ]] || { echo "FAIL: F2_EXPECTED_SHA is required (the explicitly selected candidate commit)" >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$F2_EXPECTED_SHA" ]] || { echo "FAIL: HEAD $(git rev-parse HEAD) is not the expected candidate $F2_EXPECTED_SHA" >&2; exit 1; }

[[ -n "${F2_HISTORY_BASE:-}" ]] || { echo "FAIL: F2_HISTORY_BASE is required (the reviewed history commit)" >&2; exit 1; }
git cat-file -e "${F2_HISTORY_BASE}^{commit}" 2>/dev/null || { echo "FAIL: history base $F2_HISTORY_BASE is not available (fetch full history)" >&2; exit 1; }
for ((i = 0; i <= 103; i++)); do
  for f in "$MIG_DIR"/$(printf '%03d' "$i")_*.sql; do
    [[ -f "$f" ]] || { echo "FAIL: historical migration $i is missing" >&2; exit 1; }
    if ! git diff --quiet "$F2_HISTORY_BASE" -- "$f"; then
      echo "FAIL: historical migration $(basename "$f") differs from the accepted history $F2_HISTORY_BASE" >&2; exit 1
    fi
  done
done
echo "history: 000-103 identical to $F2_HISTORY_BASE"

echo "==> 1. Replay the complete chain ($TOTAL files, last $TARGET_VERSION)"
npx supabase db reset --local

got_max="$("${PSQL[@]}" -d postgres -c "select max(version) from supabase_migrations.schema_migrations")"
got_cnt="$("${PSQL[@]}" -d postgres -c "select count(*) from supabase_migrations.schema_migrations")"
if [[ "$got_max" != "$TARGET_VERSION" || "$got_cnt" != "$TOTAL" ]]; then
  echo "FRONTIER: expected last $TARGET_VERSION with $TOTAL migrations, found $got_max with $got_cnt" >&2
  exit 1
fi
echo "frontier $TARGET_VERSION verified: $got_cnt migrations applied"

echo "==> 2. Clone the replay as f2_integrated105"
bash scripts/f2_clone_db.sh "$C" postgres f2_integrated105

echo "==> 3. Membership SQL suite on f2_integrated105 (grants layer)"
LOG="$OUT/membership-105.log"
set +e
F2_PSQL_CMD="docker exec -i $C psql -U $ADMIN" F2_ALLOWED_DBS="f2_integrated105" \
  bash supabase/verification/run_f2_sql.sh f2_integrated105 grants supabase/verification/f2_suite_membership.sql > "$LOG" 2>&1
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
FP="$OUT/schema_fingerprint.candidate-105.json"
"${PSQL[@]}" -d postgres -q < supabase/verification/schema_fingerprint.sql > "$FP"
[[ -s "$FP" ]] || { echo "FAIL: fingerprint is empty" >&2; exit 1; }
node supabase/verification/check_schema_contract.mjs "$FP" > "$OUT/contract-check-105.txt" 2>&1 || {
  cat "$OUT/contract-check-105.txt"
  echo "FAIL: schema contract check failed (see $OUT/contract-check-105.txt)" >&2
  exit 1
}
tail -1 "$OUT/contract-check-105.txt"
echo "PASS: integrated 105 frontier certified (candidate fingerprint written to $FP)"
