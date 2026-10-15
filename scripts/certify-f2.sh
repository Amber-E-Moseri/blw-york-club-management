#!/usr/bin/env bash
# F2 certification builder. Builds four disposable databases from the migration files of a DISPOSABLE local Supabase
# stack, then runs supabase/verification/run_f2_ci.sh against them. The complete integrated 101 frontier is certified
# separately by scripts/certify-integrated-101.sh.
#
# Authorization (all required, checked before anything is reset; see scripts/f2_target_guard.sh):
#   F2_DISPOSABLE_PROJECT_ID  the disposable project id. It must start with "f2"; protected names are refused.
#   supabase/config.toml     must name the same project id (the reset acts on that project only).
#   GITHUB_ACTIONS=true      a fresh CI runner, OR F2_CONFIRM_PROJECT equal to the id (typed confirmation).
#   The container supabase_db_<id> must be running.
# CI=true and F2_ISOLATED_STACK=1 are not authorization.
#
# Frontiers. Each replay holds back EVERY migration whose version is above the frontier, so a later migration (099-101
# in the integrated chain) can never leak into an earlier database. Each frontier is verified by the last applied
# version AND the applied-migration count, which is derived from the files (not hard-coded).
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
ADMIN="${F2_DB_ADMIN:-postgres}"
PSQL=(docker exec -i "$C" psql -U "$ADMIN" -X -At)

MIG_DIR="supabase/migrations"
HOLD_DIR="$(mktemp -d)"
MOVED=()
# version_of, expected_count, hold_above and restore_moved live in one library, which scripts/test_f2_frontier.sh tests.
source scripts/f2_frontier_lib.sh
trap 'restore_moved; rm -rf "$HOLD_DIR"' EXIT

step() { printf '\n==> %s\n' "$1"; }

applied_max() { "${PSQL[@]}" -d postgres -c "select max(version) from supabase_migrations.schema_migrations"; }
applied_count() { "${PSQL[@]}" -d postgres -c "select count(*) from supabase_migrations.schema_migrations"; }

verify_frontier() { # frontier, expected count
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

# Replays the migration directory to one frontier, verifies it, and clones it under the given name.
build_frontier() { # frontier, clone name(s)...
  local frontier="$1"; shift
  hold_above "$frontier"
  npx supabase db reset --local
  verify_frontier "$frontier" "$(expected_count "$frontier")"
  restore_moved
  local db
  for db in "$@"; do clone "$db"; done
}

step "1. Replay to 096 (097 and later held aside), clone f2_baseline"
build_frontier 096 f2_baseline

step "2. Replay to 097 (098 and later held aside), clone f2_policy"
build_frontier 097 f2_policy

step "3. Replay to 098 (099 and later held aside), clone f2_grants and f2_conc"
build_frontier 098 f2_grants f2_conc

step "3b. Replay to 100 (101 held aside), clone f2_membership (the membership suite calls establish_membership, created by 100)"
build_frontier 100 f2_membership

step "4. F2 suites, concurrency gate and baseline reproduction"
export F2_PSQL_CMD="docker exec -i $C psql -U $ADMIN"
export F2_ALLOWED_DBS="f2_baseline f2_policy f2_grants f2_conc f2_membership"
export F2_BASELINE_DB=f2_baseline F2_POLICY_DB=f2_policy F2_GRANTS_DB=f2_grants F2_CONC_DB=f2_conc F2_MEMBERSHIP_DB=f2_membership
export F2_CONC_TRIALS="${F2_CONC_TRIALS:-20}"
bash supabase/verification/run_f2_ci.sh
