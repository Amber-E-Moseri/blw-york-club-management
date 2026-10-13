// Query-layer tests for meetings, audiences and attendance. The Supabase client is replaced by a recorder, so each
// test asserts exactly which RPC or table call was made and with which payload.

// Query-layer tests for meetings, invitations and attendance. The Supabase client is replaced by a recorder, so each
// test asserts exactly which RPC or table call was made and with which payload.

import * as meetings from '../lib/queries/meetings';
import * as audience from '../lib/queries/meetingAudience';
import { emptyMeetingAudience } from '../lib/audience/meetingAudience';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  queue: (key: string, resp: { data: unknown; error: { message: string } | null }) => void;
  reset: () => void;
};

const MEETING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GROUP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROFILE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => fake.reset());

const lastCall = () => fake.log[fake.log.length - 1];

describe('audience RPCs', () => {
  test('preview calls set_meeting_audience in dry-run mode with the selected mode', async () => {
    fake.queue('rpc:set_meeting_audience', { data: { dry_run: true, recipients: 3, added: 3, removed: 0 }, error: null });
    const result = await audience.previewMeetingAudience(MEETING_ID, { ...emptyMeetingAudience('explicit'), profileIds: [PROFILE_ID] });
    expect(lastCall()).toMatchObject({ target: 'rpc:set_meeting_audience', op: 'rpc' });
    expect(lastCall().args[0]).toMatchObject({ p_meeting_id: MEETING_ID, p_mode: 'explicit', p_profile_ids: [PROFILE_ID], p_dry_run: true });
    expect(result.recipients).toBe(3);
  });

  test('apply calls set_meeting_audience with dry_run false', async () => {
    fake.queue('rpc:set_meeting_audience', { data: { dry_run: false, recipients: 1, added: 1, removed: 0 }, error: null });
    await audience.setMeetingAudience(MEETING_ID, { ...emptyMeetingAudience('saved_groups'), groupIds: [GROUP_ID] });
    expect(lastCall().args[0]).toMatchObject({ p_mode: 'saved_groups', p_group_ids: [GROUP_ID], p_dry_run: false });
  });

  test('a refused audience surfaces the database message', async () => {
    fake.queue('rpc:set_meeting_audience', {
      data: null,
      error: { message: 'Only admins and coordinators can invite all members' },
    });
    await expect(audience.setMeetingAudience(MEETING_ID, emptyMeetingAudience('all')))
      .rejects.toThrow('Only admins and coordinators can invite all members');
  });

  test('publish calls publish_meeting and returns the stored publication time', async () => {
    fake.queue('rpc:publish_meeting', { data: { published_at: '2026-10-13T10:00:00Z', recipients: 4 }, error: null });
    const result = await audience.publishMeeting(MEETING_ID);
    expect(lastCall()).toMatchObject({ target: 'rpc:publish_meeting', args: [{ p_meeting_id: MEETING_ID }] });
    expect(result).toEqual({ published_at: '2026-10-13T10:00:00Z', recipients: 4 });
  });

  test('confirming goes through respond_to_meeting_invitation, never a direct insert', async () => {
    fake.queue('rpc:respond_to_meeting_invitation', { data: 'confirmed', error: null });
    await meetings.confirmAttendance(MEETING_ID);
    expect(lastCall()).toMatchObject({
      target: 'rpc:respond_to_meeting_invitation',
      args: [{ p_meeting_id: MEETING_ID, p_response: 'confirmed' }],
    });
    expect(fake.log.some((e) => e.target === 'meeting_attendances' && e.op === 'insert')).toBe(false);
  });

  test('declining is recorded as excused and never deletes the invitation', async () => {
    fake.queue('rpc:respond_to_meeting_invitation', { data: 'excused', error: null });
    await meetings.cancelAttendance(MEETING_ID);
    expect(lastCall().args[0]).toEqual({ p_meeting_id: MEETING_ID, p_response: 'excused' });
    expect(fake.log.some((e) => e.target === 'meeting_attendances' && e.op === 'delete')).toBe(false);
  });
});

describe('meeting records and publication', () => {
  test('a draft is created with published_at null and the draft flag is not sent as a column', async () => {
    fake.queue('meetings', { data: { id: MEETING_ID }, error: null });
    await meetings.createMeeting({
      title: 'Draft', date: '2026-11-01', time: '18:00', visibility: 'explicit', category: 'general',
      allow_join_requests: false, draft: true, created_by: USER_ID,
    });
    const row = fake.log.find((e) => e.target === 'meetings' && e.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(row.published_at).toBeNull();
    expect(row).not.toHaveProperty('draft');
  });

  test('a new meeting is published on creation unless it is a draft', async () => {
    fake.queue('meetings', { data: { id: MEETING_ID }, error: null });
    await meetings.createMeeting({
      title: 'Open', date: '2026-11-01', time: '18:00', visibility: 'public', category: 'general',
      allow_join_requests: false, created_by: USER_ID,
    });
    const row = fake.log.find((e) => e.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(typeof row.published_at).toBe('string');
  });

  test('editing a meeting never changes its publication state', async () => {
    fake.queue('meetings', { data: { id: MEETING_ID }, error: null });
    await meetings.updateMeeting(MEETING_ID, { title: 'Renamed', draft: false, published_at: null } as never);
    const update = fake.log.find((e) => e.target === 'meetings' && e.op === 'update')!.args[0] as Record<string, unknown>;
    expect(update).not.toHaveProperty('published_at');
    expect(update).not.toHaveProperty('draft');
    expect(update.title).toBe('Renamed');
  });
});

describe('attendance states', () => {
  test('fetchMeetings reports the viewer\'s own state, and only confirmed or attended counts as going', async () => {
    fake.queue('meetings', {
      data: [
        { id: 'm1', title: 'A', date: '2026-11-01', time: '18:00', visibility: 'explicit' },
        { id: 'm2', title: 'B', date: '2026-11-02', time: '18:00', visibility: 'public' },
        { id: 'm3', title: 'C', date: '2026-11-03', time: '18:00', visibility: 'public' },
      ],
      error: null,
    });
    fake.queue('meeting_attendances', {
      data: [
        { meeting_id: 'm1', attendance_status: 'invited' },
        { meeting_id: 'm2', attendance_status: 'confirmed' },
        { meeting_id: 'm3', attendance_status: 'excused' },
      ],
      error: null,
    });
    const result = await meetings.fetchMeetings(true);
    const byId = Object.fromEntries(result.map((m) => [m.id, m]));
    expect(byId.m1).toMatchObject({ user_attendance_status: 'invited', user_confirmed: false });
    expect(byId.m2).toMatchObject({ user_attendance_status: 'confirmed', user_confirmed: true });
    expect(byId.m3).toMatchObject({ user_attendance_status: 'excused', user_confirmed: false });
    expect(fake.log.find((e) => e.target === 'meeting_attendances' && e.op === 'select')!.args[0]).toBe('meeting_id, attendance_status');
  });

  test('staff outcomes are written as a status, and the boolean form maps onto it', async () => {
    await meetings.markAttendanceStatus(MEETING_ID, USER_ID, 'excused');
    expect(fake.log.find((e) => e.op === 'update')!.args[0]).toEqual({ attendance_status: 'excused' });

    fake.reset();
    await meetings.markAttended(MEETING_ID, USER_ID, true);
    expect(fake.log.find((e) => e.op === 'update')!.args[0]).toEqual({ attendance_status: 'attended' });

    fake.reset();
    await meetings.markAttended(MEETING_ID, USER_ID, false);
    expect(fake.log.find((e) => e.op === 'update')!.args[0]).toEqual({ attendance_status: 'absent' });
  });
});

describe('saved groups (operational tables)', () => {
  test('a group name is trimmed, written to saved_groups, and an empty name is refused before any write', async () => {
    fake.queue('saved_groups', { data: { id: GROUP_ID, name: 'Men', created_by: USER_ID, is_active: true, created_at: 'x' }, error: null });
    await audience.createSavedGroup('  Men  ', USER_ID);
    expect(fake.log.find((e) => e.target === 'saved_groups' && e.op === 'insert')!.args[0])
      .toEqual({ name: 'Men', created_by: USER_ID });

    fake.reset();
    await expect(audience.createSavedGroup('   ', USER_ID)).rejects.toThrow('Give the group a name.');
    expect(fake.log.some((e) => e.op === 'insert')).toBe(false);
  });

  test('membership is changed by difference through saved_group_members, so a failed write never empties the group', async () => {
    fake.queue('saved_group_members', { data: [{ profile_id: 'a' }, { profile_id: 'b' }], error: null });
    await audience.setSavedGroupMembers(GROUP_ID, ['b', 'c'], USER_ID);
    const insert = fake.log.find((e) => e.target === 'saved_group_members' && e.op === 'insert')!.args[0] as Array<Record<string, unknown>>;
    expect(insert.map((r) => r.profile_id)).toEqual(['c']);
    expect(insert[0]).toMatchObject({ group_id: GROUP_ID, added_by: USER_ID });
    expect(fake.log.some((e) => e.target === 'saved_group_members' && e.op === 'delete')).toBe(true);
    expect(fake.log.find((e) => e.op === 'in')!.args).toEqual(['profile_id', ['a']]);
  });
});
