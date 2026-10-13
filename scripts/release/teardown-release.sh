#!/usr/bin/env bash
# Removes ONE release run's containers, networks and run directory. Use after an interrupted run (for example when the
# pipeline's shell is killed, which skips its exit trap). Only resources whose names contain blwyork_rel_<RUN_ID> are
# touched. Usage: scripts/release/teardown-release.sh <RUN_ID>
set -uo pipefail
RUN_ID="${1:-}"
if ! [[ "$RUN_ID" =~ ^[a-z0-9]{4,20}$ ]]; then
  echo "usage: teardown-release.sh <RUN_ID>   (4-20 lowercase letters or digits)" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
WORK="${RELEASE_WORK_DIR:-${TMPDIR:-/tmp}/blwyork-rel-${RUN_ID}}"
if [[ -f "$WORK/supabase/config.toml" ]]; then
  npx supabase --workdir "$WORK" stop --no-backup > /dev/null 2>&1 || true
fi
docker ps -a --filter "name=blwyork_rel_${RUN_ID}" -q | xargs -r docker rm -f > /dev/null 2>&1
docker network ls --filter "name=blwyork_rel_${RUN_ID}" -q | xargs -r docker network rm > /dev/null 2>&1
docker volume ls --filter "name=blwyork_rel_${RUN_ID}" -q | xargs -r docker volume rm > /dev/null 2>&1
rm -rf "$WORK" 2>/dev/null || true
left=$(docker ps -a --format '{{.Names}}' | grep -c "blwyork_rel_${RUN_ID}" || true)
echo "run ${RUN_ID}: containers left = ${left}"
[[ "$left" == "0" ]]
