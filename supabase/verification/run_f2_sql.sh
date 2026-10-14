#!/usr/bin/env bash
# Runs one F2 SQL suite against a DISPOSABLE database, inside a single transaction that is always rolled back.
#   usage: run_f2_sql.sh <database> <layer: policy|grants> <suite.sql>
#
# Required environment (no default target is assumed):
#   F2_PSQL_CMD     the psql invocation that reaches the disposable server, e.g.
#                   "docker exec -i <container> psql -U <role>" or "psql -h 127.0.0.1 -p 54322 -U <role>"
#   F2_ALLOWED_DBS  space-separated list of disposable database names this run may use, e.g. "cert_f2 cert_f2c"
#
# A database name must appear in F2_ALLOWED_DBS, and names that look production-like are refused regardless.
# Exit status is psql's: 0 only when every executable assertion passed and the declared check count matched.
set -euo pipefail
DB="${1:?database}"; LAYER="${2:?layer}"; SUITE="${3:?suite file}"
: "${F2_PSQL_CMD:?set F2_PSQL_CMD to the psql command for a disposable server}"
: "${F2_ALLOWED_DBS:?set F2_ALLOWED_DBS to the disposable database names allowed for this run}"

case "$DB" in
  *canon*|*prod*|*production*|*live*) echo "refused: '$DB' looks like a protected database" >&2; exit 2 ;;
esac
ALLOWED=" $F2_ALLOWED_DBS "
case "$ALLOWED" in
  *" $DB "*) ;;
  *) echo "refused: '$DB' is not listed in F2_ALLOWED_DBS" >&2; exit 2 ;;
esac
case "$LAYER" in policy|grants) ;; *) echo "layer must be policy or grants" >&2; exit 2 ;; esac

DIR="$(cd "$(dirname "$0")" && pwd)"
{ echo "BEGIN;"; cat "$DIR/f2_harness.sql"; cat "$DIR/f2_fixture.sql"; cat "$SUITE"; echo "ROLLBACK;"; } \
  | $F2_PSQL_CMD -d "$DB" -X -v ON_ERROR_STOP=1 -v layer="$LAYER"
