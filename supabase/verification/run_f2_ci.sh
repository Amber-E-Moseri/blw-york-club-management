#!/usr/bin/env bash
# F2 certification runner. Runs every MANDATORY F2 suite against DISPOSABLE databases whose names come from the
# environment, and fails (nonzero) unless every mandatory suite ran and passed. Nothing is hardcoded, and no protected
# database is named here.
#
# A run FAILS when any of these holds:
#   * an executable assertion fails (wrong SQLSTATE, row count, post-state, or an inverted expectation),
#   * a suite prints no verdict line (it did not run to completion), or its declared check count differs,
#   * a mandatory suite file or a mandatory database is missing (absence is never a pass),
#   * a database is not at the migration frontier its layer requires,
#   * the concurrency gate reports a deadlock, a refused row, a statement error or a wrong imported count.
#
# Required environment:
#   F2_PSQL_CMD     psql invocation that reaches the disposable server, e.g. "docker exec -i <container> psql -U <admin>"
#   F2_ALLOWED_DBS  space-separated disposable database names this run may use
#   F2_BASELINE_DB  database at the 096 frontier (reproduction suite, MANDATORY)
#   F2_POLICY_DB    database at the 097 frontier (policy layer)
#   F2_GRANTS_DB    database at the 098 frontier (grant layer; import and membership suites)
#   F2_CONC_DB      database at the 098 frontier with committed data (concurrency gate)
# Optional:
#   F2_CONC_TRIALS  concurrency trials (default 20)
#   F2_SUITE_DIR    directory holding the suites, harness and fixture. Used for negative controls. Must hold every mandatory suite.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SUITE_DIR="${F2_SUITE_DIR:-$DIR}"
: "${F2_PSQL_CMD:?set F2_PSQL_CMD to the psql command for the disposable server}"
: "${F2_ALLOWED_DBS:?set F2_ALLOWED_DBS to the disposable database names}"
: "${F2_BASELINE_DB:?the baseline reproduction database is mandatory (F2_BASELINE_DB, 096 frontier)}"
: "${F2_POLICY_DB:?set F2_POLICY_DB (097 frontier)}"
: "${F2_GRANTS_DB:?set F2_GRANTS_DB (098 frontier)}"
: "${F2_CONC_DB:?set F2_CONC_DB (098 frontier, committed data)}"
TRIALS="${F2_CONC_TRIALS:-20}"
export F2_PSQL_CMD F2_ALLOWED_DBS

MANDATORY_SUITES=(f2_suite_baseline_repro.sql f2_suite_remediation.sql f2_suite_import.sql f2_suite_membership.sql)
# Runs that must complete: baseline, remediation on the policy layer, remediation on the grant layer, import, membership,
# and the concurrency gate. A run that does not complete counts as a failure.
EXPECTED_RUNS=6
for s in "${MANDATORY_SUITES[@]}"; do
  if [[ ! -f "$SUITE_DIR/$s" ]]; then
    echo "MISSING MANDATORY SUITE: $SUITE_DIR/$s. A missing suite is a failure, not a skip." >&2
    exit 1
  fi
done
for f in f2_harness.sql f2_fixture.sql; do
  [[ -f "$DIR/$f" ]] || { echo "MISSING: $DIR/$f" >&2; exit 1; }
done

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
FAILED=0
ROWS=()
RAN=()

# One marker query per database, so a database built at the wrong frontier fails before any suite runs.
#   096: no batch function.  097: batch function, people UPDATE still granted.  098: batch function, people UPDATE revoked,
#   and membership transitions restricted to staff (the 098 membership policy).
# The marker alone is not enough: a database that also has 099-101 satisfies the 098 marker. So the database must also
# report the exact last applied version, and an applied count equal to the number of repository migrations at or below
# that frontier. Both come from the database's own ledger; the expected count is derived from the files.
MIGRATION_DIR="$DIR/../migrations"
expected_migrations_upto() {
  local frontier="$1" f n=0 v
  for f in "$MIGRATION_DIR"/*.sql; do
    v="$(basename "$f")"; v=$((10#${v%%_*}))
    (( v <= 10#$frontier )) && n=$((n + 1))
  done
  echo "$n"
}

frontier() {
  local label="$1" db="$2" expect="$3" row batch upd maxver cnt want_cnt
  row="$($F2_PSQL_CMD -d "$db" -X -At -c "select (select count(*) from pg_proc where proname = 'submit_contacts_batch'), has_table_privilege('authenticated', 'public.people', 'UPDATE')::int, (select max(version) from supabase_migrations.schema_migrations), (select count(*) from supabase_migrations.schema_migrations)" 2>&1)" || { echo "FRONTIER: cannot read $db: $row" >&2; FAILED=1; return; }
  IFS='|' read -r batch upd maxver cnt <<< "$row"
  want_cnt="$(expected_migrations_upto "$expect")"
  local ok=0
  case "$expect" in
    096) [[ "$batch" == 0 ]] && ok=1 ;;
    097) [[ "$batch" -ge 1 && "$upd" == 1 ]] && ok=1 ;;
    098) [[ "$batch" -ge 1 && "$upd" == 0 ]] && ok=1 ;;
  esac
  if [[ "$ok" == 1 && "$maxver" == "$expect" && "$cnt" == "$want_cnt" ]]; then
    echo "frontier $label ($db) matches $expect: last=$maxver applied=$cnt batch_function=$batch people_update_granted=$upd"
  else
    echo "FRONTIER MISMATCH $label ($db): expected last $expect with $want_cnt migrations; found last=$maxver applied=$cnt batch_function=$batch people_update_granted=$upd" >&2
    FAILED=1
  fi
}

# Runs one suite. It is a pass only when psql exits 0 AND prints the verdict line AND the verdict reports zero failures.
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
  RAN+=("$label")
  if [[ -z "$verdict" ]]; then
    echo "NO VERDICT PRINTED for $label: the suite did not complete" >&2
    FAILED=1
    ROWS+=("$label | exit $code | NO VERDICT")
    return
  fi
  ROWS+=("$label | exit $code | $verdict")
  [[ "$code" -eq 0 ]] || FAILED=1
  if [[ "$verdict" == *", 0 failed"* && "$code" -eq 0 ]]; then
    :
  else
    FAILED=1
  fi
}

echo "== Migration frontier"
frontier "baseline" "$F2_BASELINE_DB" 096
frontier "policy layer" "$F2_POLICY_DB" 097
frontier "grant layer" "$F2_GRANTS_DB" 098
frontier "concurrency data" "$F2_CONC_DB" 098

run_suite "baseline reproduction (096)" "$F2_BASELINE_DB" policy "$SUITE_DIR/f2_suite_baseline_repro.sql"
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
summary="$(grep -o 'concurrency gate on .*' "$LOG" | tail -1 || true)"
RAN+=("concurrency gate")
if [[ -z "$summary" ]]; then
  echo "NO SUMMARY PRINTED for the concurrency gate" >&2
  FAILED=1
  ROWS+=("concurrency gate | exit $code | NO SUMMARY")
else
  ROWS+=("concurrency gate | exit $code | $summary")
fi
[[ "$code" -eq 0 ]] || FAILED=1

echo
echo "== F2 certification summary"
for r in "${ROWS[@]}"; do echo "  $r"; done
echo "  mandatory runs completed: ${#RAN[@]} of $EXPECTED_RUNS (baseline, remediation policy, remediation grants, import, membership, concurrency)"
if [[ "${#RAN[@]}" -ne "$EXPECTED_RUNS" ]]; then
  echo "F2 CERTIFICATION: FAILED (a mandatory run did not execute)" >&2
  exit 1
fi
if [[ "$FAILED" -ne 0 ]]; then
  echo "F2 CERTIFICATION: FAILED"
  exit 1
fi
echo "F2 CERTIFICATION: PASSED"
