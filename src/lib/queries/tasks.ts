import { supabase } from '../supabase';
import type { AssignmentStatus, TaskPriority } from '../tasks/taskRules';

// Data access for assignments on the unified table public.assignments (062, extended by 076). The table holds one row
// per assignee. A task is the set of rows that share a batch_id, which create_assignments() sets for one call. Writes
// go through the table's RLS, and the status changes below are the only ones the page makes.
//
// The page's three states map onto the table as follows:
//   open      status pending or in_progress
//   done      status completed, reviewed_at null
//   reviewed  status completed, reviewed_at set
// A cancelled row is a removed task: it is excluded from every read.

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  created_by: string;
  is_active: boolean;
  created_at: string;
}

export interface AssignmentRecord {
  task_id: string;
  user_id: string;
  status: AssignmentStatus;
  completed_at: string | null;
  reviewed_at: string | null;
}

/** An assignment with its task, for the member dashboard. */
export interface MyAssignment extends AssignmentRecord {
  task: TaskRecord;
}

/** A task with every assignee's progress, for the staff dashboard. */
export interface ManagedTask extends TaskRecord {
  assignments: AssignmentRecord[];
}

interface AssignmentRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  assigned_to: string;
  assigned_by: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  reviewed_at: string | null;
  batch_id: string | null;
  created_at: string;
}

const ROW_COLUMNS =
  'id, title, description, due_date, priority, assigned_to, assigned_by, status, completed_at, reviewed_at, batch_id, created_at';

/** The task a row belongs to. Rows made without a batch are their own task. */
const taskKey = (row: AssignmentRow): string => row.batch_id ?? row.id;

export function toUiStatus(row: Pick<AssignmentRow, 'status' | 'reviewed_at'>): AssignmentStatus {
  if (row.status === 'completed') return row.reviewed_at ? 'reviewed' : 'done';
  return 'open';
}

function toTask(row: AssignmentRow): TaskRecord {
  return {
    id: taskKey(row),
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    priority: row.priority,
    created_by: row.assigned_by,
    is_active: true,
    created_at: row.created_at,
  };
}

function toAssignment(row: AssignmentRow): AssignmentRecord {
  return {
    task_id: taskKey(row),
    user_id: row.assigned_to,
    status: toUiStatus(row),
    completed_at: row.completed_at,
    reviewed_at: row.reviewed_at,
  };
}

export async function fetchMyAssignments(userId: string): Promise<MyAssignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select(ROW_COLUMNS)
    .eq('assigned_to', userId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as AssignmentRow[]).map((row) => ({ ...toAssignment(row), task: toTask(row) }));
}

/** Groups the rows the caller may see into tasks. RLS limits the rows: staff see all, a leader sees their cells. */
export async function fetchManagedTasks(): Promise<ManagedTask[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select(ROW_COLUMNS)
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const tasks = new Map<string, ManagedTask>();
  for (const row of (data ?? []) as unknown as AssignmentRow[]) {
    const key = taskKey(row);
    let task = tasks.get(key);
    if (!task) {
      task = { ...toTask(row), assignments: [] };
      tasks.set(key, task);
    }
    task.assignments.push(toAssignment(row));
  }
  return Array.from(tasks.values());
}

/** Creates one task for every assignee in one statement (create_assignments, 076). Returns the first row id. */
export async function createTaskWithAssignees(input: {
  title: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
  assigneeIds: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_assignments', {
    p_title: input.title,
    p_description: input.description,
    p_due_date: input.dueDate === '' ? null : input.dueDate,
    p_priority: input.priority,
    p_assignee_ids: input.assigneeIds,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as string[])[0] ?? '';
}

/** Moves one assignee's row. open reopens, done completes, reviewed stamps the review (a manager action, see 062). */
export async function setAssignmentStatus(taskId: string, userId: string, status: AssignmentStatus): Promise<void> {
  const patch =
    status === 'reviewed' ? { reviewed_at: new Date().toISOString() }
    : status === 'done' ? { status: 'completed', reviewed_at: null }
    : { status: 'pending', reviewed_at: null };
  // A task's rows share a batch_id. The id fallback covers a row made without one. Other assignees are not touched.
  const { error } = await supabase
    .from('assignments')
    .update(patch)
    .or(`batch_id.eq.${taskId},id.eq.${taskId}`)
    .eq('assigned_to', userId);
  if (error) throw new Error(error.message);
}

/** Tasks are cancelled, never deleted, so the progress history is kept. */
export async function deactivateTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('assignments')
    .update({ status: 'cancelled' })
    .or(`batch_id.eq.${taskId},id.eq.${taskId}`);
  if (error) throw new Error(error.message);
}
