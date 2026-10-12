#!/usr/bin/env node
/**
 * BLW York Coordinator Prototype Data Seed
 *
 * Creates a complete test dataset for coordinator certification.
 * All records are tagged with [PROTO] for easy identification and cleanup.
 *
 * Usage:
 *   node scripts/seed-coordinator-prototype.js           # Seed data
 *   node scripts/seed-coordinator-prototype.js --reset   # Delete only [PROTO] records
 *
 * Environment:
 *   SUPABASE_URL (required)
 *   SUPABASE_SERVICE_KEY (required for seeding, used via Service Role)
 */

const { createClient } = require('@supabase/supabase-js');

// ═════════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SEED_PASSWORD = process.env.SEED_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SEED_PASSWORD) {
  console.error('❌ FATAL: Missing required environment variables');
  console.error('Set: SUPABASE_URL, SUPABASE_SERVICE_KEY and SEED_PASSWORD');
  console.error('You can get the service key from: supabase projects api-keys list');
  process.exit(1);
}

const COORDINATOR_ID = 'proto.coordinator@example.com'; // Will be replaced by actual coordinator profile ID
const CELL_LEADER_ID = 'proto.cell-leader@example.com';
const MEMBER_ID = 'proto.member@example.com';

const PROTO_PREFIX = '[PROTO]';
const IS_RESET = process.argv.includes('--reset');

// ─────────────────────────────────────────────────────────────────────────────
// Initialize Supabase client with service role
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function getProfileIdByEmail(email) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  if (error) throw new Error(`Could not find profile for ${email}: ${error.message}`);
  return data.id;
}

async function logProgress(msg) {
  console.log(`  ${msg}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// RESET FUNCTIONALITY
// ═════════════════════════════════════════════════════════════════════════════

async function resetPrototypeData() {
  console.log('\n🗑️  RESETTING PROTOTYPE DATA (records with [PROTO] prefix)...\n');

  try {
    // Delete in dependency order (children first, then parents)

    // foundation_school_progress (depends on enrollments)
    await logProgress('Deleting Foundation School progress...');
    const { error: progErr } = await supabase
      .from('foundation_school_progress')
      .delete()
      .textSearch('enrollment_id', `(
        SELECT id FROM foundation_school_enrollments
        WHERE student_id IN (
          SELECT id FROM profiles WHERE full_name ILIKE '%${PROTO_PREFIX}%'
        )
      )`);
    if (!progErr) await logProgress('  ✓ Foundation progress deleted');

    // foundation_school_enrollments (depends on profiles)
    await logProgress('Deleting Foundation School enrollments...');
    const { error: enrErr } = await supabase
      .from('foundation_school_enrollments')
      .delete()
      .or(`student_id.in.(${await getProtoProfileIds()}),teacher_id.in.(${await getProtoProfileIds()})`);
    if (!enrErr) await logProgress('  ✓ Foundation enrollments deleted');

    // devotional_views
    await logProgress('Deleting devotional views...');
    const { error: dvErr } = await supabase
      .from('devotional_views')
      .delete()
      .in('member_id', await getProtoProfileIds());
    if (!dvErr) await logProgress('  ✓ Devotional views deleted');

    // prayer_requests
    await logProgress('Deleting prayer requests...');
    const { error: prErr } = await supabase
      .from('prayer_requests')
      .delete()
      .ilike('content', `%${PROTO_PREFIX}%`);
    if (!prErr) await logProgress('  ✓ Prayer requests deleted');

    // contacts
    await logProgress('Deleting contacts...');
    const { error: cErr } = await supabase
      .from('contacts')
      .delete()
      .ilike('contact_name', `%${PROTO_PREFIX}%`);
    if (!cErr) await logProgress('  ✓ Contacts deleted');

    // event_rsvps (depends on events & profiles)
    await logProgress('Deleting event RSVPs...');
    const { error: rsvpErr } = await supabase
      .from('event_rsvps')
      .delete()
      .in('event_id', await getProtoEventIds());
    if (!rsvpErr) await logProgress('  ✓ Event RSVPs deleted');

    // events
    await logProgress('Deleting events...');
    const { error: eErr } = await supabase
      .from('events')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!eErr) await logProgress('  ✓ Events deleted');

    // meetings
    await logProgress('Deleting meetings...');
    const { error: mErr } = await supabase
      .from('meetings')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!mErr) await logProgress('  ✓ Meetings deleted');

    // habit_entries
    await logProgress('Deleting habit entries...');
    const { error: heErr } = await supabase
      .from('habit_entries')
      .delete()
      .in('user_id', await getProtoProfileIds());
    if (!heErr) await logProgress('  ✓ Habit entries deleted');

    // testimonies
    await logProgress('Deleting testimonies...');
    const { error: tErr } = await supabase
      .from('testimonies')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!tErr) await logProgress('  ✓ Testimonies deleted');

    // confessions
    await logProgress('Deleting confessions...');
    const { error: cfErr } = await supabase
      .from('confessions')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!cfErr) await logProgress('  ✓ Confessions deleted');

    // announcements
    await logProgress('Deleting announcements...');
    const { error: aErr } = await supabase
      .from('announcements')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!aErr) await logProgress('  ✓ Announcements deleted');

    // devotional_daily_pages
    await logProgress('Deleting devotional daily pages...');
    const { error: dpErr } = await supabase
      .from('devotional_daily_pages')
      .delete()
      .in('devotional_id', await getProtoDevotionalIds());
    if (!dpErr) await logProgress('  ✓ Devotional pages deleted');

    // monthly_devotionals
    await logProgress('Deleting monthly devotionals...');
    const { error: mdErr } = await supabase
      .from('monthly_devotionals')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!mdErr) await logProgress('  ✓ Monthly devotionals deleted');

    // books_of_month
    await logProgress('Deleting books...');
    const { error: bErr } = await supabase
      .from('books_of_month')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!bErr) await logProgress('  ✓ Books deleted');

    // weekly_messages
    await logProgress('Deleting weekly messages...');
    const { error: wmErr } = await supabase
      .from('weekly_messages')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!wmErr) await logProgress('  ✓ Weekly messages deleted');

    // foundation_school_classes (class_number has a unique constraint; must delete before re-seeding)
    await logProgress('Deleting foundation classes...');
    const { error: fcErr } = await supabase
      .from('foundation_school_classes')
      .delete()
      .ilike('title', `%${PROTO_PREFIX}%`);
    if (!fcErr) await logProgress('  ✓ Foundation classes deleted');

    // cells
    await logProgress('Deleting cells...');
    const { error: clErr } = await supabase
      .from('cells')
      .delete()
      .ilike('name', `%${PROTO_PREFIX}%`);
    if (!clErr) await logProgress('  ✓ Cells deleted');

    // proto member auth users (keep the 3 test users, delete PROTO-named members)
    await logProgress('Deleting proto member auth users...');
    const { data: protoProfiles } = await supabase
      .from('profiles')
      .select('id')
      .ilike('full_name', `%${PROTO_PREFIX}%`)
      .not('email', 'in', `(${COORDINATOR_ID},${CELL_LEADER_ID},${MEMBER_ID})`);
    let deletedAuthCount = 0;
    for (const p of protoProfiles || []) {
      await supabase.auth.admin.deleteUser(p.id);
      deletedAuthCount++;
    }
    if (deletedAuthCount > 0) await logProgress(`  ✓ Deleted ${deletedAuthCount} proto auth users`);

    console.log('\n✅ RESET COMPLETE. Test users remain. Ready to reseed.\n');

  } catch (err) {
    console.error('\n❌ RESET FAILED:', err.message);
    process.exit(1);
  }
}

async function getProtoProfileIds() {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .ilike('full_name', `%${PROTO_PREFIX}%`);
  return (data || []).map(p => p.id);
}

async function getProtoEventIds() {
  const { data } = await supabase
    .from('events')
    .select('id')
    .ilike('title', `%${PROTO_PREFIX}%`);
  return (data || []).map(e => e.id);
}

async function getProtoDevotionalIds() {
  const { data } = await supabase
    .from('monthly_devotionals')
    .select('id')
    .ilike('title', `%${PROTO_PREFIX}%`);
  return (data || []).map(d => d.id);
}

// ═════════════════════════════════════════════════════════════════════════════
// SEEDING FUNCTIONALITY
// ═════════════════════════════════════════════════════════════════════════════

async function seedPrototypeData() {
  console.log('\n🌱 SEEDING BLW YORK COORDINATOR PROTOTYPE DATA\n');

  try {
    // Resolve test user profile IDs
    console.log('Resolving test user accounts...');
    const coordId = await getProfileIdByEmail(COORDINATOR_ID);
    const leaderId = await getProfileIdByEmail(CELL_LEADER_ID);
    const memberId = await getProfileIdByEmail(MEMBER_ID);
    console.log('  ✓ Coordinator:', coordId.substring(0, 8));
    console.log('  ✓ Cell Leader:', leaderId.substring(0, 8));
    console.log('  ✓ Member:', memberId.substring(0, 8));

    // ─────────────────────────────────────────────────────────────────────────
    // 1. CELLS / DEPARTMENTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📍 Creating cells...');
    const cellNames = ['[PROTO] Phronesis', '[PROTO] Faith', '[PROTO] Grace', '[PROTO] Kings', '[PROTO] Newcomers'];
    const cells = [];
    for (const name of cellNames) {
      const { data, error } = await supabase
        .from('cells')
        .insert({ name, leader_id: leaderId })
        .select()
        .single();
      if (error) throw error;
      cells.push(data);
    }
    console.log(`  ✓ Created ${cells.length} cells`);

    // ─────────────────────────────────────────────────────────────────────────
    // 2. MEMBERS / PEOPLE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n👥 Creating members...');

    const memberData = [
      // Established members
      { name: '[PROTO] Member One', email: 'proto.member-01@example.com', role: 'member', cell_id: cells[0].id },
      { name: '[PROTO] Member Two', email: 'proto.member-02@example.com', role: 'member', cell_id: cells[1].id },
      { name: '[PROTO] Cell Leader One', email: 'proto.leader-01@example.com', role: 'cell_leader', cell_id: cells[0].id },
      { name: '[PROTO] Member Three', email: 'proto.member-03@example.com', role: 'member', cell_id: cells[2].id },
      { name: '[PROTO] Member Four', email: 'proto.member-04@example.com', role: 'member', cell_id: cells[3].id },
      { name: '[PROTO] Member Five', email: 'proto.member-05@example.com', role: 'member', cell_id: cells[4].id },
      // Newer members
      { name: '[PROTO] Member Six', email: 'proto.member-06@example.com', role: 'member', cell_id: cells[1].id },
      { name: '[PROTO] Member Seven', email: 'proto.member-07@example.com', role: 'member', cell_id: cells[2].id },
      { name: '[PROTO] Member Eight', email: 'proto.member-08@example.com', role: 'member', cell_id: cells[3].id },
      { name: '[PROTO] Member Nine', email: 'proto.member-09@example.com', role: 'member', cell_id: cells[0].id },
      // Attendance concern
      { name: '[PROTO] Member Ten', email: 'proto.member-10@example.com', role: 'member', cell_id: cells[1].id },
      { name: '[PROTO] Member Eleven', email: 'proto.member-11@example.com', role: 'member', cell_id: cells[2].id },
      { name: '[PROTO] Member Twelve', email: 'proto.member-12@example.com', role: 'member', cell_id: cells[3].id },
      // Additional
      { name: '[PROTO] Member With Long Name For Layout Testing', email: 'proto.member-long-name@example.com', role: 'member', cell_id: cells[0].id },
      { name: '[PROTO] Member Without Avatar', email: 'proto.member-no-avatar@example.com', role: 'member', cell_id: null }, // No avatar
    ];

    const members = [];
    for (const m of memberData) {
      let userId = null;

      // Try to create; if email already exists (shouldn't after reset), look up existing
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: m.email,
        password: SEED_PASSWORD,
        email_confirm: true,
      });

      if (created?.user?.id) {
        userId = created.user.id;
      } else if (createErr?.message?.includes('already been registered') || createErr?.code === 'email_exists') {
        const { data: users } = await supabase.auth.admin.listUsers();
        const existing = (users?.users || []).find(u => u.email === m.email);
        if (existing) userId = existing.id;
      }

      if (userId) {
        const { error: uErr } = await supabase
          .from('profiles')
          .update({ role: m.role, full_name: m.name, cell_id: m.cell_id })
          .eq('id', userId);
        if (uErr) throw uErr;
        members.push({ id: userId, full_name: m.name, role: m.role, cell_id: m.cell_id });
      }
    }
    console.log(`  ✓ Created ${members.length} members`);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. OUTREACH CONTACTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📧 Creating outreach contacts...');
    const contactData = [
      // Brand new
      { name: '[PROTO] Olivia Brown', status: 'Will Follow Up', tag: 'Interested', date: today(), notes: 'Campus outreach' },
      { name: '[PROTO] Contact Three', status: 'Will Follow Up', tag: 'Interested', date: today(), notes: 'Referral from prototype member' },
      // Contacted
      { name: '[PROTO] Ava Robinson', status: 'Contacted', tag: 'First Timer', date: dateOffset(-2), notes: 'Positive response' },
      { name: '[PROTO] Liam Garcia', status: 'Following Up', tag: 'First Timer', date: dateOffset(-3), notes: 'Follow-up scheduled' },
      // Follow-up due today
      { name: '[PROTO] Sophia Turner', status: 'Will Follow Up', tag: 'Interested', date: dateOffset(-7), notes: 'Follow-up due today' },
      { name: '[PROTO] Elijah Martin', status: 'Will Follow Up', tag: 'First Timer', date: dateOffset(-7), notes: 'Follow-up due today' },
      // Overdue
      { name: '[PROTO] Isabella Clark', status: 'Following Up', tag: 'Regular Visitor', date: dateOffset(-8), notes: 'Overdue 1 day' },
      { name: '[PROTO] Lucas Anderson', status: 'Following Up', tag: 'Regular Visitor', date: dateOffset(-11), notes: 'Overdue 4 days' },
      { name: '[PROTO] Mia Thomas', status: 'Following Up', tag: 'Regular Visitor', date: dateOffset(-18), notes: 'Overdue 8 days' },
      // Future follow-up
      { name: '[PROTO] Benjamin Lee', status: 'Will Follow Up', tag: 'Interested', date: dateOffset(-1), notes: 'Follow-up tomorrow' },
      { name: '[PROTO] Chloe Walker', status: 'Will Follow Up', tag: 'Interested', date: dateOffset(-5), notes: 'Follow-up in 5 days' },
      // Invited
      { name: '[PROTO] Henry Scott', status: 'Will Follow Up', tag: 'First Timer', date: dateOffset(-2), notes: 'Invited to service' },
      { name: '[PROTO] Layla Harris', status: 'Will Follow Up', tag: 'Interested', date: dateOffset(-3), notes: 'Invited to event' },
      // Attended
      { name: '[PROTO] Leo Young', status: 'Following Up', tag: 'First Timer', date: dateOffset(-1), notes: 'Attended service' },
      { name: '[PROTO] Zoe King', status: 'Contacted', tag: 'Regular Visitor', date: dateOffset(-10), notes: 'Attended multiple times' },
      // Cold/inactive
      { name: '[PROTO] Jack Evans', status: 'Not Interested', tag: 'Regular Visitor', date: dateOffset(-30), notes: 'Multiple unsuccessful follow-ups' },
    ];

    const contacts = [];
    for (const c of contactData) {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          cell_id: cells[0].id,
          contact_name: c.name,
          tag: c.tag,
          follow_up_status: c.status,
          date_contacted: c.date,
          notes: c.notes,
          logged_by: coordId,
          archived: false,
        })
        .select()
        .single();
      if (error) throw error;
      contacts.push(data);
    }
    console.log(`  ✓ Created ${contacts.length} contacts`);

    // ─────────────────────────────────────────────────────────────────────────
    // 4. EVENTS / SERVICES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📅 Creating events...');
    const eventData = [
      { title: '[PROTO] BLW York Sunday Service', date: today(), time: '09:00:00', location: 'Campus' },
      { title: '[PROTO] Campus Prayer Meeting', date: dateOffset(1), time: '18:00:00', location: 'Chapel' },
      { title: '[PROTO] Friday Bible Study', date: dateOffset(2), time: '19:00:00', location: 'Commons' },
      { title: '[PROTO] Outreach Day', date: dateOffset(6), time: '10:00:00', location: 'Campus' },
      { title: '[PROTO] BLW York Welcome Night', date: dateOffset(10), time: '18:30:00', location: 'Main Hall' },
      // Past events
      { title: '[PROTO] Sunday Service (Past)', date: dateOffset(-1), time: '09:00:00', location: 'Campus' },
      { title: '[PROTO] Bible Study (Past)', date: dateOffset(-3), time: '19:00:00', location: 'Commons' },
      { title: '[PROTO] Outreach Day (Past)', date: dateOffset(-7), time: '10:00:00', location: 'Campus' },
    ];

    const events = [];
    for (const e of eventData) {
      const { data, error } = await supabase
        .from('events')
        .insert({
          title: e.title,
          date: e.date,
          time: e.time,
          location: e.location,
          category: 'Other',
          created_by: coordId,
        })
        .select()
        .single();
      if (error) throw error;
      events.push(data);
    }
    console.log(`  ✓ Created ${events.length} events`);

    // Event RSVPs
    for (let i = 0; i < Math.min(3, events.length); i++) {
      for (let j = 0; j < Math.min(5, members.length); j++) {
        const { error } = await supabase
          .from('event_rsvps')
          .insert({ event_id: events[i].id, user_id: members[j].id })
          .select();
        if (error && !error.message.includes('duplicate')) throw error;
      }
    }
    console.log(`  ✓ Added event RSVPs`);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. MEETINGS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🤝 Creating meetings...');
    const meetingData = [
      { title: '[PROTO] Leadership Meeting', date: dateOffset(2), time: '19:00:00', category: 'leadership' },
      { title: '[PROTO] Outreach Team Meeting', date: dateOffset(3), time: '18:30:00', category: 'general' },
      { title: '[PROTO] Foundation School Teachers Meeting', date: dateOffset(4), time: '17:00:00', category: 'general' },
      // Past
      { title: '[PROTO] Weekly Leadership Review', date: dateOffset(-7), time: '19:00:00', category: 'leadership' },
      { title: '[PROTO] Outreach Planning Meeting', date: dateOffset(-3), time: '18:30:00', category: 'general' },
      { title: '[PROTO] Service Preparation Meeting', date: dateOffset(-1), time: '17:00:00', category: 'general' },
    ];

    const meetings = [];
    for (const m of meetingData) {
      const { data, error } = await supabase
        .from('meetings')
        .insert({
          title: m.title,
          date: m.date,
          time: m.time,
          category: m.category,
          visibility: 'public',
          created_by: coordId,
          reminder_sent: false,
        })
        .select()
        .single();
      if (error) throw error;
      meetings.push(data);
    }
    console.log(`  ✓ Created ${meetings.length} meetings`);

    // ─────────────────────────────────────────────────────────────────────────
    // 6. DEVOTIONALS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📖 Creating devotionals...');
    const devotionalData = [
      {
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        title: `[PROTO] Daily Bread ${new Date().toLocaleString('en', { month: 'long' })}`,
        book_title: 'Deeper Waters',
        author: 'Prototype Author',
        total_days: 31,
        total_pages: 62,
      },
      {
        month: new Date().getMonth() === 0 ? 12 : new Date().getMonth(),
        year: new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear(),
        title: '[PROTO] Daily Bread Previous Month',
        book_title: 'Living Faith',
        author: 'Rev. Patterson',
        total_days: 28,
        total_pages: 56,
      },
    ];

    const devotionals = [];
    for (const d of devotionalData) {
      const { data, error } = await supabase
        .from('monthly_devotionals')
        .upsert({
          ...d,
          created_by: coordId,
        }, { onConflict: 'month,year' })
        .select()
        .single();
      if (error) throw error;
      devotionals.push(data);
    }
    console.log(`  ✓ Created ${devotionals.length} devotionals`);

    // Daily pages for current month
    if (devotionals.length > 0) {
      const currentDev = devotionals[0];
      const pages = [];
      for (let day = 1; day <= 5; day++) {
        const { data, error } = await supabase
          .from('devotional_daily_pages')
          .upsert({
            devotional_id: currentDev.id,
            day_of_month: day,
            page_range: `pp. ${day * 2 - 1}-${day * 2}`,
            image_url: `https://via.placeholder.com/600x800?text=Day+${day}`,
            title: `Day ${day} - Living in Grace`,
          }, { onConflict: 'devotional_id,day_of_month' })
          .select()
          .single();
        if (error) throw error;
        pages.push(data);
      }
      console.log(`  ✓ Created ${pages.length} daily pages`);

      // Mark some as read for coordinator
      for (let day = 1; day <= 2; day++) {
        const { error } = await supabase
          .from('devotional_views')
          .upsert({
            member_id: coordId,
            devotional_id: currentDev.id,
            day_of_month: day,
            viewed_date: dateOffset(-(2-day)),
            viewed_at: now(),
          });
        if (error && !error.message.includes('duplicate')) throw error;
      }
      console.log(`  ✓ Marked 2 devotionals as read`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. BOOKS OF MONTH
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📚 Creating books...');
    const bookData = [
      {
        title: '[PROTO] Current Reading',
        author: 'Author Name',
        description: 'Our current book of the month for spiritual growth',
        active_from: dateOffset(-30),
        active_until: dateOffset(30),
      },
      {
        title: '[PROTO] Previous Book',
        author: 'Previous Author',
        description: 'Last month\'s selection',
        active_from: dateOffset(-60),
        active_until: dateOffset(-30),
      },
      {
        title: '[PROTO] Upcoming Book',
        author: 'Future Author',
        description: 'Next month\'s reading',
        active_from: dateOffset(30),
        active_until: dateOffset(60),
      },
    ];

    const books = [];
    for (const b of bookData) {
      const { data, error } = await supabase
        .from('books_of_month')
        .insert({
          ...b,
          drive_url: 'https://example.com/book',
          created_by: coordId,
        })
        .select()
        .single();
      if (error) throw error;
      books.push(data);
    }
    console.log(`  ✓ Created ${books.length} books`);

    // ─────────────────────────────────────────────────────────────────────────
    // 8. PRAYER REQUESTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🙏 Creating prayer requests...');
    const prayerData = [
      { content: '[PROTO] Please pray for my family during this difficult season', visibility: 'shared' },
      { content: '[PROTO] Grateful for healing prayer - thanksgiving request', visibility: 'shared', answered: true },
      { content: '[PROTO] Job interview coming up - need wisdom and guidance', visibility: 'leadership' },
      { content: '[PROTO] Health concerns - please intercede', visibility: 'private' },
      { content: '[PROTO] Praise report: God answered our prayers!', visibility: 'shared', answered: true },
      { content: '[PROTO] Community outreach initiative - pray for openness', visibility: 'leadership' },
    ];

    const prayers = [];
    for (const p of prayerData) {
      const { data, error } = await supabase
        .from('prayer_requests')
        .insert({
          content: p.content,
          author_id: coordId,
          author_name: 'Test Coordinator',
          is_anonymous: false,
          is_active: !p.answered,
          visibility: p.visibility,
          answered_at: p.answered ? now() : null,
        })
        .select()
        .single();
      if (error) throw error;
      prayers.push(data);
    }
    console.log(`  ✓ Created ${prayers.length} prayer requests`);

    // ─────────────────────────────────────────────────────────────────────────
    // 9. FOUNDATION SCHOOL
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🎓 Creating Foundation School...');

    // Create classes
    const classData = [
      { class_number: 1, title: '[PROTO] Foundation 1: Following Jesus', description: 'Introduction to Christian faith', duration_hours: 4 },
      { class_number: 2, title: '[PROTO] Foundation 2: The Word of God', description: 'Understanding Scripture', duration_hours: 4 },
      { class_number: 3, title: '[PROTO] Foundation 3: Prayer & Communion', description: 'Developing prayer life', duration_hours: 4 },
      { class_number: 4, title: '[PROTO] Foundation 4: The Holy Spirit', description: 'Holy Spirit empowerment', duration_hours: 4 },
      { class_number: 5, title: '[PROTO] Foundation 5: Spiritual Growth', description: 'Maturity in Christ', duration_hours: 4 },
      { class_number: 6, title: '[PROTO] Foundation 6: Life Purpose', description: 'God\'s calling for your life', duration_hours: 4 },
    ];

    const classes = [];
    for (const c of classData) {
      const { data, error } = await supabase
        .from('foundation_school_classes')
        .upsert(c, { onConflict: 'class_number' })
        .select()
        .single();
      if (error) throw error;
      classes.push(data);
    }
    console.log(`  ✓ Created ${classes.length} foundation classes`);

    // Enrollments at various stages
    const enrollmentProgress = [
      { memberIdx: 0, completed: 6 },  // Graduated
      { memberIdx: 1, completed: 5 },  // Nearly complete
      { memberIdx: 2, completed: 3 },  // Midway
      { memberIdx: 3, completed: 2 },  // Partial
      { memberIdx: 4, completed: 1 },  // Just started
      { memberIdx: 5, completed: 0 },  // Not started
      { memberIdx: 6, completed: 2 },
      { memberIdx: 7, completed: 4 },
      { memberIdx: 8, completed: 1 },
      { memberIdx: 9, completed: 3 },
      { memberIdx: 10, completed: 0 },
      { memberIdx: 11, completed: 2 },
    ];

    let enrollmentCount = 0;
    for (const ep of enrollmentProgress) {
      if (ep.memberIdx >= members.length) break;

      // Skip if already enrolled (idempotent re-run)
      const { data: existing } = await supabase
        .from('foundation_school_enrollments')
        .select('id')
        .eq('student_id', members[ep.memberIdx].id)
        .single();
      if (existing) { enrollmentCount++; continue; }

      const { data: enrollment, error: enrErr } = await supabase
        .from('foundation_school_enrollments')
        .insert({
          student_id: members[ep.memberIdx].id,
          teacher_id: leaderId,
          enrollment_date: dateOffset(-60),
          completion_date: ep.completed === 6 ? dateOffset(-1) : null,
          is_graduated: ep.completed === 6,
        })
        .select()
        .single();
      if (enrErr) throw enrErr;

      // Add progress
      for (let i = 0; i < ep.completed; i++) {
        const { error: progErr } = await supabase
          .from('foundation_school_progress')
          .insert({
            enrollment_id: enrollment.id,
            class_id: classes[i].id,
            completed_at: dateOffset(-(60 - i * 5)),
          });
        if (progErr && !progErr.message.includes('duplicate')) throw progErr;
      }

      enrollmentCount++;
    }
    console.log(`  ✓ Created ${enrollmentCount} enrollments with varied progress`);

    // ─────────────────────────────────────────────────────────────────────────
    // 10. HABITS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n✅ Creating coordinator habits...');

    // Get habit templates (they should exist)
    const { data: templates, error: tErr } = await supabase
      .from('habit_templates')
      .select('id, name')
      .eq('is_active', true)
      .limit(4);

    if (templates && templates.length > 0) {
      for (let i = 0; i < templates.length; i++) {
        const status = i % 2 === 0 ? 'done' : 'skipped';
        const { error } = await supabase
          .from('habit_entries')
          .insert({
            template_id: templates[i].id,
            user_id: coordId,
            entry_date: today(),
            status,
          });
        if (error && !error.message.includes('duplicate')) throw error;
      }
      console.log(`  ✓ Created habit entries`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. ANNOUNCEMENTS & TESTIMONIES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📢 Creating announcements & testimonies...');

    const announcements = [
      '[PROTO] Welcome to our growing community!',
      '[PROTO] Foundation School registration now open',
      '[PROTO] Join us for our upcoming outreach event',
      '[PROTO] Prayer night this Friday',
    ];

    for (const title of announcements) {
      const { error } = await supabase
        .from('announcements')
        .insert({
          title,
          body: 'This is a prototype announcement for testing purposes.',
          author_id: coordId,
          author_name: 'Test Coordinator',
        });
      if (error) throw error;
    }
    console.log(`  ✓ Created ${announcements.length} announcements`);

    const testimonies = [
      '[PROTO] God provided for my needs unexpectedly',
      '[PROTO] Prayer was answered in a remarkable way',
    ];

    for (const title of testimonies) {
      const { error } = await supabase
        .from('testimonies')
        .insert({
          title,
          body: 'This is a prototype testimony for testing purposes.',
          author_id: coordId,
          author_name: 'Test Coordinator',
          category: 'provision',
          visibility: 'members',
        });
      if (error) throw error;
    }
    console.log(`  ✓ Created ${testimonies.length} testimonies`);

    // ─────────────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n═════════════════════════════════════════════════════════════');
    console.log('✅ PROTOTYPE SEED COMPLETE');
    console.log('═════════════════════════════════════════════════════════════');
    console.log(`
📊 Dataset Summary:
  • Cells: ${cells.length}
  • Members: ${members.length}
  • Outreach Contacts: ${contacts.length}
  • Events: ${events.length}
  • Meetings: ${meetings.length}
  • Devotionals: ${devotionals.length} (with ${devotionals[0] ? '5 daily pages' : '0 pages'})
  • Books: ${books.length}
  • Prayer Requests: ${prayers.length}
  • Foundation School Enrollments: ${enrollmentCount}
  • Foundation School Classes: ${classes.length}
  • Announcements: ${announcements.length}
  • Testimonies: ${testimonies.length}

🔐 All records are tagged with [PROTO] for identification.
🧹 Reset with: npm run seed:proto -- --reset

🎯 Ready for Coordinator Certification Testing!
    `);

  } catch (err) {
    console.error('\n❌ SEED FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

(async () => {
  if (IS_RESET) {
    await resetPrototypeData();
  } else {
    await seedPrototypeData();
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
