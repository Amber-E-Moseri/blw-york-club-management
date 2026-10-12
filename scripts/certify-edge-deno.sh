#!/usr/bin/env bash
# Runs the Edge Function security certification with the functions in the real Deno runtime (denoland/deno in Docker,
# host networking). Use this where Supabase's own edge runtime cannot reach esm.sh or the npm registry.
#
# Secrets are generated for this run, written to a temporary directory outside the repository, and removed on exit.
# Set NOTIFY_CA_BUNDLE to a PEM bundle if outbound HTTPS is intercepted (the sandbox case). Leave it unset where the
# runtime trusts the public roots, as CI does.
set -euo pipefail

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
CONTAINER="edge-router-$$"
CACHE="${NOTIFY_DENO_CACHE:-$HOME/.cache/blw-deno}"
mkdir -p "$CACHE"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

node -e '
  const { randomBytes } = require("crypto");
  const webpush = require("web-push");
  const vapid = webpush.generateVAPIDKeys();
  const lines = [
    `SUPABASE_URL=${process.argv[1]}`,
    `SUPABASE_SERVICE_ROLE_KEY=${process.argv[2]}`,
    `EMAIL_CRON_SECRET=${randomBytes(24).toString("hex")}`,
    `UNSUBSCRIBE_SECRET=${randomBytes(24).toString("hex")}`,
    `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
    `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
    `VAPID_SUBJECT=mailto:cert@example.org`,
    `EDGE_ROUTER_PORT=54321`,
  ];
  require("fs").writeFileSync(process.argv[3], lines.join("\n") + "\n", { mode: 0o600 });
' "$API_URL" "$SERVICE_ROLE_KEY" "$WORK/edge.env"

# The cert secrets must equal the function secrets; read them back from the file without printing them.
CRON="$(grep '^EMAIL_CRON_SECRET=' "$WORK/edge.env" | cut -d= -f2-)"
UNSUB="$(grep '^UNSUBSCRIBE_SECRET=' "$WORK/edge.env" | cut -d= -f2-)"

DOCKER_ARGS=(run -d --rm --name "$CONTAINER" --network host
  -e DENO_DIR=/deno-cache -v "$CACHE:/deno-cache"
  -v "$PWD:/work" -v "$WORK:/envs:ro" -w /work)
if [[ -n "${NOTIFY_CA_BUNDLE:-}" ]]; then
  cp "$NOTIFY_CA_BUNDLE" "$WORK/ca.crt"
  DOCKER_ARGS+=(-e DENO_CERT=/envs/ca.crt -e NODE_EXTRA_CA_CERTS=/envs/ca.crt)
fi
DOCKER_ARGS+=(denoland/deno:alpine deno run -A --no-lock --node-modules-dir=none
  --import-map=/work/supabase/verification/edge/import_map.json
  --env-file=/envs/edge.env /work/supabase/verification/edge/router.ts)
docker "${DOCKER_ARGS[@]}" >/dev/null

for _ in $(seq 1 120); do
  code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:54321/notify-event" \
    -H 'Content-Type: application/json' -d '{}' || true)"
  [[ "$code" != "000" ]] && break
  sleep 2
done
if [[ "$code" == "000" ]]; then
  echo "Edge router did not start. Last log lines:" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_FUNCTIONS_URL="http://127.0.0.1:54321" CERT_CRON_SECRET="$CRON" CERT_UNSUBSCRIBE_SECRET="$UNSUB"
status=0
for harness in edge_function_security_certification p0_behavioural_certification p0_boundary_certification; do
  node "supabase/verification/$harness.mjs" || status=1
done
exit "$status"
