/* eslint-disable */
// Local test-user seeder. Requires explicit local environment configuration.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

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

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ status: 'active', role: user.role, full_name: user.fullName })
    .eq('id', signInData.user.id);

  if (updateError) {
    console.error('  Profile update ERROR:', updateError.message);
  } else {
    console.log(`  Profile updated to status=active, role=${user.role}`);
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
