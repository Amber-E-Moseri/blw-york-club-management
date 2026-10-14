#!/usr/bin/env bash
# F2 certification for CI and local use. Builds the disposable databases from the migration files of a LOCAL Supabase stack
# and runs supabase/verification/run_f2_ci.sh against them. Nothing hosted and no protected container is named: the database
# container is discovered as the local stack's supabase_db_* container, or taken from F2_DB_CONTAINER.
#
# Usage:  npx supabase start && scripts/certify-f2.sh
#
# Steps:
#   1. Replay migrations 000-097 (098 is moved aside for this step only and restored on exit). Verify the frontier is 097 and
#      the number of applied migrations. Copy that database to f2_policy.
#   2. Replay 000-098. Verify the frontier is 098. Copy it to f2_grants and f2_conc.
#   3. Run every F2 suite and the concurrency gate. The result is the exit status of this script.
#
# `supabase db reset` acts on the stack named by supabase/config.toml (project_id). A developer checkout can point that at a
# stack that must not be reset, so this script refuses to run outside CI unless the operator confirms an isolated stack with
# F2_ISOLATED_STACK=1 (for example, a copy of the repository with its own project_id).
set -euo pipefail

if [[ "${CI:-}" != "true" && "${F2_ISOLATED_STACK:-}" != "1" ]]; then
  echo "refused: this script resets the local Supabase stack named in supabase/config.toml." >&2
  echo "Run it in CI, or in a checkout whose config.toml names its own stack, and set F2_ISOLATED_STACK=1." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
MIG_DIR="supabase/migrations"
MOVED_098="supabase/migrations/098_f2_restrictive.sql"
WORK="$(mktemp -d)"
MOVED=0

restore_098() {
  if [[ "$MOVED" -eq 1 ]]; then
    mv "$WORK/098_f2_restrictive.sql" "$MOVED_098"
    MOVED=0
  fi
  rm -rf "$WORK"
}
trap restore_098 EXIT

DB_CONTAINER="${F2_DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1 || true)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "No supabase_db_* container found. Start the local stack first: npx supabase start" >&2
  exit 1
fi
PSQL="docker exec -i $DB_CONTAINER psql -U postgres"

# Expected migration count per frontier, taken from the files, so a missing file is detected rather than assumed.
FILES_TOTAL="$(ls "$MIG_DIR" | grep -c '^[0-9]\{3\}_.*\.sql$')"
FILES_TO_097=$((FILES_TOTAL - 1))

applied_count() { $PSQL -d postgres -X -At -c "select count(*) from supabase_migrations.schema_migrations"; }
applied_max() { $PSQL -d postgres -X -At -c "select max(version) from supabase_migrations.schema_migrations"; }

step() { printf '\n==> %s\n' "$1"; }

step "1. Replay migrations 000-097 (098 held aside)"
mv "$MOVED_098" "$WORK/098_f2_restrictive.sql"
MOVED=1
npx supabase db reset --local
if [[ "$(applied_max)" != "097" ]]; then
  echo "FRONTIER: expected the last applied migration to be 097, found $(applied_max)" >&2
  exit 1
fi
if [[ "$(applied_count)" != "$FILES_TO_097" ]]; then
  echo "FRONTIER: expected $FILES_TO_097 applied migrations at 097, found $(applied_count)" >&2
  exit 1
fi
echo "frontier 097 verified: $(applied_count) migrations applied"
$PSQL -d postgres -X -q -c "DROP DATABASE IF EXISTS f2_policy"
$PSQL -d postgres -X -q -c "CREATE DATABASE f2_policy TEMPLATE postgres"

step "2. Replay migrations 000-098"
restore_098
npx supabase db reset --local
if [[ "$(applied_max)" != "098" ]]; then
  echo "FRONTIER: expected the last applied migration to be 098, found $(applied_max)" >&2
  exit 1
fi
if [[ "$(applied_count)" != "$FILES_TOTAL" ]]; then
  echo "FRONTIER: expected $FILES_TOTAL applied migrations at 098, found $(applied_count)" >&2
  exit 1
fi
echo "frontier 098 verified: $(applied_count) migrations applied"
for db in f2_grants f2_conc; do
  $PSQL -d postgres -X -q -c "DROP DATABASE IF EXISTS $db"
  $PSQL -d postgres -X -q -c "CREATE DATABASE $db TEMPLATE postgres"
done

step "3. F2 suites and concurrency gate"
export F2_PSQL_CMD="$PSQL"
export F2_ALLOWED_DBS="f2_policy f2_grants f2_conc"
export F2_POLICY_DB=f2_policy F2_GRANTS_DB=f2_grants F2_CONC_DB=f2_conc
export F2_CONC_TRIALS="${F2_CONC_TRIALS:-20}"
bash supabase/verification/run_f2_ci.sh
