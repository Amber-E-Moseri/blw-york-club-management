// Account approval / organizational membership separation and reconciliation certification.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const admin = '70000000-0000-4000-8000-000000000001';
const approvedNoMembership = '70000000-0000-4000-8000-000000000002';
const pendingWithMembership = '70000000-0000-4000-8000-000000000003';
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

async function run() {
  const { db } = await openReplay(MIGRATIONS);
  for (const [id, email] of [[admin,'admin@example.test'],[approvedNoMembership,'approved@example.test'],[pendingWithMembership,'pending@example.test']]) {
    await db.query(`insert into auth.users(id,email,aud,role,created_at,email_confirmed_at) values($1,$2,'authenticated','authenticated',now(),now())`, [id,email]);
  }
  await db.query(`update public.profiles set role='coordinator',status='active' where id=$1`, [admin]);
  await db.query(`update public.profiles set status='active' where id=$1`, [approvedNoMembership]);
  await db.query(`update public.profiles set status='pending' where id=$1`, [pendingWithMembership]);
  await db.query(`delete from public.memberships where person_id=(select person_id from public.profiles where id=$1)`, [approvedNoMembership]);
  await db.query(`insert into public.memberships(person_id,role,status)
    select person_id,'member','active' from public.profiles where id=$1`, [pendingWithMembership]);

  const defaultStatus = await db.query(`select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='status'`);
  check('new profile column default is pending', /pending/.test(defaultStatus.rows[0]?.column_default ?? ''), JSON.stringify(defaultStatus.rows[0]));
  const review = await attempt(db, 'authenticated', admin, `select account_id, discrepancy_code from public.membership_reconciliation_review order by account_id`);
  check('admin sees preserved discrepancies for review', review.ok && review.rows.some((r) => r.account_id === approvedNoMembership && r.discrepancy_code === 'approved_account_without_active_membership') && review.rows.some((r) => r.account_id === pendingWithMembership && r.discrepancy_code === 'active_membership_without_approved_account'), JSON.stringify(review));
  const pendingReview = await attempt(db, 'authenticated', pendingWithMembership, `select * from public.membership_reconciliation_review`);
  check('pending account cannot inspect reconciliation queue', pendingReview.ok && pendingReview.rows.length === 0, JSON.stringify(pendingReview));
  const org = await attempt(db, 'authenticated', admin, `select account_id, account_approval_status, membership_status from public.organizational_member_directory where account_id=$1`, [pendingWithMembership]);
  check('organizational member reports account approval separately', org.ok && org.rows[0]?.membership_status === 'active' && org.rows[0]?.account_approval_status === 'pending', JSON.stringify(org));
  const selfEdit = await attempt(db, 'authenticated', approvedNoMembership, `update public.profiles set full_name='Approved Edited' where id=$1 returning full_name`, [approvedNoMembership]);
  check('active account may edit own ordinary profile field', selfEdit.ok && selfEdit.rows[0]?.full_name === 'Approved Edited', JSON.stringify(selfEdit));
  const protectedEdit = await attempt(db, 'authenticated', approvedNoMembership, `update public.profiles set role='admin' where id=$1`, [approvedNoMembership]);
  check('active account cannot edit own protected role', !protectedEdit.ok, JSON.stringify(protectedEdit));
  const otherEdit = await attempt(db, 'authenticated', approvedNoMembership, `update public.profiles set full_name='Nope' where id=$1 returning id`, [pendingWithMembership]);
  check('active account cannot edit another profile', otherEdit.ok && otherEdit.rows.length === 0, JSON.stringify(otherEdit));

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  process.exitCode = failed.length ? 1 : 0;
}

run().catch((error) => { console.error('ERROR', error); process.exitCode = 2; });
