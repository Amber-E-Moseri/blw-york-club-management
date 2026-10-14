#!/usr/bin/env bash
# Full F2 SQL certification on DISPOSABLE clones. Exits nonzero if any suite fails, any check fails, or the schema contract
# does not hold. Clones must already exist with the stated migrations applied:
#   cert_a    : 000-096 (baseline; used only for the reproduction suite)
#   cert_n    : 000-097 (policy layer)
#   cert_f2   : 000-098 (grant layer; also the fingerprint source)
#   cert_f2c  : 000-098 (committed data, for the concurrency gate)
# Required environment: F2_PSQL_CMD and F2_ALLOWED_DBS (see run_f2_sql.sh).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${F2_PSQL_CMD:?set F2_PSQL_CMD}"; : "${F2_ALLOWED_DBS:?set F2_ALLOWED_DBS}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# Node needs native Windows paths under Git Bash; cygpath converts them where it exists.
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf %s "$1"; fi; }

echo "== 1/6 remediation suite, policy layer (cert_n)";   bash "$DIR/run_f2_sql.sh" cert_n policy   "$DIR/f2_suite_remediation.sql"
echo "== 2/6 remediation suite, grant layer (cert_f2)";   bash "$DIR/run_f2_sql.sh" cert_f2 grants   "$DIR/f2_suite_remediation.sql"
echo "== 3/6 import identity suite (cert_f2)";            bash "$DIR/run_f2_sql.sh" cert_f2 grants   "$DIR/f2_suite_import.sql"
echo "== 4/6 baseline reproduction, 096 (cert_a)";        bash "$DIR/run_f2_sql.sh" cert_a  policy   "$DIR/f2_suite_baseline_repro.sql"
echo "== 5/6 concurrency gate (cert_f2c)";                bash "$DIR/run_f2_concurrency.sh" cert_f2c 20
echo "== 6/6 schema contract on the 097/098 fingerprint (cert_f2)"
case "cert_f2" in cert_a|cert_b|cert_n|cert_f2|cert_f2c) ;; *) echo "refused" >&2; exit 2 ;; esac
$F2_PSQL_CMD -d cert_f2 -X -q -At < "$DIR/schema_fingerprint.sql" > "$TMP/fp.json"
node "$(winpath "$DIR/check_schema_contract.mjs")" "$(winpath "$TMP/fp.json")" --golden "$(winpath "$DIR/schema_fingerprint.golden.json")"
echo "ALL F2 SQL CERTIFICATION STEPS PASSED"
