#!/usr/bin/env bash
# F2 certification runner. Runs every F2 executable suite against DISPOSABLE databases whose names come from the
# environment. Nothing is hardcoded and no protected database is named here. Exits nonzero when any of these fails:
#   * an executable assertion (wrong SQLSTATE, wrong row count, wrong post-state, or an inverted expectation),
#   * the declared check count (a check that never ran),
#   * a database's migration frontier (its schema markers do not match the layer it claims to be),
#   * the concurrency gate (a deadlock, a refused row, a statement error or a wrong imported count).
#
# Required environment:
#   F2_PSQL_CMD     psql invocation that reaches the disposable server, e.g. "docker exec -i <container> psql -U postgres"
#   F2_ALLOWED_DBS  space-separated disposable database names this run may use
#   F2_POLICY_DB    database at the 097 frontier (policy layer)
#   F2_GRANTS_DB    database at the 098 frontier (grant layer); the import and membership suites run here
#   F2_CONC_DB      database at the 098 frontier with committed data; the concurrency gate runs here
# Optional environment:
#   F2_BASELINE_DB  database at the 096 frontier; runs the reproduction suite (skipped with a notice when unset)
#   F2_CONC_TRIALS  concurrency trials (default 20)
#   F2_SUITE_DIR    directory holding the suites, harness and fixture (default: this directory). Used for the failure proof.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SUITE_DIR="${F2_SUITE_DIR:-$DIR}"
: "${F2_PSQL_CMD:?set F2_PSQL_CMD to the psql command for the disposable server}"
: "${F2_ALLOWED_DBS:?set F2_ALLOWED_DBS to the disposable database names}"
: "${F2_POLICY_DB:?set F2_POLICY_DB (097 frontier)}"
: "${F2_GRANTS_DB:?set F2_GRANTS_DB (098 frontier)}"
: "${F2_CONC_DB:?set F2_CONC_DB (098 frontier, committed data)}"
TRIALS="${F2_CONC_TRIALS:-20}"
export F2_PSQL_CMD F2_ALLOWED_DBS

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
FAILED=0
ROWS=()

# One marker query per database, so a database built at the wrong frontier fails before any suite runs.
#   096: no batch function.  097: batch function, people UPDATE still granted.  098: batch function, people UPDATE revoked.
frontier() {
  local label="$1" db="$2" expect="$3" row batch upd
  row="$($F2_PSQL_CMD -d "$db" -X -At -c "select (select count(*) from pg_proc where proname = 'submit_contacts_batch'), has_table_privilege('authenticated', 'public.people', 'UPDATE')::int" 2>&1)" || { echo "FRONTIER: cannot read $db: $row" >&2; FAILED=1; return; }
  batch="${row%%|*}"; upd="${row##*|}"
  local ok=0
  case "$expect" in
    096) [[ "$batch" == 0 ]] && ok=1 ;;
    097) [[ "$batch" -ge 1 && "$upd" == 1 ]] && ok=1 ;;
    098) [[ "$batch" -ge 1 && "$upd" == 0 ]] && ok=1 ;;
  esac
  if [[ "$ok" == 1 ]]; then
    echo "frontier $label ($db) matches $expect: batch_function=$batch people_update_granted=$upd"
  else
    echo "FRONTIER MISMATCH $label ($db): expected $expect, found batch_function=$batch people_update_granted=$upd" >&2
    FAILED=1
  fi
}

# Runs one suite, keeps its output, and records the verdict line psql prints.
run_suite() {
  local label="$1" db="$2" layer="$3" suite="$4" code verdict
  echo
  echo "== $label ($db, $layer layer)"
  set +e
  bash "$DIR/run_f2_sql.sh" "$db" "$layer" "$suite" > "$LOG" 2>&1
  code=$?
  set -e
  cat "$LOG"
  verdict="$(grep -o 'F2 SQL VERDICT: .*' "$LOG" | tail -1 || true)"
  ROWS+=("$label | exit $code | ${verdict:-no verdict printed}")
  [[ "$code" -eq 0 ]] || FAILED=1
}

echo "== Migration frontier"
frontier "policy layer" "$F2_POLICY_DB" 097
frontier "grant layer" "$F2_GRANTS_DB" 098
frontier "concurrency data" "$F2_CONC_DB" 098

run_suite "remediation: policy layer" "$F2_POLICY_DB" policy "$SUITE_DIR/f2_suite_remediation.sql"
run_suite "remediation: grant layer" "$F2_GRANTS_DB" grants "$SUITE_DIR/f2_suite_remediation.sql"
run_suite "import and replay" "$F2_GRANTS_DB" grants "$SUITE_DIR/f2_suite_import.sql"
run_suite "membership and merge" "$F2_GRANTS_DB" grants "$SUITE_DIR/f2_suite_membership.sql"

echo
echo "== concurrency gate ($F2_CONC_DB, $TRIALS trials)"
set +e
bash "$DIR/run_f2_concurrency.sh" "$F2_CONC_DB" "$TRIALS" > "$LOG" 2>&1
code=$?
set -e
cat "$LOG"
ROWS+=("concurrency gate | exit $code | $(grep -o 'concurrency gate on .*' "$LOG" | tail -1 || echo 'no summary printed')")
[[ "$code" -eq 0 ]] || FAILED=1

if [[ -n "${F2_BASELINE_DB:-}" ]]; then
  frontier "baseline" "$F2_BASELINE_DB" 096
  run_suite "baseline reproduction (096)" "$F2_BASELINE_DB" policy "$SUITE_DIR/f2_suite_baseline_repro.sql"
else
  echo
  echo "NOTICE: baseline reproduction (096) not run: F2_BASELINE_DB is unset."
fi

echo
echo "== F2 certification summary"
for r in "${ROWS[@]}"; do echo "  $r"; done
if [[ "$FAILED" -ne 0 ]]; then
  echo "F2 CERTIFICATION: FAILED"
  exit 1
fi
echo "F2 CERTIFICATION: PASSED"
