#!/usr/bin/env bash
# F2 certification builder. Builds four disposable databases from the migration files of a DISPOSABLE local Supabase
# stack, then runs supabase/verification/run_f2_ci.sh against them.
#
# Authorization (all required, checked before anything is reset; see scripts/f2_target_guard.sh):
#   F2_DISPOSABLE_PROJECT_ID  the disposable project id. It must start with "f2"; protected names are refused.
#   supabase/config.toml     must name the same project id (the reset acts on that project only).
#   GITHUB_ACTIONS=true      a fresh CI runner, OR F2_CONFIRM_PROJECT equal to the id (typed confirmation).
#   The container supabase_db_<id> must be running.
# CI=true and F2_ISOLATED_STACK=1 are not authorization.
#
# Frontiers, each verified by the applied-migration count and the last applied version:
#   096  f2_baseline   (the reproduction suite; mandatory)
#   097  f2_policy     (policy layer)
#   098  f2_grants     (grant layer, import and membership suites)  and  f2_conc (concurrency data)
#
# Each database is a dump-and-restore clone, which works while other sessions are connected.
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
C="supabase_db_$ID"
PSQL=(docker exec -i "$C" psql -U "${F2_DB_ADMIN:-postgres}" -X -At)
ADMIN="${F2_DB_ADMIN:-postgres}"

MIG_DIR="supabase/migrations"
MOVED=()
restore_moved() {
  local f
  for f in "${MOVED[@]:-}"; do
    [[ -n "$f" && -f "/tmp/f2-held/$(basename "$f")" ]] && mv "/tmp/f2-held/$(basename "$f")" "$f"
  done
  MOVED=()
}
trap restore_moved EXIT

hold() { # move a migration aside for one replay
  mkdir -p /tmp/f2-held
  mv "$1" "/tmp/f2-held/$(basename "$1")"
  MOVED+=("$1")
}

FILES_TOTAL="$(ls "$MIG_DIR" | grep -c '^[0-9]\{3\}_.*\.sql$')"
step() { printf '\n==> %s\n' "$1"; }

applied_max() { "${PSQL[@]}" -d postgres -c "select max(version) from supabase_migrations.schema_migrations"; }
applied_count() { "${PSQL[@]}" -d postgres -c "select count(*) from supabase_migrations.schema_migrations"; }

verify_frontier() { # expected last version, expected count
  local want_version="$1" want_count="$2" got_version got_count
  got_version="$(applied_max)"
  got_count="$(applied_count)"
  if [[ "$got_version" != "$want_version" || "$got_count" != "$want_count" ]]; then
    echo "FRONTIER: expected last $want_version with $want_count migrations, found $got_version with $got_count" >&2
    exit 1
  fi
  echo "frontier $want_version verified: $got_count migrations applied"
}

clone() { bash scripts/f2_clone_db.sh "$C" postgres "$1"; }

step "1. Replay to 096 (097 and 098 held aside), clone f2_baseline"
hold "$MIG_DIR/097_f2_submit_contact.sql"
hold "$MIG_DIR/098_f2_restrictive.sql"
npx supabase db reset --local
verify_frontier 096 "$((FILES_TOTAL - 2))"
clone f2_baseline
restore_moved

step "2. Replay to 097 (098 held aside), clone f2_policy"
hold "$MIG_DIR/098_f2_restrictive.sql"
npx supabase db reset --local
verify_frontier 097 "$((FILES_TOTAL - 1))"
clone f2_policy
restore_moved

step "3. Replay to 098, clone f2_grants and f2_conc"
npx supabase db reset --local
verify_frontier 098 "$FILES_TOTAL"
clone f2_grants
clone f2_conc

step "4. F2 suites, concurrency gate and baseline reproduction"
export F2_PSQL_CMD="docker exec -i $C psql -U $ADMIN"
export F2_ALLOWED_DBS="f2_baseline f2_policy f2_grants f2_conc"
export F2_BASELINE_DB=f2_baseline F2_POLICY_DB=f2_policy F2_GRANTS_DB=f2_grants F2_CONC_DB=f2_conc
export F2_CONC_TRIALS="${F2_CONC_TRIALS:-20}"
bash supabase/verification/run_f2_ci.sh
