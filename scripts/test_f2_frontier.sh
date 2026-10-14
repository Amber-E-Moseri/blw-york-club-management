#!/usr/bin/env bash
# Non-destructive test of the frontier selection used by scripts/certify-f2.sh. It works on a TEMPORARY copy of the
# migration file names, never on the repository's migrations, and it does not run Docker or any database.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/f2_frontier_lib.sh

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MIG_DIR="$WORK/migrations"
HOLD_DIR="$WORK/held"
mkdir -p "$MIG_DIR" "$HOLD_DIR"
MOVED=()
# Same names as the repository's chain, with empty contents: this test checks selection, not SQL.
for f in supabase/migrations/*.sql; do : > "$MIG_DIR/$(basename "$f")"; done

fails=0
check() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then echo "PASS | $1 | $3"; else echo "FAIL | $1 | expected $2, got $3"; fails=$((fails + 1)); fi
}

check "count at 096" 97 "$(expected_count 096)"
check "count at 097" 98 "$(expected_count 097)"
check "count at 098" 99 "$(expected_count 098)"
check "count at 101 (whole chain)" "$(ls "$MIG_DIR" | wc -l | tr -d ' ')" "$(expected_count 101)"

hold_above 096
check "held at 096 (count of files above 096)" 5 "${#MOVED[@]}"
check "remaining at 096" 97 "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"
check "last remaining at 096" 096 "$(ls "$MIG_DIR" | tail -1 | cut -c1-3)"
restore_moved
check "restore after 096 hold" 102 "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

hold_above 098
check "held at 098 (099, 100, 101)" 3 "${#MOVED[@]}"
check "last remaining at 098" 098 "$(ls "$MIG_DIR" | tail -1 | cut -c1-3)"
restore_moved
check "restore after 098 hold" 102 "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

restore_moved
check "second restore is a no-op" 102 "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

echo
if [[ "$fails" -eq 0 ]]; then echo "FRONTIER SELECTION: all checks passed"; else echo "FRONTIER SELECTION: $fails check(s) failed"; exit 1; fi
