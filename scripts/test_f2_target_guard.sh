#!/usr/bin/env bash
# Tests of the F2 target guard. Pure logic: no Docker, no database, no Supabase CLI. Each case must produce the expected
# result, and a refusal must also name the reason. Exits nonzero if any case differs from its expectation.
set -uo pipefail
cd "$(dirname "$0")"
# shellcheck source=f2_target_guard.sh
source ./f2_target_guard.sh

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cfg_for() { printf '[project]\nproject_id = "%s"\n' "$1" > "$TMP/$2.toml"; }
cfg_for blwcanon canon
cfg_for f2cert-ci ci
cfg_for f2cert-ci mismatch_target

FAILS=0
TOTAL=0
expect() { # label, expected exit (0 accept, nonzero refuse), command...
  local label="$1" want="$2"; shift 2
  TOTAL=$((TOTAL + 1))
  local out code
  out="$("$@" 2>&1)"; code=$?
  local ok=0
  if [[ "$want" == "0" && "$code" == "0" ]]; then ok=1; fi
  if [[ "$want" != "0" && "$code" != "0" ]]; then ok=1; fi
  if [[ "$ok" == 1 ]]; then
    echo "PASS | $label | exit $code"
  else
    echo "FAIL | $label | expected $want, got $code | $out"
    FAILS=$((FAILS + 1))
  fi
}

# 1. Protected projects are refused by the id rule, before any config or container is read.
expect "blwcanon is refused by name rule"        1 f2_guard_project_id blwcanon
expect "blw086cert is refused by name rule"      1 f2_guard_project_id blw086cert
expect "a project containing canon is refused"   1 f2_guard_project_id f2canon
expect "an empty id is refused"                  1 f2_guard_project_id ""
expect "a path-like id is refused"               1 f2_guard_project_id "../blwcanon"
expect "an uppercase id is refused"              1 f2_guard_project_id F2CERT
expect "a disposable f2 id is accepted"          0 f2_guard_project_id f2cert-ci

# 2. The config must name the same project. A config naming blwcanon refuses a disposable id.
expect "config names blwcanon, disposable id refused" 1 f2_guard_config f2cert-ci "$TMP/canon.toml"
expect "config names the same disposable id"          0 f2_guard_config f2cert-ci "$TMP/ci.toml"
expect "missing config refused"                       1 f2_guard_config f2cert-ci "$TMP/absent.toml"

# 3. Confirmation: outside GitHub Actions the exact id must be typed. CI=true alone is not enough.
expect "no confirmation, no GitHub Actions: refused"  1 env -u GITHUB_ACTIONS -u F2_CONFIRM_PROJECT bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'
expect "CI=true alone does not confirm"              1 env -u GITHUB_ACTIONS -u F2_CONFIRM_PROJECT CI=true bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'
expect "F2_ISOLATED_STACK=1 alone does not confirm"  1 env -u GITHUB_ACTIONS -u F2_CONFIRM_PROJECT F2_ISOLATED_STACK=1 bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'
expect "a wrong typed id is refused"                 1 env -u GITHUB_ACTIONS F2_CONFIRM_PROJECT=blwcanon bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'
expect "the exact typed id is accepted"              0 env -u GITHUB_ACTIONS F2_CONFIRM_PROJECT=f2cert-ci bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'
expect "GitHub Actions runner is accepted"           0 env GITHUB_ACTIONS=true bash -c 'source ./f2_target_guard.sh; f2_guard_confirm f2cert-ci'

# 4. Container: exactly supabase_db_<id>, and it must be listed.
expect "container for another project refused"   1 f2_guard_container f2cert-ci $'supabase_db_blwcanon\nsupabase_db_blw086cert'
expect "container for the disposable id accepted" 0 f2_guard_container f2cert-ci $'supabase_db_blwcanon\nsupabase_db_f2cert-ci'
expect "a prefix match is not a match"            1 f2_guard_container f2cert $'supabase_db_f2cert-ci'

# 5. The full static chain refuses protected targets end to end.
expect "static chain refuses blwcanon"           1 env GITHUB_ACTIONS=true bash -c 'source ./f2_target_guard.sh; f2_guard_static blwcanon "'"$TMP"'/canon.toml"'
expect "static chain refuses blw086cert"         1 env GITHUB_ACTIONS=true bash -c 'source ./f2_target_guard.sh; f2_guard_static blw086cert "'"$TMP"'/canon.toml"'
expect "static chain accepts the disposable CI id" 0 env GITHUB_ACTIONS=true bash -c 'source ./f2_target_guard.sh; f2_guard_static f2cert-ci "'"$TMP"'/ci.toml"'

echo
echo "TARGET GUARD: $((TOTAL - FAILS)) of $TOTAL cases behaved as expected, $FAILS unexpected"
[[ "$FAILS" -eq 0 ]]
