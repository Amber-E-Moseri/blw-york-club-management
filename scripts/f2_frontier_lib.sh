#!/usr/bin/env bash
# Migration selection for the F2 certification builders. Sourced by scripts/certify-f2.sh and by
# scripts/test_f2_frontier.sh. It does not run Docker or the database.
#   MIG_DIR   directory of migration files (set by the caller)
#   HOLD_DIR  scratch directory that receives held-back migrations (set by the caller)
#   MOVED     array of paths currently held back (maintained here)

# Version of a migration file as a decimal number. "098" must not be read as octal.
version_of() { local base; base="$(basename "$1")"; echo $((10#${base%%_*})); }

# Number of migration files at or below the frontier $1. This is the expected applied count.
expected_count() {
  local frontier="$1" f n=0
  for f in "$MIG_DIR"/*.sql; do
    if (( $(version_of "$f") <= 10#$frontier )); then n=$((n + 1)); fi
  done
  echo "$n"
}

# Moves every migration whose version is above the frontier $1 into HOLD_DIR. Nothing at or below it is moved.
hold_above() {
  local frontier="$1" f
  for f in "$MIG_DIR"/*.sql; do
    if (( $(version_of "$f") > 10#$frontier )); then
      mv "$f" "$HOLD_DIR/$(basename "$f")"
      MOVED+=("$f")
    fi
  done
}

# Moves every held migration back. Safe to call repeatedly.
restore_moved() {
  local f
  for f in "${MOVED[@]:-}"; do
    [[ -n "$f" && -f "$HOLD_DIR/$(basename "$f")" ]] && mv "$HOLD_DIR/$(basename "$f")" "$f"
  done
  MOVED=()
}
