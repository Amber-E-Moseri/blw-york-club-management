#!/usr/bin/env bash
# F2 concurrency certification. Runs opposite-order batch submissions in parallel sessions against a DISPOSABLE database and
# fails (nonzero) if any row is refused, any statement fails with 40P01 (deadlock) or any count is wrong.
#   usage: run_f2_concurrency.sh <database> [trials]
# Required: F2_PSQL_CMD (the psql invocation for the disposable server) and F2_ALLOWED_DBS (allowed database names).
# The database must already carry migrations 097 and 098. The member fixture is created here, once, and committed.
set -euo pipefail
DB="${1:?database}"; TRIALS="${2:-20}"
: "${F2_PSQL_CMD:?set F2_PSQL_CMD}"; : "${F2_ALLOWED_DBS:?set F2_ALLOWED_DBS}"
case "$DB" in *canon*|*prod*|*production*|*live*) echo "refused: '$DB' looks protected" >&2; exit 2 ;; esac
case " $F2_ALLOWED_DBS " in *" $DB "*) ;; *) echo "refused: '$DB' not in F2_ALLOWED_DBS" >&2; exit 2 ;; esac

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
# A per-run identity for this gate's own test data. It is not a retry identity: each run imports fresh rows.
RUN="$(date +%s)$$"
MEM='00000000-0000-4000-8000-0000000000b1'; CELL='00000000-0000-4000-8000-0000000000c9'

# Fixture: idempotent. A member in an active cell, committed so that separate sessions can act as that member.
$F2_PSQL_CMD -d "$DB" -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
  VALUES ('$MEM', 'mem.conc.gate@example.test', '{"full_name":"Concurrency Gate"}', now())
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.cells (id, name) VALUES ('$CELL', 'Concurrency Gate Cell') ON CONFLICT (id) DO NOTHING;
SELECT set_config('app.cell_change_reason', 'Concurrency gate fixture', false);
UPDATE public.profiles SET role = 'member', status = 'active', cell_id = '$CELL' WHERE id = '$MEM';
SQL
STATUS="$($F2_PSQL_CMD -d "$DB" -X -At -c "select status from public.profiles where id = '$MEM'")"
[ "$STATUS" = "active" ] || { echo "FIXTURE MISSING: concurrency member is not active (got '$STATUS')" >&2; exit 3; }

rows_for() { # trial, order, suffix -> a JSON array of three rows whose identities are shared with the other order
  local t="$1" order="$2" x y
  x="{\"contact_name\":\"Gate X\",\"cell_id\":\"$CELL\",\"email\":\"gatex.$RUN.$t.f2@example.test\",\"idempotency_key\":\"gate-$RUN-$t-$order-x\"}"
  y="{\"contact_name\":\"Gate Y\",\"cell_id\":\"$CELL\",\"email\":\"gatey.$RUN.$t.f2@example.test\",\"idempotency_key\":\"gate-$RUN-$t-$order-y\"}"
  if [ "$order" = fwd ]; then printf '[%s,%s]' "$x" "$y"; else printf '[%s,%s]' "$y" "$x"; fi
}

expected_rows=0; bad=0
for t in $(seq 1 "$TRIALS"); do
  for order in fwd rev; do
    cat > "$WORK/s_${t}_${order}.sql" <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$MEM","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '$MEM', false);
SELECT row_index, outcome, error_code FROM public.submit_contacts_batch('$(rows_for "$t" "$order")'::jsonb);
SQL
  done
  $F2_PSQL_CMD -d "$DB" -X -At < "$WORK/s_${t}_fwd.sql" > "$WORK/o_${t}_fwd.txt" 2>&1 &
  $F2_PSQL_CMD -d "$DB" -X -At < "$WORK/s_${t}_rev.sql" > "$WORK/o_${t}_rev.txt" 2>&1 &
  wait
done

outcomes="$(cat "$WORK"/o_*.txt | grep -E '^[0-9]+\|' || true)"
imported=$(printf '%s\n' "$outcomes" | grep -c '|imported|' || true)
refused=$(printf '%s\n' "$outcomes" | grep -c '|rejected|' || true)
deadlocks=$(cat "$WORK"/o_*.txt | grep -c '40P01' || true)
errors=$(cat "$WORK"/o_*.txt | grep -c '^ERROR' || true)
expected=$((TRIALS * 4))   # two batches of two rows per trial

echo "concurrency gate on $DB: trials=$TRIALS batches=$((TRIALS*2)) rows_expected=$expected imported=$imported refused=$refused deadlocks=$deadlocks errors=$errors"
[ "$deadlocks" -eq 0 ] || { echo "FAILED: $deadlocks deadlock (40P01) result(s)" >&2; bad=1; }
[ "$refused" -eq 0 ] || { echo "FAILED: $refused row(s) refused" >&2; bad=1; }
[ "$errors" -eq 0 ] || { echo "FAILED: $errors statement error(s)" >&2; bad=1; }
[ "$imported" -eq "$expected" ] || { echo "FAILED: imported $imported, expected $expected" >&2; bad=1; }
[ "$bad" -eq 0 ] && echo "PASS: no deadlock, no refusal, no error, exact row count" || exit 1
