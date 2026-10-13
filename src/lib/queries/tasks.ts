import { supabase } from '../supabase';
import type { AssignmentStatus, TaskPriority } from '../tasks/taskRules';

// Data access for member assignments. Every write goes through RLS and the guard trigger in migration 059.

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

export async function fetchMyAssignments(userId: string): Promise<MyAssignment[]> {
  const { data, error } = await supabase
    .from('task_assignments')
    .select('task_id, user_id, status, completed_at, reviewed_at, task:tasks(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MyAssignment[]).filter((row) => row.task && row.task.is_active);
}

export async function fetchManagedTasks(): Promise<ManagedTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, assignments:task_assignments(task_id, user_id, status, completed_at, reviewed_at)')
    .eq('is_active', true)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagedTask[];
}

export async function createTaskWithAssignees(input: {
  title: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
  assigneeIds: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_task_with_assignees', {
    p_title: input.title,
    p_description: input.description,
    p_due_date: input.dueDate === '' ? null : input.dueDate,
    p_priority: input.priority,
    p_assignee_ids: input.assigneeIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Moves one assignee's row. Other assignees of the same task are not affected. */
export async function setAssignmentStatus(taskId: string, userId: string, status: AssignmentStatus): Promise<void> {
  const { error } = await supabase
    .from('task_assignments')
    .update({ status })
    .match({ task_id: taskId, user_id: userId });
  if (error) throw new Error(error.message);
}

/** Tasks are deactivated, never deleted, so the progress history is kept. */
export async function deactivateTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('tasks').update({ is_active: false }).eq('id', taskId);
  if (error) throw new Error(error.message);
}
