#!/usr/bin/env bash
# Clones database SRC into a NEW database DST inside container C, through pg_dump and pg_restore. Unlike
# CREATE DATABASE ... TEMPLATE, this works while other sessions are connected to SRC (a Supabase stack keeps sessions open
# on the postgres database). The clone is checked against the source: the function and policy counts must match.
#   usage: f2_clone_db.sh <container> <source database> <new database>
#   F2_DB_ADMIN names the superuser role that restores the clone (default postgres; must be a superuser).
set -euo pipefail
ROLE="${F2_DB_ADMIN:-postgres}"
C="${1:?container}"; SRC="${2:?source database}"; DST="${3:?new database}"

for n in "$SRC" "$DST"; do
  case "$n" in
    *canon*|*prod*|*live*|*blw*) echo "refused: '$n' is a protected name" >&2; exit 2 ;;
  esac
done
if [[ ! "$DST" =~ ^f2_[a-z0-9_]+$ ]]; then
  echo "refused: the new database '$DST' must start with f2_ and use lowercase letters, digits or underscores" >&2
  exit 2
fi
if [[ "$SRC" == "$DST" ]]; then
  echo "refused: source and new database are the same" >&2
  exit 2
fi

DUMP="/tmp/${DST}.dump"
q() { docker exec -i "$C" psql -U "$ROLE" -d "$1" -X -At -c "$2"; }

docker exec "$C" pg_dump -U "$ROLE" -Fc -f "$DUMP" "$SRC"
docker exec "$C" psql -U "$ROLE" -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DST\""
docker exec "$C" createdb -U "$ROLE" "$DST"
docker exec "$C" pg_restore -U "$ROLE" -d "$DST" --exit-on-error "$DUMP"
docker exec "$C" rm -f "$DUMP"

# The clone must have the same functions and policies as the source, or it is refused.
probe="select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace), (select count(*) from pg_policy)"
src_probe="$(q "$SRC" "$probe")"
dst_probe="$(q "$DST" "$probe")"
if [[ "$src_probe" != "$dst_probe" ]]; then
  echo "CLONE MISMATCH: $SRC=[$src_probe] $DST=[$dst_probe]" >&2
  exit 1
fi
echo "cloned $SRC -> $DST ($dst_probe functions|policies)"
