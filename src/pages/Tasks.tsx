import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Circle } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { Modal } from '../components/foundation/Modal';
import type { AuthUser } from '../lib/auth';
import { getMembers } from '../lib/queries';
import {
  createTaskWithAssignees,
  deactivateTask,
  fetchManagedTasks,
  fetchMyAssignments,
  setAssignmentStatus,
  type ManagedTask,
  type MyAssignment,
} from '../lib/queries/tasks';
import {
  TASK_DESCRIPTION_MAX,
  TASK_PRIORITIES,
  TASK_TITLE_MAX,
  canAssignTasks,
  canManageTask,
  canSetAssignmentStatus,
  compareAssignments,
  isOverdue,
  summarizeProgress,
  uniqueAssigneeIds,
  validateTaskDraft,
  type AssignmentStatus,
  type TaskDraftErrors,
  type TaskPriority,
  type TaskRole,
} from '../lib/tasks/taskRules';
import type { Member } from '../types';

interface Props { user: AuthUser | null; }

const today = () => new Date().toISOString().split('T')[0];

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
const STATUS_LABEL: Record<AssignmentStatus, string> = { open: 'Open', done: 'Done', reviewed: 'Reviewed' };

const selectClass =
  'w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100';

export const Tasks: React.FC<Props> = ({ user }) => {
  const role = (user?.role ?? 'member') as TaskRole;
  const actor = useMemo(() => (user ? { id: user.id, role } : null), [user, role]);
  const isLeader = canAssignTasks(role);

  const [mine, setMine] = useState<MyAssignment[]>([]);
  const [managed, setManaged] = useState<ManagedTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', dueDate: '', priority: 'normal', assigneeIds: [] as string[] });
  const [draftErrors, setDraftErrors] = useState<TaskDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [assignments, tasks, people] = await Promise.all([
        fetchMyAssignments(user.id),
        isLeader ? fetchManagedTasks() : Promise.resolve([] as ManagedTask[]),
        isLeader ? getMembers() : Promise.resolve([] as Member[]),
      ]);
      setMine(assignments);
      setManaged(tasks);
      setMembers(people.filter((m) => (m as Member & { status?: string }).status !== 'pending'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [user, isLeader]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (taskId: string, userId: string, next: AssignmentStatus) => {
    setError('');
    setBusyKey(`${taskId}:${userId}`);
    try {
      await setAssignmentStatus(taskId, userId, next);
      setNotice(next === 'reviewed' ? 'Marked as reviewed.' : next === 'done' ? 'Marked as done.' : 'Reopened.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the task.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreate = async () => {
    const errors = validateTaskDraft(
      { ...draft, assigneeIds: uniqueAssigneeIds(draft.assigneeIds) },
      today(),
    );
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setFormError('');
    setSaving(true);
    try {
      await createTaskWithAssignees({
        title: draft.title.trim(),
        description: draft.description.trim(),
        dueDate: draft.dueDate,
        priority: draft.priority as TaskPriority,
        assigneeIds: uniqueAssigneeIds(draft.assigneeIds),
      });
      setCreateOpen(false);
      setDraft({ title: '', description: '', dueDate: '', priority: 'normal', assigneeIds: [] });
      setNotice('Task assigned.');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the task.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (taskId: string) => {
    if (!window.confirm('Remove this task from everyone\'s list? Its progress history is kept.')) return;
    setError('');
    try {
      await deactivateTask(taskId);
      setNotice('Task removed.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the task.');
    }
  };

  const toggleAssignee = (id: string) => {
    setDraft((d) => ({
      ...d,
      assigneeIds: d.assigneeIds.includes(id) ? d.assigneeIds.filter((x) => x !== id) : [...d.assigneeIds, id],
    }));
  };

  const todayIso = today();
  const sortedMine = useMemo(
    () => [...mine].sort((a, b) => compareAssignments(
      { status: a.status, priority: a.task.priority, dueDate: a.task.due_date },
      { status: b.status, priority: b.task.priority, dueDate: b.task.due_date },
    )),
    [mine],
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Tasks</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Work assigned to you and to your team</p>
        </div>
        {isLeader && <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Assign task</Button>}
      </div>

      {error && <div className="bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 text-york-700 dark:text-york-300 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{notice}</div>}

      {/* Member dashboard: the caller's own assignments */}
      <section className="space-y-3" aria-labelledby="my-tasks-heading">
        <h2 id="my-tasks-heading" className="text-lg font-semibold text-gray-900 dark:text-slate-100">My tasks</h2>
        {loading && <div className="h-20 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />}
        {!loading && sortedMine.length === 0 && (
          <div className="text-center py-10 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <ClipboardList className="w-9 h-9 mx-auto mb-2 text-gray-300 dark:text-slate-600" />
            <p className="text-sm text-gray-500 dark:text-slate-400">Nothing assigned to you right now.</p>
          </div>
        )}
        {!loading && sortedMine.map((row) => {
          const overdue = isOverdue(row.task.due_date, row.status, todayIso);
          const key = `${row.task_id}:${row.user_id}`;
          const canDone = actor !== null && canSetAssignmentStatus(actor, row, row.task, row.status === 'open' ? 'done' : 'open');
          return (
            <article key={key} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-slate-100 break-words">{row.task.title}</h3>
                  {row.task.description && <p className="text-sm text-gray-600 dark:text-slate-300 whitespace-pre-line mt-1">{row.task.description}</p>}
                </div>
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200">
                  {PRIORITY_LABEL[row.task.priority]}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                <span>{row.task.due_date ? `Due ${row.task.due_date}` : 'No due date'}</span>
                {overdue && <span className="font-semibold text-york-600 dark:text-york-400">Overdue</span>}
                <span className="inline-flex items-center gap-1">
                  {row.status === 'open' ? <Circle className="w-3.5 h-3.5" aria-hidden="true" /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              {row.status !== 'reviewed' && canDone && (
                <Button
                  variant={row.status === 'open' ? 'primary' : 'secondary'}
                  size="small"
                  loading={busyKey === key}
                  onClick={() => changeStatus(row.task_id, row.user_id, row.status === 'open' ? 'done' : 'open')}
                >
                  {row.status === 'open' ? 'Mark done' : 'Reopen'}
                </Button>
              )}
            </article>
          );
        })}
      </section>

      {/* Staff and leader dashboard: assignments and progress */}
      {isLeader && (
        <section className="space-y-3" aria-labelledby="team-tasks-heading">
          <h2 id="team-tasks-heading" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Assigned by you and your team</h2>
          {!loading && managed.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No active tasks yet.</p>
          )}
          {!loading && managed.map((task) => {
            const progress = summarizeProgress(task.assignments.map((a) => a.status));
            const manager = actor !== null && canManageTask(actor, task);
            const nameFor = (id: string) => members.find((m) => m.id === id)?.full_name ?? 'Member';
            return (
              <article key={task.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-slate-100 break-words">{task.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      {task.due_date ? `Due ${task.due_date}` : 'No due date'} · {PRIORITY_LABEL[task.priority]} · {progress.done} of {progress.total} done
                      {progress.reviewed > 0 && ` · ${progress.reviewed} reviewed`}
                    </p>
                  </div>
                  {manager && (
                    <Button variant="ghost" size="small" onClick={() => handleDeactivate(task.id)}>Remove</Button>
                  )}
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                  {task.assignments.map((a) => {
                    const key = `${a.task_id}:${a.user_id}`;
                    const next: AssignmentStatus | null = a.status === 'open' ? 'done' : a.status === 'done' ? 'reviewed' : null;
                    const canMove = actor !== null && next !== null && canSetAssignmentStatus(actor, a, task, next);
                    return (
                      <li key={key} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-sm text-gray-800 dark:text-slate-200">{nameFor(a.user_id)}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-slate-400">{STATUS_LABEL[a.status]}</span>
                          {canMove && next === 'done' && (
                            <Button size="small" variant="secondary" loading={busyKey === key} onClick={() => changeStatus(a.task_id, a.user_id, 'done')}>Mark done</Button>
                          )}
                          {canMove && next === 'reviewed' && (
                            <Button size="small" variant="primary" loading={busyKey === key} onClick={() => changeStatus(a.task_id, a.user_id, 'reviewed')}>Review</Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </section>
      )}

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Assign a task"
        subtitle="Each person you choose gets their own progress record"
        size="medium"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleCreate}>Assign</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Title" value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} required maxLength={TASK_TITLE_MAX} placeholder="e.g. Contact three first-timers" />
          {draftErrors.title && <p className="text-sm text-york-600 dark:text-york-400">{draftErrors.title}</p>}
          <Input label="Description" type="textarea" rows={3} value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} maxLength={TASK_DESCRIPTION_MAX} />
          {draftErrors.description && <p className="text-sm text-york-600 dark:text-york-400">{draftErrors.description}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due date" type="date" value={draft.dueDate} onChange={(v) => setDraft((d) => ({ ...d, dueDate: v }))} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1" htmlFor="task-priority">Priority</label>
              <select id="task-priority" className={selectClass} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
          </div>
          {(draftErrors.dueDate || draftErrors.priority) && (
            <p className="text-sm text-york-600 dark:text-york-400">{draftErrors.dueDate ?? draftErrors.priority}</p>
          )}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Assign to</legend>
            <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={draft.assigneeIds.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                  <span>{m.full_name || m.id}</span>
                </label>
              ))}
            </div>
            {draftErrors.assignees && <p className="text-sm text-york-600 dark:text-york-400">{draftErrors.assignees}</p>}
          </fieldset>
          {formError && <p className="text-sm text-york-600 dark:text-york-400">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
};
