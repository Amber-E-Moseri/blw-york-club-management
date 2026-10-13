import {
  canAssignTasks,
  canManageTask,
  canSetAssignmentStatus,
  compareAssignments,
  isIsoDate,
  isOverdue,
  summarizeProgress,
  uniqueAssigneeIds,
  validateTaskDraft,
  type TaskDraft,
} from '../lib/tasks/taskRules';

const TODAY = '2026-10-13';

const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  title: 'Contact three first-timers',
  description: '',
  dueDate: '2026-10-20',
  priority: 'normal',
  assigneeIds: ['member-a'],
  ...overrides,
});

describe('validateTaskDraft', () => {
  test('a complete draft has no errors', () => {
    expect(validateTaskDraft(draft(), TODAY)).toEqual({});
  });

  test('requires a non-blank title and assignee', () => {
    const errors = validateTaskDraft(draft({ title: '   ', assigneeIds: [] }), TODAY);
    expect(errors.title).toBeDefined();
    expect(errors.assignees).toBeDefined();
  });

  test('rejects a title over 200 characters', () => {
    expect(validateTaskDraft(draft({ title: 'x'.repeat(201) }), TODAY).title).toBeDefined();
    expect(validateTaskDraft(draft({ title: 'x'.repeat(200) }), TODAY).title).toBeUndefined();
  });

  test('an empty due date is allowed, but an impossible or past one is not', () => {
    expect(validateTaskDraft(draft({ dueDate: '' }), TODAY).dueDate).toBeUndefined();
    expect(validateTaskDraft(draft({ dueDate: '2026-02-30' }), TODAY).dueDate).toBeDefined();
    expect(validateTaskDraft(draft({ dueDate: '2026-10-12' }), TODAY).dueDate).toMatch(/past/);
    expect(validateTaskDraft(draft({ dueDate: TODAY }), TODAY).dueDate).toBeUndefined();
  });

  test('rejects an unknown priority', () => {
    expect(validateTaskDraft(draft({ priority: 'critical' }), TODAY).priority).toBeDefined();
  });
});

describe('isIsoDate', () => {
  test('accepts real calendar dates only', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
  });
});

describe('uniqueAssigneeIds', () => {
  test('one progress record per member, even when a member is picked twice', () => {
    expect(uniqueAssigneeIds(['a', 'b', 'a', ' ', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('authorisation for assigning and managing', () => {
  test('members cannot assign work; leaders, admins and coordinators can', () => {
    expect(canAssignTasks('member')).toBe(false);
    expect(canAssignTasks('cell_leader')).toBe(true);
    expect(canAssignTasks('admin')).toBe(true);
    expect(canAssignTasks('coordinator')).toBe(true);
  });

  test('a cell leader manages only the tasks they created', () => {
    const task = { created_by: 'leader-1' };
    expect(canManageTask({ id: 'leader-1', role: 'cell_leader' }, task)).toBe(true);
    expect(canManageTask({ id: 'leader-2', role: 'cell_leader' }, task)).toBe(false);
    expect(canManageTask({ id: 'coord', role: 'coordinator' }, task)).toBe(true);
  });
});

describe('independent completion for several assignees', () => {
  const task = { created_by: 'leader-1' };
  const leader = { id: 'leader-1', role: 'cell_leader' as const };
  const memberA = { id: 'member-a', role: 'member' as const };
  const memberB = { id: 'member-b', role: 'member' as const };

  test('completing one assignee leaves the others open', () => {
    const rows = [
      { user_id: 'member-a', status: 'open' as const },
      { user_id: 'member-b', status: 'open' as const },
    ];
    expect(canSetAssignmentStatus(memberA, rows[0], task, 'done')).toBe(true);
    expect(summarizeProgress(rows.map((r) => r.status))).toEqual({ total: 2, open: 2, done: 0, reviewed: 0 });
  });

  test('an assignee cannot complete another member\'s row', () => {
    const rowOfA = { user_id: 'member-a', status: 'open' as const };
    expect(canSetAssignmentStatus(memberB, rowOfA, task, 'done')).toBe(false);
  });

  test('an assignee cannot review, and cannot touch a reviewed row', () => {
    expect(canSetAssignmentStatus(memberA, { user_id: 'member-a', status: 'done' }, task, 'reviewed')).toBe(false);
    expect(canSetAssignmentStatus(memberA, { user_id: 'member-a', status: 'reviewed' }, task, 'open')).toBe(false);
  });

  test('only a manager can review, and only a completed assignment', () => {
    expect(canSetAssignmentStatus(leader, { user_id: 'member-a', status: 'open' }, task, 'reviewed')).toBe(false);
    expect(canSetAssignmentStatus(leader, { user_id: 'member-a', status: 'done' }, task, 'reviewed')).toBe(true);
  });

  test('a leader who did not create the task cannot change its assignments', () => {
    const other = { id: 'leader-2', role: 'cell_leader' as const };
    expect(canSetAssignmentStatus(other, { user_id: 'member-a', status: 'done' }, task, 'reviewed')).toBe(false);
  });

  test('summary counts reviewed as completed too', () => {
    expect(summarizeProgress(['done', 'reviewed', 'open'])).toEqual({ total: 3, open: 1, done: 1, reviewed: 1 });
  });
});

describe('due dates', () => {
  test('work is overdue only while open and past its due date', () => {
    expect(isOverdue('2026-10-12', 'open', TODAY)).toBe(true);
    expect(isOverdue('2026-10-12', 'done', TODAY)).toBe(false);
    expect(isOverdue('2026-10-12', 'reviewed', TODAY)).toBe(false);
    expect(isOverdue('2026-10-13', 'open', TODAY)).toBe(false);
    expect(isOverdue(null, 'open', TODAY)).toBe(false);
  });

  test('open work sorts before completed work, then by priority and due date', () => {
    const rows = [
      { status: 'done' as const, priority: 'urgent' as const, dueDate: '2026-10-14' },
      { status: 'open' as const, priority: 'low' as const, dueDate: '2026-10-14' },
      { status: 'open' as const, priority: 'urgent' as const, dueDate: null },
      { status: 'open' as const, priority: 'urgent' as const, dueDate: '2026-10-15' },
    ];
    const sorted = [...rows].sort(compareAssignments);
    expect(sorted.map((r) => `${r.status}:${r.priority}:${r.dueDate}`)).toEqual([
      'open:urgent:2026-10-15',
      'open:urgent:null',
      'open:low:2026-10-14',
      'done:urgent:2026-10-14',
    ]);
  });
});
