// Post-run cleanup verification. Reports (does not delete) synthetic accounts from this run that still exist.
// Needs SUPABASE_URL (validated by check-target.mjs first), SUPABASE_SERVICE_ROLE_KEY and E2E_RUN_STARTED_AT (ISO time).
// Deletion of any leftover is a separate, approved action; this script only fails the run so the leftover is seen.
const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const since = Date.parse(process.env.E2E_RUN_STARTED_AT ?? '');
if (!url || !key || Number.isNaN(since)) {
  console.error('leftover check: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and E2E_RUN_STARTED_AT are required');
  process.exit(1);
}

const leftovers = [];
for (let page = 1; page < 100; page++) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`leftover check: admin user listing failed with HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const users = body.users ?? [];
  for (const u of users) {
    const email = String(u.email ?? '');
    const createdAt = Date.parse(u.created_at ?? '');
    if (email.endsWith('@example.test') && email.startsWith('e2e.') && createdAt >= since) leftovers.push(email);
  }
  if (users.length < 200) break;
}

if (leftovers.length > 0) {
  console.error(`leftover check: ${leftovers.length} synthetic account(s) from this run still exist: ${leftovers.join(', ')}`);
  process.exit(1);
}
console.log('leftover check: no synthetic accounts from this run remain');
