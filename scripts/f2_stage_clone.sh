#!/usr/bin/env bash
# Stages and restores a clone of a replayed database for the F2 certification.
#
# Why this exists: `supabase db reset --local` recreates the local stack, so a clone made during one frontier replay is
# gone by the next replay. `stage` dumps the source database and records its security fingerprint OUTSIDE the stack.
# `restore` rebuilds the clone after the last replay and checks it against that recorded fingerprint, so every clone is
# still verified against the database it was taken from (the same owner, SECURITY DEFINER, grant, RLS, policy, trigger,
# index and constraint comparison that scripts/f2_clone_db.sh performs).
#
#   usage: f2_stage_clone.sh stage   <container> <source database> <new database> <dir>
#          f2_stage_clone.sh restore <container> <new database> <dir>
#   F2_DB_ADMIN names the superuser role. On the local Supabase stack that is supabase_admin: the postgres role is not a
#   superuser, so restoring objects it does not own fails with "must be able to SET ROLE".
set -euo pipefail

MODE="${1:?mode: stage or restore}"
C="${2:?container}"
ROLE="${F2_DB_ADMIN:-postgres}"
FP_SQL="$(dirname "$0")/../supabase/verification/schema_fingerprint.sql"
FP_CMP="$(dirname "$0")/f2_fingerprint_compare.js"

guard_name() {
  local n="$1"
  case "$n" in
    *canon*|*prod*|*live*|*blw*) echo "refused: '$n' is a protected name" >&2; exit 2 ;;
  esac
  if [[ ! "$n" =~ ^f2_[a-z0-9_]+$ ]]; then
    echo "refused: '$n' must start with f2_ and use lowercase letters, digits or underscores" >&2
    exit 2
  fi
}

probe_sql="select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace), (select count(*) from pg_policy)"
q() { docker exec -i "$C" psql -U "$ROLE" -d "$1" -X -At -c "$2"; }

if [[ "$MODE" == "stage" ]]; then
  SRC="${3:?source database}"; DST="${4:?new database}"; DIR="${5:?staging directory}"
  guard_name "$DST"
  [[ "$SRC" != "$DST" ]] || { echo "refused: source and new database are the same" >&2; exit 2; }
  [[ -d "$DIR" ]] || { echo "refused: staging directory '$DIR' does not exist" >&2; exit 2; }
  [[ -f "$FP_SQL" ]] || { echo "refused: $FP_SQL is missing; the clone cannot be verified" >&2; exit 2; }

  docker exec "$C" pg_dump -U "$ROLE" -Fc "$SRC" > "$DIR/$DST.dump"
  q "$SRC" "$probe_sql" > "$DIR/$DST.src.probe"
  docker exec -i "$C" psql -U "$ROLE" -d "$SRC" -X -q -At < "$FP_SQL" > "$DIR/$DST.src.json"
  [[ -s "$DIR/$DST.src.json" ]] || { echo "refused: the source fingerprint of $SRC is empty" >&2; exit 1; }
  echo "staged $SRC -> $DIR/$DST.dump ($(cat "$DIR/$DST.src.probe") functions|policies recorded)"
  exit 0
fi

if [[ "$MODE" == "restore" ]]; then
  DST="${3:?new database}"; DIR="${4:?staging directory}"
  guard_name "$DST"
  for f in "$DIR/$DST.dump" "$DIR/$DST.src.probe" "$DIR/$DST.src.json"; do
    [[ -s "$f" ]] || { echo "refused: staged file $f is missing or empty; $DST cannot be verified" >&2; exit 1; }
  done

  docker exec -i "$C" psql -U "$ROLE" -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DST\""
  docker exec "$C" createdb -U "$ROLE" "$DST"
  docker exec -i "$C" pg_restore -U "$ROLE" -d "$DST" --exit-on-error < "$DIR/$DST.dump"

  want_probe="$(cat "$DIR/$DST.src.probe")"
  dst_probe="$(q "$DST" "$probe_sql")"
  if [[ "$want_probe" != "$dst_probe" ]]; then
    echo "CLONE MISMATCH: staged source=[$want_probe] restored $DST=[$dst_probe]" >&2
    exit 1
  fi

  dst_fp="$(docker exec -i "$C" psql -U "$ROLE" -d "$DST" -X -q -At < "$FP_SQL")"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  cp "$DIR/$DST.src.json" "$TMP/src.json"
  printf '%s\n' "$dst_fp" > "$TMP/dst.json"
  set +e
  node "$FP_CMP" "$TMP/src.json" "$TMP/dst.json"
  fp_rc=$?
  set -e
  case "$fp_rc" in
    0) ;;
    2) echo "CLONE FINGERPRINT INVALID: the restored $DST or its staged source is malformed or incomplete." >&2; exit 1 ;;
    *) echo "CLONE FINGERPRINT MISMATCH: restored $DST does not match its staged source in owners, SECURITY DEFINER, grants, RLS or constraints." >&2; exit 1 ;;
  esac
  echo "restored $DST from staged source ($dst_probe functions|policies; security fingerprint matches)"
  exit 0
fi

echo "refused: unknown mode '$MODE' (use stage or restore)" >&2
exit 2
