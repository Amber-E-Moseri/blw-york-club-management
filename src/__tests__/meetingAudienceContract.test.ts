import {
  type AudienceSelection,
  describeAudienceChange,
  emptyMeetingAudience,
  invitationSourceFor,
  isInvitation,
  toSetAudienceParams,
  validateAudienceSelection,
} from '../lib/audience/meetingAudience';

const CELL_A = '11111111-1111-4111-8111-111111111111';
const CELL_B = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const PROFILE = '44444444-4444-4444-8444-444444444444';
const PROFILE_B = '55555555-5555-4555-8555-555555555555';

const sel = (overrides: Partial<AudienceSelection>): AudienceSelection => ({
  ...emptyMeetingAudience(),
  ...overrides,
});

const leader = { isStaff: false, ledCellIds: [CELL_A], profileCellById: { [PROFILE]: CELL_A, [PROFILE_B]: CELL_B } };
const staff = { isStaff: true, ledCellIds: [] };

describe('shared audience contract (ops §1–4)', () => {
  test('a selection is one of the four modes, and each mode validates its own ids', () => {
    expect(validateAudienceSelection(sel({ mode: 'all' }), staff)).toEqual([]);
    expect(validateAudienceSelection(sel({ mode: 'cells', cellIds: [CELL_A] }), staff)).toEqual([]);
    expect(validateAudienceSelection(sel({ mode: 'saved_groups', groupIds: [GROUP] }), staff)).toEqual([]);
    expect(validateAudienceSelection(sel({ mode: 'explicit', profileIds: [PROFILE] }), staff)).toEqual([]);
  });

  test('a cell leader may invite only cells they lead', () => {
    expect(validateAudienceSelection(sel({ mode: 'cells', cellIds: [CELL_A] }), leader)).toEqual([]);
    expect(validateAudienceSelection(sel({ mode: 'cells', cellIds: [CELL_B] }), leader)).toEqual([
      'You can only invite members of cells you lead.',
    ]);
  });

  test('all-members and saved-group audiences are staff-only', () => {
    expect(validateAudienceSelection(sel({ mode: 'all' }), leader)).toEqual(['Only admins and coordinators can invite all members.']);
    expect(validateAudienceSelection(sel({ mode: 'saved_groups', groupIds: [GROUP] }), leader)).toEqual([
      'Only admins and coordinators can invite a saved group.',
    ]);
  });

  test('a cell leader may pick specific members only from their own cells', () => {
    expect(validateAudienceSelection(sel({ mode: 'explicit', profileIds: [PROFILE] }), leader)).toEqual([]);
    expect(validateAudienceSelection(sel({ mode: 'explicit', profileIds: [PROFILE_B] }), leader)).toEqual([
      'You can only invite members of your own cells.',
    ]);
  });

  test('each non-all mode needs at least one id', () => {
    expect(validateAudienceSelection(sel({ mode: 'cells' }), staff)).toEqual(['Choose at least one cell.']);
    expect(validateAudienceSelection(sel({ mode: 'saved_groups' }), staff)).toEqual(['Choose at least one saved group.']);
    expect(validateAudienceSelection(sel({ mode: 'explicit' }), staff)).toEqual(['Choose at least one member.']);
  });

  test('ids must be UUIDs before anything is sent', () => {
    expect(validateAudienceSelection(sel({ mode: 'explicit', profileIds: ['not-an-id'] }), staff)).toEqual([
      'The audience contains an unknown reference.',
    ]);
  });

  test('set_meeting_audience parameters carry only the array the mode uses', () => {
    expect(toSetAudienceParams('m1', sel({ mode: 'explicit', profileIds: [PROFILE], groupIds: [GROUP] }), true)).toEqual({
      p_meeting_id: 'm1',
      p_mode: 'explicit',
      p_cell_ids: [],
      p_group_ids: [],
      p_profile_ids: [PROFILE],
      p_dry_run: true,
    });
    expect(toSetAudienceParams('m1', sel({ mode: 'saved_groups', groupIds: [GROUP] }), false)).toMatchObject({
      p_mode: 'saved_groups',
      p_group_ids: [GROUP],
      p_dry_run: false,
    });
  });

  test('each mode records the invitation source that the database uses', () => {
    expect(invitationSourceFor('all')).toBe('all');
    expect(invitationSourceFor('cells')).toBe('cell');
    expect(invitationSourceFor('saved_groups')).toBe('group');
    expect(invitationSourceFor('explicit')).toBe('member');
  });

  test('the preview sentence states the recipient count and any change', () => {
    expect(describeAudienceChange({ dry_run: true, recipients: 1, added: 0, removed: 0 }))
      .toBe('This meeting will be sent to 1 person. No changes.');
    expect(describeAudienceChange({ dry_run: true, recipients: 12, added: 10, removed: 2 }))
      .toBe('This meeting will be sent to 12 people (10 added, 2 removed).');
  });

  test('a self registration is not an invitation, and every other source is', () => {
    expect(isInvitation({ invited_via: 'self' })).toBe(false);
    expect(isInvitation({ invited_via: 'group' })).toBe(true);
  });
});
