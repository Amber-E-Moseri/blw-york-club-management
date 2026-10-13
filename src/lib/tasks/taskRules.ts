// Pure rules for member assignments. The database (migration 059) is the authority: these functions mirror its checks
// so the UI can hide or disable actions and explain errors before a request is sent. They never grant access.

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AssignmentStatus = 'open' | 'done' | 'reviewed';
export type TaskRole = 'member' | 'cell_leader' | 'admin' | 'coordinator';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 5000;

export interface TaskDraft {
  title: string;
  description: string;
  dueDate: string; // '' means no due date, otherwise YYYY-MM-DD
  priority: string;
  assigneeIds: string[];
}

export interface TaskDraftErrors {
  title?: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  assignees?: string;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateTaskDraft(draft: TaskDraft, today: string): TaskDraftErrors {
  const errors: TaskDraftErrors = {};
  const title = draft.title.trim();
  if (title.length === 0) errors.title = 'Give the task a title.';
  else if (title.length > TASK_TITLE_MAX) errors.title = `Keep the title to ${TASK_TITLE_MAX} characters.`;

  if (draft.description.trim().length > TASK_DESCRIPTION_MAX) {
    errors.description = `Keep the description to ${TASK_DESCRIPTION_MAX} characters.`;
  }

  if (draft.dueDate !== '') {
    if (!isIsoDate(draft.dueDate)) errors.dueDate = 'Enter a valid due date.';
    else if (draft.dueDate < today) errors.dueDate = 'The due date cannot be in the past.';
  }

  if (!(TASK_PRIORITIES as readonly string[]).includes(draft.priority)) {
    errors.priority = 'Choose a priority.';
  }

  if (draft.assigneeIds.length === 0) errors.assignees = 'Assign the task to at least one member.';

  return errors;
}

/** Drops blank and duplicate assignee ids, so each member gets exactly one progress record. */
export function uniqueAssigneeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.trim() !== '')));
}

export function canAssignTasks(role: TaskRole): boolean {
  return role === 'admin' || role === 'coordinator' || role === 'cell_leader';
}

/** A task is managed by active staff, or by the leader who created it. */
export function canManageTask(actor: { id: string; role: TaskRole }, task: { created_by: string }): boolean {
  if (actor.role === 'admin' || actor.role === 'coordinator') return true;
  return actor.role === 'cell_leader' && actor.id === task.created_by;
}

/** Whether `actor` may move one assignment to `next`. Mirrors task_assignments_guard in migration 059. */
export function canSetAssignmentStatus(
  actor: { id: string; role: TaskRole },
  assignment: { user_id: string; status: AssignmentStatus },
  task: { created_by: string },
  next: AssignmentStatus,
): boolean {
  const manager = canManageTask(actor, task);
  if (next === assignment.status) return manager || assignment.user_id === actor.id;

  if (manager) {
    // A manager may complete, reopen or review, but only a completed assignment can be reviewed.
    return next !== 'reviewed' || assignment.status === 'done';
  }

  // The assignee may move only their own row between open and done. A reviewed row is closed to them.
  if (assignment.user_id !== actor.id) return false;
  if (assignment.status === 'reviewed' || next === 'reviewed') return false;
  return true;
}

export interface ProgressSummary {
  total: number;
  open: number;
  done: number;
  reviewed: number;
}

/** Counts each assignee's own status. Done includes reviewed, because a reviewed task was also completed. */
export function summarizeProgress(statuses: readonly AssignmentStatus[]): ProgressSummary {
  const summary: ProgressSummary = { total: statuses.length, open: 0, done: 0, reviewed: 0 };
  for (const status of statuses) {
    if (status === 'open') summary.open += 1;
    else if (status === 'done') summary.done += 1;
    else summary.reviewed += 1;
  }
  return summary;
}

/** Overdue means the due date has passed and this assignee has not completed the work. */
export function isOverdue(dueDate: string | null, status: AssignmentStatus, today: string): boolean {
  if (!dueDate || status !== 'open') return false;
  return dueDate < today;
}

/** Orders open work first, then by priority and due date, so the most urgent work is at the top. */
export function compareAssignments(
  a: { status: AssignmentStatus; priority: TaskPriority; dueDate: string | null },
  b: { status: AssignmentStatus; priority: TaskPriority; dueDate: string | null },
): number {
  const rank = (s: AssignmentStatus) => (s === 'open' ? 0 : 1);
  if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
  // TASK_PRIORITIES runs low to urgent, so a higher index is more urgent and sorts first.
  const priorityRank = (p: TaskPriority) => TASK_PRIORITIES.indexOf(p);
  if (priorityRank(a.priority) !== priorityRank(b.priority)) return priorityRank(b.priority) - priorityRank(a.priority);
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}
