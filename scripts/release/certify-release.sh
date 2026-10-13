#!/usr/bin/env bash
# Release certification on an ISOLATED local Supabase stack.
#
# Isolation: each run has its own RUN_ID, Supabase project id (blwyork_rel_<RUN_ID>), port block, Playwright port and edge
# router port. The repository's supabase/config.toml is NOT modified: a copy with the run's project id and ports is
# written to a run directory outside the repository, and the Supabase CLI is pointed at it with --workdir.
#
# Ownership: the script stops only what it started: its Supabase project (by project id), its edge router (found by the
# run directory in its command line), and its Playwright dev server (started by Playwright, which owns it). It never
# stops another process by name.
#
# Usage:
#   scripts/release/certify-release.sh                       # full run, random RUN_ID
#   RELEASE_RUN_ID=ci123 scripts/release/certify-release.sh  # fixed RUN_ID (CI)
#   RELEASE_NOTIFY_DENO=1 ...                                # also run notify-event in the Deno runtime (needs Docker
#                                                            # host networking: Linux CI)
# Exit status: 0 only if every gate passed.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

RUN_ID="${RELEASE_RUN_ID:-$(date +%H%M%S)$RANDOM}"
if ! [[ "$RUN_ID" =~ ^[a-z0-9]{4,20}$ ]]; then
  echo "RELEASE_RUN_ID must be 4-20 lowercase letters or digits" >&2
  exit 2
fi
PROJECT_ID="blwyork_rel_${RUN_ID}"
PORT_PREFIX="${RELEASE_PORT_PREFIX:-5852}"      # Supabase ports become 5852x (api 58521, db 58522, ...)
INSPECTOR_PORT="${RELEASE_INSPECTOR_PORT:-8193}"
EDGE_PORT="${RELEASE_EDGE_PORT:-54491}"
PW_PORT="${RELEASE_PLAYWRIGHT_PORT:-3300}"

WORK="${RELEASE_WORK_DIR:-${TMPDIR:-/tmp}/blwyork-rel-${RUN_ID}}"
LOG="${RELEASE_LOG_DIR:-$WORK/logs}"
mkdir -p "$WORK" "$LOG"
SUMMARY="$LOG/summary.txt"
: > "$SUMMARY"
DB=""          # set after start: supabase_db_<project id>
ENV_FILE="$WORK/supabase.env"
ROUTER_PID=""  # not used for stopping: the router is stopped by its run-directory marker
FAILED=0

say() { echo "$*" | tee -a "$SUMMARY"; }
gate() {
  # gate NAME COMMAND...   records PASS/FAIL, keeps the command output in $LOG/<name>.log
  local name="$1"; shift
  local file="$LOG/$(echo "$name" | tr ' /' '__').log"
  if "$@" > "$file" 2>&1; then
    say "PASS  $name"
  else
    say "FAIL  $name   (see $file)"
    FAILED=1
  fi
}

port_free() {
  node -e '
    const net = require("net"); const s = net.createServer();
    s.once("error", () => process.exit(1));
    s.listen(Number(process.argv[1]), "127.0.0.1", () => s.close(() => process.exit(0)));
  ' "$1"
}

kill_owned_router() {
  # Stops the edge router this run started, and nothing else. The router's command line carries $WORK.
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='deno.exe'\" | Where-Object { \$_.CommandLine -like '*${RUN_ID}*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
  else
    pkill -f "blwyork-rel-${RUN_ID}" >/dev/null 2>&1 || true
  fi
}

teardown() {
  kill_owned_router
  if [[ -n "$DB" ]]; then
    npx supabase --workdir "$WORK" stop --no-backup > "$LOG/stop.log" 2>&1 || true
  fi
  if [[ "${RELEASE_KEEP_WORK:-0}" != "1" ]]; then
    rm -rf "$WORK/supabase" "$WORK/edge.env" 2>/dev/null || true
  fi
}
trap teardown EXIT

say "run id: $RUN_ID   project: $PROJECT_ID   work: $WORK"
say "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ─── 1. Preflight: ports must be free, and the project id must not already exist ───────────────────────────────────
ports=("${PORT_PREFIX}0" "${PORT_PREFIX}1" "${PORT_PREFIX}2" "${PORT_PREFIX}3" "${PORT_PREFIX}4" "${PORT_PREFIX}5" "${PORT_PREFIX}6" "${PORT_PREFIX}7" "${PORT_PREFIX}8" "${PORT_PREFIX}9" "$INSPECTOR_PORT" "$EDGE_PORT" "$PW_PORT")
for p in "${ports[@]}"; do
  if ! port_free "$p"; then say "FAIL  preflight: port $p is in use"; exit 1; fi
done
say "PASS  preflight: ${#ports[@]} ports free"

# ─── 2. Run-specific config and migrations (the repository is not modified) ────────────────────────────────────────
mkdir -p "$WORK/supabase/migrations"
rm -f "$WORK/supabase/migrations/"*.sql
cp "$ROOT/supabase/migrations/"*.sql "$WORK/supabase/migrations/"
cp -r "$ROOT/supabase/functions" "$WORK/supabase/"
python3 - "$ROOT/supabase/config.toml" "$WORK/supabase/config.toml" "$PROJECT_ID" "$PORT_PREFIX" "$INSPECTOR_PORT" <<'PY'
import re, sys
src, dst, project, prefix, inspector = sys.argv[1:6]
s = open(src, encoding="utf-8").read()
s, n = re.subn(r'project_id = "[^"]*"', f'project_id = "{project}"', s, count=1)
assert n == 1, "project_id not found"
# Auto-detect the port base: any `port = NNNNN` line. Replace every occurrence of that
# base prefix with the cert prefix (e.g. 6062x -> 5852x). This handles projects that
# use a non-default port range without hardcoding the base.
port_nums = [int(m) for m in re.findall(r'^(?:shadow_)?port = (\d{4,6})\b', s, re.M)]
if port_nums:
    base = str(min(port_nums))[:-1]  # e.g. "6062" from 60620
    s = re.sub(rf'\b{re.escape(base)}(\d)\b', lambda m: prefix + m.group(1), s)
s = re.sub(r"inspector_port = \d+", f"inspector_port = {inspector}", s)
# Services the release tests do not use are disabled in the run copy only (Studio, analytics, Edge runtime and
# realtime). Edge functions run through the host Deno router. This keeps a shared Docker host from starving the
# database health check.
for sec in ["studio", "analytics", "edge_runtime", "realtime"]:
    s = re.sub(r"(\[" + sec + r"\][^\[]*?enabled = )true", r"\1false", s, count=1, flags=re.S)
open(dst, "w", encoding="utf-8", newline="\n").write(s)
PY
say "PASS  config: project $PROJECT_ID, ports ${PORT_PREFIX}0-${PORT_PREFIX}9"

# ─── 3. Start the isolated stack ───────────────────────────────────────────────────────────────────────────────────
# --ignore-health-check: on a loaded machine the Studio and analytics containers can miss the CLI health window while the
# database is healthy. The database is verified below by the replay and the SQL gates, not by this flag.
gate "supabase start" npx supabase --workdir "$WORK" start --ignore-health-check
DB="supabase_db_${PROJECT_ID}"
npx supabase --workdir "$WORK" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=' > "$ENV_FILE"
if [[ ! -s "$ENV_FILE" ]]; then say "FAIL  supabase status: no environment"; exit 1; fi
set -a; . "$ENV_FILE"; set +a
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export CERT_SUPABASE_URL="$API_URL" CERT_SUPABASE_ANON_KEY="$ANON_KEY" CERT_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
say "PASS  isolated stack reachable at $API_URL (container $DB)"

# ─── 4. Migration replay, determinism, golden ──────────────────────────────────────────────────────────────────────────
# The stack was created from an EMPTY database by `supabase start`, which applies every migration in order. The count of
# applied migrations is read from that start log. (A second `supabase db reset` is not used: on a loaded Docker host its
# post-restart health check times out. Determinism is shown by comparing this run's fingerprint with an independent
# fresh replay: RELEASE_REFERENCE_FP, a fingerprint file from another fresh run, is required for that comparison.)
expected_migrations=$(ls "$ROOT/supabase/migrations/"*.sql | wc -l | tr -d ' ')
applied=$(grep -c 'Applying migration' "$LOG/supabase_start.log" 2>/dev/null || echo 0)
if [[ "$applied" == "$expected_migrations" ]]; then say "PASS  fresh replay: $applied of $expected_migrations migrations applied from an empty database"; else say "FAIL  fresh replay: $applied of $expected_migrations migrations applied"; FAILED=1; fi
fingerprint() { docker exec -i "$DB" psql -U postgres -At -q < "$ROOT/supabase/verification/schema_fingerprint.sql" > "$WORK/fp_$1.json"; }
gate "fingerprint (fresh replay)" fingerprint 1
gate "golden parity (repository golden)" node "$ROOT/supabase/verification/check_schema_contract.mjs" "$WORK/fp_1.json" --golden "$ROOT/supabase/verification/schema_fingerprint.golden.json"
if [[ -n "${RELEASE_REFERENCE_FP:-}" ]]; then
  if cmp -s "$WORK/fp_1.json" "$RELEASE_REFERENCE_FP"; then say "PASS  fingerprint byte-identical to the reference fresh replay"; else say "FAIL  fingerprint differs from the reference fresh replay"; FAILED=1; fi
else
  say "SKIP  determinism: set RELEASE_REFERENCE_FP to a fingerprint from another fresh run to compare"
fi

# ─── 5. SQL authorisation and regression suites (each must report zero failures) ───────────────────────────────────────
sql_suite() {
  local name="$1"
  docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 < "$ROOT/supabase/verification/$name.sql" > "$LOG/sql_$name.log" 2>&1 || return 1
  ! grep -qE '\| (FAIL|f) +\|' "$LOG/sql_$name.log"
}
for s in release_rls_people_certification guard_approval_bootstrap_certification cert_031_032_active_guard \
         meeting_attendance_access_certification authz_status_matrix_test bsc_effective_rls_test \
         foundation_school_onboarding_test confession_app_compat_test cell_leader_scope_test \
         leadership_assignment_certification; do
  gate "sql $s" sql_suite "$s"
done

bsc_model() {
  python3 - "$ROOT" "$WORK/bsc_model_inlined.sql" <<'PY'
import re, sys
root, out = sys.argv[1], sys.argv[2]
src = open(root + "/supabase/verification/bsc_access_model_test.sql", encoding="utf-8").read()
s = re.sub(r"^\\i (\S+)$", lambda m: open(root + "/" + m.group(1), encoding="utf-8").read(), src, flags=re.M)
open(out, "w", encoding="utf-8", newline="\n").write(s)
PY
  docker exec -i "$DB" psql -U postgres -q -c "drop database if exists bsc_scratch" -c "create database bsc_scratch" >/dev/null 2>&1
  docker exec -i "$DB" psql -U postgres -d bsc_scratch -v ON_ERROR_STOP=1 < "$WORK/bsc_model_inlined.sql" > "$LOG/sql_bsc_access_model_standin.log" 2>&1
  local rc=$?
  docker exec -i "$DB" psql -U postgres -q -c "drop database if exists bsc_scratch" >/dev/null 2>&1
  return $rc
}
gate "sql bsc access model (stand-in helpers)" bsc_model

# ─── 6. Real authenticated sessions ─────────────────────────────────────────────────────────────────────────────────────
gate "real-session prayer visibility" node supabase/verification/prayer_visibility_session_test.mjs
gate "real-session BSC access" node supabase/verification/bsc_access_session_test.mjs

# ─── 7. Edge router and behavioural suites (router is owned by this run) ────────────────────────────────────────────────
cat > "$WORK/edge.env" <<EOF
SUPABASE_URL=${API_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
EMAIL_CRON_SECRET=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
UNSUBSCRIBE_SECRET=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
VAPID_PUBLIC_KEY=$(node -e 'console.log(require("web-push").generateVAPIDKeys().publicKey)')
VAPID_PRIVATE_KEY=$(node -e 'console.log(require("web-push").generateVAPIDKeys().privateKey)')
VAPID_SUBJECT=mailto:cert@example.org
EDGE_ROUTER_PORT=${EDGE_PORT}
EOF
# The router command line includes $WORK (through the env file path), which is how kill_owned_router finds it.
(EDGE_ROUTER_PORT=$EDGE_PORT deno run -A --no-lock --node-modules-dir=none --import-map=supabase/verification/edge/import_map.json \
  --env-file="$WORK/edge.env" supabase/verification/edge/router.ts > "$LOG/edge_router.log" 2>&1 &)
router_up=0
for i in $(seq 1 60); do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${EDGE_PORT}/notify-event" -H 'Content-Type: application/json' -d '{}' || true)
  if [[ "$code" != "000" ]]; then router_up=1; break; fi
  sleep 2
done
if [[ $router_up -eq 1 ]]; then say "PASS  edge router up on $EDGE_PORT (run-owned)"; else say "FAIL  edge router did not start"; FAILED=1; fi
export SUPABASE_FUNCTIONS_URL="http://127.0.0.1:${EDGE_PORT}"
export CERT_CRON_SECRET=$(grep '^EMAIL_CRON_SECRET=' "$WORK/edge.env" | cut -d= -f2-)
export CERT_UNSUBSCRIBE_SECRET=$(grep '^UNSUBSCRIBE_SECRET=' "$WORK/edge.env" | cut -d= -f2-)
for h in edge_function_security_certification p0_behavioural_certification p0_boundary_certification \
         auth_workflow_certification authorization_certification email_push_certification storage_certification \
         real_session_authz_certification; do
  gate "behavioural $h" node "supabase/verification/$h.mjs"
done
gate "behavioural notify_event (transpiled)" node supabase/verification/notify_event_certification.mjs
if [[ "${RELEASE_NOTIFY_DENO:-0}" == "1" ]]; then
  gate "behavioural notify_event (Deno runtime)" env NOTIFY_MODE=deno node supabase/verification/notify_event_certification.mjs
else
  say "SKIP  notify_event (Deno runtime): needs Docker host networking (run with RELEASE_NOTIFY_DENO=1 on Linux CI)"
fi
kill_owned_router
say "INFO  edge router stopped (run-owned)"

# ─── 8. Application gates ───────────────────────────────────────────────────────────────────────────────────────────────
gate "typecheck" npm run typecheck
gate "jest (integration tests enabled)" env CI=true npm test
gate "production build" npm run build
gate "playwright (isolated, port $PW_PORT)" env PLAYWRIGHT_PORT="$PW_PORT" PLAYWRIGHT_ISOLATED=1 npx playwright test --reporter=list

# ─── 9. Result ──────────────────────────────────────────────────────────────────────────────────────────────────────────
if [[ $FAILED -eq 0 ]]; then say "RESULT: ALL GATES PASSED"; else say "RESULT: FAILURES (see logs in $LOG)"; fi
exit $FAILED
