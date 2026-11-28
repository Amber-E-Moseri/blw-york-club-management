#!/usr/bin/env bash
# PostgreSQL 17 rehearsal for Linux or macOS cloud environments. Mirrors run-pg17-rehearsal.ps1.
# Replays supabase/migrations 000-059 into a scratch cluster and runs the schema contract against the golden.
# No Docker, no hosted project, no ledger, no reset of anything except the scratch cluster.
#
# Usage: PG_BIN=/path/to/pg17/bin SCRATCH=/abs/path/outside/repo PORT=54317 ./run-pg17-rehearsal.sh
# Do not run as root (initdb refuses). Requires psql, initdb, pg_ctl and postgres for PostgreSQL 17.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
PG_BIN="${PG_BIN:?set PG_BIN to a PostgreSQL 17 bin directory}"
SCRATCH="${SCRATCH:?set SCRATCH to a scratch folder outside the repository}"
PORT="${PORT:-54317}"
MAX="${MAX_MIGRATION:-59}"
DB=rehearsal
[ "$(id -u)" -ne 0 ] || { echo "refusing to run as root" >&2; exit 2; }
case "$SCRATCH" in "$REPO"*) echo "SCRATCH must be outside the repository" >&2; exit 2;; esac

# Refuse CRLF migrations: function text hashes would differ from the golden.
if grep -l $'\r' "$REPO"/supabase/migrations/*.sql >/dev/null 2>&1; then
  echo "CRLF found in supabase/migrations; re-checkout with LF (see .gitattributes)." >&2; exit 2
fi

mkdir -p "$SCRATCH"
[ -f "$SCRATCH/data/PG_VERSION" ] || "$PG_BIN/initdb" -D "$SCRATCH/data" -U postgres --auth=trust -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$SCRATCH/data" status >/dev/null 2>&1 || "$PG_BIN/pg_ctl" -D "$SCRATCH/data" -l "$SCRATCH/server.log" -o "-p $PORT -k $SCRATCH" -w start >/dev/null
PSQL="${PSQL:-$PG_BIN/psql}"; [ -x "$PSQL" ] || PSQL="$(command -v psql)"
P=("$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -X -q)

"${P[@]}" -At -d postgres -c "drop database if exists $DB" -c "create database $DB" -c "alter database $DB set search_path to extensions, public" >/dev/null
"${P[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO/supabase/verification/rehearsal/roles.sql" -f "$REPO/supabase/verification/rehearsal/stubs.sql" >"$SCRATCH/stubs.log" 2>&1

applied=0; total=0
for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
  n=$((10#$(basename "$f" | cut -c1-3)))
  [ "$n" -le "$MAX" ] || continue
  total=$((total + 1))
  "${P[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >"$SCRATCH/mig.log" 2>&1 || { echo "migration failed: $(basename "$f")"; tail -n 3 "$SCRATCH/mig.log"; exit 1; }
  applied=$((applied + 1))
done
echo "applied=$applied of $total"

"${P[@]}" -At -d "$DB" -c 'set search_path = public, pg_temp' -o "$SCRATCH/fingerprint.json" -f "$REPO/supabase/verification/schema_fingerprint.sql"
cd "$REPO" && node supabase/verification/check_schema_contract.mjs "$SCRATCH/fingerprint.json" --golden supabase/verification/schema_fingerprint.golden.json
