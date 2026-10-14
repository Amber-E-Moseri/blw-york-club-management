#!/usr/bin/env bash
# Runs one F2 SQL suite against a DISPOSABLE clone, inside a single transaction that is always rolled back.
#   usage: run_f2_sql.sh <database> <layer: policy|grants> <suite.sql>
# The database must be a disposable clone. Protected databases are refused by name. Exit status is psql's: 0 only when
# every executable assertion passed and the declared check count matched. Any failure, error or missing check is nonzero.
set -euo pipefail
DB="${1:?database}"; LAYER="${2:?layer}"; SUITE="${3:?suite file}"
case "$DB" in
  cert_a|cert_b|cert_n|cert_f2|cert_f2c) ;;
  *) echo "refused: '$DB' is not an approved disposable clone" >&2; exit 2 ;;
esac
case "$LAYER" in policy|grants) ;; *) echo "layer must be policy or grants" >&2; exit 2 ;; esac
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="${PSQL_CMD:-docker exec -i pg-blwrc96 psql -U supabase_admin}"
{ echo "BEGIN;"; cat "$DIR/f2_harness.sql"; cat "$DIR/f2_fixture.sql"; cat "$SUITE"; echo "ROLLBACK;"; } \
  | $PSQL -d "$DB" -X -v ON_ERROR_STOP=1 -v layer="$LAYER"
