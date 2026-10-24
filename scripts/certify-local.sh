#!/usr/bin/env bash
# Runs the release certification runbook (supabase/verification/README.md) end to end against a LOCAL Supabase stack.
# Nothing here touches a hosted project. Throwaway edge-function secrets are generated per run, kept in a temp
# directory outside the repository, and removed on exit.
set -euo pipefail

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
FN_PID=""
cleanup() {
  if [[ -n "$FN_PID" ]]; then kill "$FN_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$1"; }

# Fails if any psql harness row reports FAIL (the SQL harnesses roll back, so exit codes alone are not enough).
psql_harness() {
  local name="$1" db="$2"
  docker exec -i "$db" psql -U postgres -v ON_ERROR_STOP=1 < "supabase/verification/$name.sql" > "$WORK/$name.log" 2>&1
  cat "$WORK/$name.log"
  if grep -q '| FAIL' "$WORK/$name.log"; then
    echo "FAIL: $name reported failing checks" >&2
    exit 1
  fi
}

step "Start local stack"
npx supabase start

eval "$(npx supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|DB_URL)=')"
# The authorization workflow harness needs a local-only owner login for fixture state (supabase/verification/lib.mjs).
# It is the local stack's own database URL; the lib refuses any host other than 127.0.0.1 or localhost.
export LOCAL_OWNER_DATABASE_URL="$DB_URL"
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_FUNCTIONS_URL="$API_URL/functions/v1"
DB="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
if [[ -z "$DB" ]]; then echo "No supabase_db_* container found" >&2; exit 1; fi

step "1. Replay every migration from empty"
npx supabase db reset --local

step "2. Schema fingerprint and contract"
docker exec -i "$DB" psql -U postgres -At -q < supabase/verification/schema_fingerprint.sql > "$WORK/fp1.json"
node supabase/verification/check_schema_contract.mjs "$WORK/fp1.json" --golden supabase/verification/schema_fingerprint.golden.json

step "3. Database-level harnesses"
psql_harness release_rls_people_certification "$DB"
psql_harness guard_approval_bootstrap_certification "$DB"
psql_harness cert_031_032_active_guard "$DB"
psql_harness meeting_attendance_access_certification "$DB"
psql_harness meeting_integration_certification "$DB"

step "4. Second independent replay must match the first byte for byte"
npx supabase db reset --local
docker exec -i "$DB" psql -U postgres -At -q < supabase/verification/schema_fingerprint.sql > "$WORK/fp2.json"
node supabase/verification/check_schema_contract.mjs "$WORK/fp2.json" --same-as "$WORK/fp1.json"

step "5. Edge functions with throwaway secrets"
CERT_CRON_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
CERT_UNSUBSCRIBE_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
export CERT_CRON_SECRET CERT_UNSUBSCRIBE_SECRET
printf 'EMAIL_CRON_SECRET=%s\nUNSUBSCRIBE_SECRET=%s\n' "$CERT_CRON_SECRET" "$CERT_UNSUBSCRIBE_SECRET" > "$WORK/edge.env"
npx supabase functions serve --env-file "$WORK/edge.env" > "$WORK/functions.log" 2>&1 &
FN_PID=$!
booted=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_FUNCTIONS_URL/send-email" -H 'Content-Type: application/json' -d '{}' || true)"
  if [[ "$code" != "000" && "$code" != "503" ]]; then booted=1; break; fi
  sleep 3
done
if [[ "$booted" -ne 1 ]]; then
  echo "Edge functions did not boot. Last log lines:" >&2
  tail -20 "$WORK/functions.log" >&2
  exit 1
fi

step "6. Behavioural harnesses (real API, throwaway accounts)"
# Every harness runs even when an earlier one reports failures, so each result is visible. The step still fails if any did.
behavioural_failed=0
for harness in auth_workflow_certification authorization_certification email_push_certification \
  storage_certification p0_behavioural_certification p0_boundary_certification edge_function_security_certification; do
  node "supabase/verification/$harness.mjs" || { echo "FAILED: $harness" >&2; behavioural_failed=1; }
done

# notify-event runs from the transpiled source against the local database and a localhost push mock, so it does not
# need the edge runtime and runs here as well as in CI.
node supabase/verification/notify_event_certification.mjs || { echo "FAILED: notify_event_certification" >&2; behavioural_failed=1; }

if [[ "$behavioural_failed" -ne 0 ]]; then
  echo "Behavioural harnesses failed. Every harness ran; see the FAILED lines above." >&2
  exit 1
fi

step "Certification complete"
