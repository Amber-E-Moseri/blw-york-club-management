/* eslint-disable */
// Local test-user seeder. Requires explicit local environment configuration.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
// The provisioned coordinator, created once by the owner-level bootstrap. Optional: without it accounts stay pending.
const COORDINATOR_EMAIL = process.env.TEST_COORDINATOR_EMAIL;
const COORDINATOR_PASSWORD = process.env.TEST_COORDINATOR_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_PASSWORD) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, TEST_USER_PASSWORD');
  process.exit(1);
}

const TEST_USERS = [
  { email: 'test.coordinator@example.com', fullName: 'Test Coordinator', role: 'coordinator' },
  { email: 'test.cell-leader@example.com', fullName: 'Test Cell Leader', role: 'cell_leader' },
  { email: 'test.member@example.com', fullName: 'Test Member', role: 'member' },
];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createUser(user) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log(`\n-- ${user.role}: ${user.email}`);

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: user.email,
    password: TEST_USER_PASSWORD,
    options: { data: { full_name: user.fullName } },
  });

  if (signUpError) {
    if (signUpError.message.includes('already registered') || signUpError.message.includes('already been registered')) {
      console.log('  Already registered; signing in');
    } else {
      console.error('  Sign-up ERROR:', signUpError.message);
      return false;
    }
  } else {
    console.log('  Signed up, id:', signUpData && signUpData.user && signUpData.user.id);
  }

  await sleep(1000);

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: TEST_USER_PASSWORD,
  });

  if (signInError) {
    console.error('  Sign-in ERROR:', signInError.message);
    return false;
  }
  console.log('  Signed in, id:', signInData.user.id);

  const userId = signInData.user.id;
  // A new account is pending (signup trigger). Self-service cannot activate it or set a role (migration 094). Activation
  // goes through approve_pending_member, signed in as the provisioned coordinator. Without that coordinator's credentials
  // the account stays pending and this script says so.
  if (!COORDINATOR_EMAIL || !COORDINATOR_PASSWORD) {
    console.log('  Left pending: set TEST_COORDINATOR_EMAIL and TEST_COORDINATOR_PASSWORD to approve it through the workflow.');
  } else {
    const coordinator = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: coordSignInError } = await coordinator.auth.signInWithPassword({
      email: COORDINATOR_EMAIL,
      password: COORDINATOR_PASSWORD,
    });
    if (coordSignInError) {
      console.error('  Coordinator sign-in ERROR:', coordSignInError.message);
      await supabase.auth.signOut();
      return false;
    }
    const { error: approveError } = await coordinator.rpc('approve_pending_member', { target_member_id: userId });
    if (approveError) {
      console.error('  Approval ERROR:', approveError.message);
    } else {
      console.log('  Approved through approve_pending_member');
      if (user.role !== 'member') {
        const { data: roleRows, error: roleError } = await coordinator
          .from('profiles')
          .update({ role: user.role })
          .eq('id', userId)
          .select('id');
        if (roleError || !Array.isArray(roleRows) || roleRows.length !== 1) {
          console.error('  Role ERROR:', roleError ? roleError.message : 'no row changed');
        } else {
          console.log(`  Role set to ${user.role}`);
        }
      }
    }
    await coordinator.auth.signOut();
  }

  const { data: profile, error: readErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, status')
    .eq('id', signInData.user.id)
    .single();

  if (readErr) {
    console.error('  Read ERROR:', readErr.message);
  } else {
    console.log('  Confirmed:', JSON.stringify(profile));
  }

  await supabase.auth.signOut();
  return true;
}

(async () => {
  for (const user of TEST_USERS) {
    await createUser(user);
    await sleep(2000);
  }

  console.log('\nTest users created. Password was read from TEST_USER_PASSWORD.');
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
