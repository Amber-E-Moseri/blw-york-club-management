# Target guard for the F2 certification builder. Sourced by scripts/certify-f2.sh and by scripts/test_f2_target_guard.sh.
# It is not executed. Every function returns nonzero (and prints why) on any doubt. A database reset is allowed ONLY when
# all of the following hold, checked in this order before any container is inspected:
#   1. The project id is a disposable project: it starts with "f2" and holds only lowercase letters, digits and hyphens.
#      Everything else is refused, so blwcanon, blw086cert and every other project are refused by construction, not by a list.
#   2. The project id named by supabase/config.toml is the same id. `supabase db reset --local` acts on the config's project,
#      so this makes sure the reset can reach only the disposable stack.
#   3. The operator confirms the exact id: GITHUB_ACTIONS=true (a fresh CI runner), or F2_CONFIRM_PROJECT equal to the id.
#      CI=true and F2_ISOLATED_STACK=1 are NOT accepted: they were a weaker guard and were removed.
#   4. The database container is exactly supabase_db_<id>, and it is running.

f2_guard_project_id() {
  local id="$1"
  if [[ ! "$id" =~ ^f2[a-z0-9-]{2,38}$ ]]; then
    echo "refused: '$id' is not a disposable f2 project id (expected f2 followed by 2 to 38 lowercase letters, digits or hyphens)" >&2
    return 2
  fi
  # Defence in depth: a protected word is refused even inside an otherwise valid id.
  if [[ "$id" == *canon* || "$id" == *prod* || "$id" == *live* || "$id" == *blw* ]]; then
    echo "refused: '$id' contains a protected word (canon, prod, live or blw)" >&2
    return 2
  fi
}

# $1 = project id, $2 = path to config.toml (default supabase/config.toml)
f2_guard_config() {
  local id="$1" cfg="${2:-supabase/config.toml}" named
  if [[ ! -f "$cfg" ]]; then
    echo "refused: $cfg not found; the reset target cannot be verified" >&2
    return 2
  fi
  named="$(grep -E '^project_id[[:space:]]*=' "$cfg" | head -1 | sed -E 's/^[^"]*"([^"]*)".*/\1/')"
  if [[ -z "$named" || "$named" != "$id" ]]; then
    echo "refused: $cfg names project '${named:-<none>}', not '$id'. A reset would act on that stack." >&2
    return 2
  fi
}

f2_guard_confirm() {
  local id="$1"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    return 0
  fi
  if [[ "${F2_CONFIRM_PROJECT:-}" != "$id" ]]; then
    echo "refused: outside GitHub Actions, set F2_CONFIRM_PROJECT=$id to confirm the reset of that project" >&2
    return 2
  fi
}

# $1 = project id, $2 = container names (newline separated)
f2_guard_container() {
  local id="$1" names="$2"
  if ! printf '%s\n' "$names" | grep -qx "supabase_db_$id"; then
    echo "refused: the database container supabase_db_$id is not running; the target cannot be verified" >&2
    return 2
  fi
}

# All checks that do not need Docker. Used by the builder before it touches anything, and by the guard test.
f2_guard_static() {
  local id="$1" cfg="${2:-supabase/config.toml}"
  f2_guard_project_id "$id" && f2_guard_config "$id" "$cfg" && f2_guard_confirm "$id"
}
