// Exposure check for the dormant audience_specs_insert policy (070). Replays 000–086 on PGlite.
// Expected: authenticated coordinators cannot INSERT directly (privilege removed by 082), and the policy text is still present.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'), { lastFile: '086_audit_tables_no_service_access.sql' });
const coord = crypto.randomUUID();
await db.query("insert into auth.users (id, email, aud, role, created_at) values ($1,'c@t.example','authenticated','authenticated', now())", [coord]);
await db.query("update public.profiles set role='coordinator', status='active' where id=$1", [coord]);
const priv = (await db.query("select has_table_privilege('authenticated','public.audience_specs','INSERT') as p")).rows[0].p;
const pol = (await db.query("select count(*)::int n from pg_policies where tablename='audience_specs' and policyname='audience_specs_insert'")).rows[0].n;
console.log(`policy present: ${pol}, authenticated has INSERT privilege: ${priv}`);
const r = await attempt(db, 'authenticated', coord, "insert into public.audience_specs (mode, created_by) values ('all', $1)", [coord]);
console.log(r.ok ? 'FAIL  authenticated coordinator direct INSERT succeeded' : `PASS  authenticated coordinator direct INSERT denied [${r.code}]`);
process.exit(r.ok || priv || pol === 0 ? 1 : 0);
