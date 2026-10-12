# Event notifications: production deployment

Do not start these steps without explicit approval. Each step assumes the previous one succeeded.

## Gates before anything is deployed

| Gate | Status at the time of writing | What clears it |
| --- | --- | --- |
| Schema golden (`supabase/verification/schema_fingerprint.golden.json`) | **Failing** in CI. `tables`: intended change from migration 038 (new `events` columns and an audience check). `functions`: two definition hashes (`is_active_profile`, `find_person_by_email`) that cannot be reproduced from any commit in the repo. | Run the read-only fingerprint on the hosted project, compare the two function definitions with the migration files, then decide. The golden is regenerated only after that decision. |
| `notify-event` certification (`supabase/verification/notify_event_certification.mjs`) | Passing locally, 44/44, repeatable. Runs the real function source against the local database. | Already runs as part of `scripts/certify-local.sh`. |
| `notify-event` on the Edge runtime | **Not run.** The sandbox cannot reach `esm.sh` or the npm registry from the edge container. | Serve the function in a networked environment (CI, or a developer machine): `npx supabase functions serve --env-file <file>`, then run `edge_function_security_certification.mjs` and a manual call. |
| Hosted project read-only check | **Not done.** No credentials were available to the sandbox. | Read-only fingerprint and `select` of `events` columns, `push_notification_log` columns and `pg_policies` on the hosted project. |

## Deployment order

1. **Back up the hosted database** (point-in-time recovery or a logical dump), and record the migration version.
2. **Read-only checks on the hosted project.** Confirm the hosted `profiles`, `events`, `meetings`, `push_subscriptions` and `push_notification_log` match the repo. The `push_notification_log` table must have `sent_at` and `response_data` and must not have `error_message` or `target_url`. Confirm the two function definitions named in the gate table. Record the results.
3. **Apply the schema:** `npx supabase db push --project-ref <ref>`. This applies `038` then `039`, in that order.
   - `038` adds `events.audience`, `events.audience_meeting_id` and `events.notified_at`. It is additive, and existing rows get `audience = 'all'`.
   - `039` removes a check constraint that an earlier draft of `038` created. On a database that never had that draft, it does nothing.
   - Both are safe to re-run. The upgrade path from the earlier `038` was tested locally.
4. **Set the function secrets** (see below).
5. **Deploy the function:** `npx supabase functions deploy notify-event --project-ref <ref>`. Keep the default `verify_jwt = true`. The gateway then rejects requests without a valid JWT, and the function also requires an active admin or coordinator.
6. **Build and deploy the front end** with the public VAPID key set in the hosting environment. The variable is baked into the build, so redeploy after setting it.
7. **Smoke test on production, with an approved test account and one test device only.** Create an event with "All active members", confirm one push arrives on the test device, confirm one row in `push_notification_log`, and confirm a second send is refused. Do not notify real members during the smoke test.

## Environment variables and secrets

| Name | Where | Value and notes |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Supabase function secret | Same value as `REACT_APP_VAPID_PUBLIC_KEY`. |
| `VAPID_PRIVATE_KEY` | Supabase function secret | Keep secret. Never commit it or put it in the front end. |
| `VAPID_SUBJECT` | Supabase function secret | A `mailto:` contact URL that the push services can use. |
| `SUPABASE_URL` | Provided by the Edge runtime | Do not set it manually. |
| `SUPABASE_SERVICE_ROLE_KEY` | Provided by the Edge runtime | Do not set it manually. |
| `REACT_APP_VAPID_PUBLIC_KEY` | Hosting build environment (Vercel) | Same value as `VAPID_PUBLIC_KEY`. Redeploy after changing it. |
| `REACT_APP_SUPABASE_URL` | Hosting build environment | Production project URL. |
| `REACT_APP_SUPABASE_ANON_KEY` | Hosting build environment | Production anon key. Public by design. |

Set the function secrets with the linked project:

```bash
npx supabase link --project-ref <ref>
npx supabase secrets set \
  VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<contact>
```

Generate the keys once with `node scripts/generate-vapid-keys.js`. The public key must match in both places. Changing the keys invalidates every existing subscription.

## Rollback

- **Front end:** redeploy the previous build. The Add Event form then has no audience picker or notify step.
- **Function:** delete it with `npx supabase functions delete notify-event --project-ref <ref>`. Events still save, and the form reports that notifications failed.
- **Schema:** `038` and `039` are additive. Leave them in place. Dropping the columns would lose the audience data of any events created since deployment.

## Known limits

- Deliveries are not retried. A device that fails is logged, and the event is not re-sent automatically.
- An event with an audience of "meeting" whose meeting has since been deleted is refused, and nothing is sent.
- `notify-event` is not type-checked, because its Deno imports fall outside the project's TypeScript check. It is exercised through the transpiled harness only.
