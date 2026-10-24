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
# Counts follow the repository chain, so the self-test does not go stale when a migration is added.
TOTAL="$(ls "$MIG_DIR" | wc -l | tr -d ' ')"
check() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then echo "PASS | $1 | $3"; else echo "FAIL | $1 | expected $2, got $3"; fails=$((fails + 1)); fi
}

check "count at 096" 97 "$(expected_count 096)"
check "count at 097" 98 "$(expected_count 097)"
check "count at 098" 99 "$(expected_count 098)"
check "count at 100" 101 "$(expected_count 100)"
# Historical frontier: 000-103 is fixed history. Its count does not move when later migrations are added, so it is a
# constant here. Asserting the whole chain at 103 was the earlier defect: 104 and 105 exist now.
HISTORICAL_103_COUNT=104
check "count at 103 (historical frontier 000-103)" "$HISTORICAL_103_COUNT" "$(expected_count 103)"

# Current head: the authoritative chain runs 000 through HEAD_VERSION. Update HEAD_VERSION with each forward migration.
# The check below fails when the repository's last file disagrees, so the constant cannot go stale silently.
HEAD_VERSION=105
check "last file is the current head" "$HEAD_VERSION" "$((10#$(ls "$MIG_DIR" | tail -1 | cut -c1-3)))"
check "count at head (whole chain)" "$TOTAL" "$(expected_count "$(printf '%03d' "$HEAD_VERSION")")"
check "chain holds head+1 files (000 to head)" "$((HEAD_VERSION + 1))" "$TOTAL"
check "frontier beyond head counts the whole chain" "$TOTAL" "$(expected_count 999)"
check "count at 000 is the first file alone" 1 "$(expected_count 000)"

hold_above 100
check "held at 100 (101 to head)" "$((TOTAL - 101))" "${#MOVED[@]}"
check "last remaining at 100" 100 "$(ls "$MIG_DIR" | tail -1 | cut -c1-3)"
restore_moved
check "restore after 100 hold" "$TOTAL" "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

hold_above 096
check "held at 096 (count of files above 096)" "$((TOTAL - 97))" "${#MOVED[@]}"
check "remaining at 096" 97 "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"
check "last remaining at 096" 096 "$(ls "$MIG_DIR" | tail -1 | cut -c1-3)"
restore_moved
check "restore after 096 hold" "$TOTAL" "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

hold_above 098
check "held at 098 (099 to head)" "$((TOTAL - 99))" "${#MOVED[@]}"
check "last remaining at 098" 098 "$(ls "$MIG_DIR" | tail -1 | cut -c1-3)"
restore_moved
check "restore after 098 hold" "$TOTAL" "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

restore_moved
check "second restore is a no-op" "$TOTAL" "$(ls "$MIG_DIR" | wc -l | tr -d ' ')"

hold_above "$(printf '%03d' "$HEAD_VERSION")"
check "nothing is held above the head" 0 "${#MOVED[@]}"
restore_moved

# Negative cases: the self-test must reject a wrong expectation. Each call runs check in a subshell and passes only when
# check reports FAIL.
expect_mismatch() { # name, expected, actual
  local out; out="$(check "$1" "$2" "$3")"
  if [[ "$out" == FAIL* ]]; then echo "PASS | negative: $1 is rejected"; else echo "FAIL | negative: $1 was accepted | $out"; fails=$((fails + 1)); fi
}
expect_mismatch "whole chain asserted at the 103 frontier (the old defect)" "$TOTAL" "$(expected_count 103)"
expect_mismatch "historical count asserted at the head" "$HISTORICAL_103_COUNT" "$TOTAL"
expect_mismatch "one file too many at the 103 frontier" "$((HISTORICAL_103_COUNT + 1))" "$(expected_count 103)"
expect_mismatch "held count off by one" "$((TOTAL - 100))" "$((TOTAL - 101))"

echo
if [[ "$fails" -eq 0 ]]; then echo "FRONTIER SELECTION: all checks passed"; else echo "FRONTIER SELECTION: $fails check(s) failed"; exit 1; fi
