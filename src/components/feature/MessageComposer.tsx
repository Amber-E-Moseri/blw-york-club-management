import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import {
  allowedModes,
  canSendExternal,
  emptySelection,
  deliveryLabel,
  newIdempotencyKey,
  selectionProblem,
  validateDraft,
  type AudienceMode,
  type AudienceSelection,
  type Channel,
} from '../../lib/communications/messaging';
import {
  listActiveMembersForComposer,
  listCellsForComposer,
  listSavedGroupsForComposer,
  previewAudience,
  sendMessage,
  type AudiencePreview,
  type SendResult,
} from '../../lib/queries/communications';

const MODE_LABEL: Record<AudienceMode, string> = {
  all: 'Everyone',
  cells: 'Cells',
  saved_groups: 'Saved groups',
  explicit: 'Specific people',
};

interface Props {
  user: AuthUser;
  /** Cells the caller leads (cells.leader_id = caller). Leadership is assignment, not profiles.cell_id. */
  ledCellIds: string[];
  onSent: (result: SendResult) => void;
}

function sameSelection(a: AudienceSelection, b: AudienceSelection): boolean {
  return a.mode === b.mode
    && a.cellIds.join() === b.cellIds.join()
    && a.groupIds.join() === b.groupIds.join()
    && a.profileIds.join() === b.profileIds.join();
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export const MessageComposer: React.FC<Props> = ({ user, ledCellIds, onSent }) => {
  const modes = allowedModes(user.role, ledCellIds);
  const isStaff = user.role === 'admin' || user.role === 'coordinator';
  const externalAllowed = canSendExternal(user.role);
  const [selection, setSelection] = useState<AudienceSelection>(() => emptySelection(modes[0] ?? 'explicit'));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['inbox']);
  const [cells, setCells] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string | null; cellId: string | null }>>([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [preview, setPreview] = useState<{ selection: AudienceSelection; result: AudiencePreview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  // One key per send attempt. A retry after a network error reuses it, so the database cannot store two messages.
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (modes.includes('cells')) listCellsForComposer().then(setCells).catch((e) => setError(e.message));
    if (modes.includes('saved_groups')) listSavedGroupsForComposer().then(setGroups).catch((e) => setError(e.message));
    if (modes.includes('explicit')) listActiveMembersForComposer().then(setMembers).catch((e) => setError(e.message));
    // modes depends only on the signed-in role, which does not change while the composer is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, ledCellIds.join(',')]);

  const visibleMembers = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    return q ? members.filter((m) => (m.name ?? '').toLowerCase().includes(q)) : members;
  }, [members, memberFilter]);

  const draft = { subject, body, selection, channels };
  const errors = validateDraft(draft);
  const problem = selectionProblem(user.role, ledCellIds, selection);
  const previewIsCurrent = !!preview && sameSelection(preview.selection, selection);

  function changeSelection(next: AudienceSelection) {
    setSelection(next);
    setPreview(null);
    setResult(null);
    keyRef.current = null;
  }

  function toggleChannel(channel: Channel) {
    setChannels((current) => (current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]));
    keyRef.current = null;
  }

  async function handlePreview() {
    if (problem) return setError(problem);
    setError(null);
    setPreviewing(true);
    try {
      const result = await previewAudience(selection);
      setPreview({ selection, result });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preview this audience.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    if (!previewIsCurrent || Object.keys(errors).length > 0 || problem) return;
    setError(null);
    setSending(true);
    keyRef.current = keyRef.current ?? newIdempotencyKey();
    try {
      const sent = await sendMessage(draft, keyRef.current);
      setResult(sent);
      onSent(sent);
      setSubject('');
      setBody('');
      setPreview(null);
      keyRef.current = null;
    } catch (e) {
      // Keep the draft and the key, so pressing Send again retries the same message rather than creating another.
      setError(e instanceof Error ? e.message : 'Could not send this message. Your draft is kept.');
    } finally {
      setSending(false);
    }
  }

  if (modes.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">Only leaders and staff can send messages.</p>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="audience-heading" className="space-y-3">
        <h2 id="audience-heading" className="text-sm font-semibold text-gray-800 dark:text-slate-100">Who should receive this?</h2>
        <div role="radiogroup" aria-label="Audience" className="flex flex-wrap gap-2">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selection.mode === mode}
              onClick={() => changeSelection(emptySelection(mode))}
              className={cn(
                'rounded-md border px-3 py-2 text-sm font-medium transition-colors min-h-[44px]',
                selection.mode === mode
                  ? 'border-york-600 bg-york-50 text-york-700 dark:bg-york-900/30 dark:text-york-300'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-slate-600 dark:text-slate-300',
              )}
            >
              {MODE_LABEL[mode]}
            </button>
          ))}
        </div>

        {selection.mode === 'all' && (
          <p className="text-sm text-gray-500 dark:text-slate-400">Every active member, including you.</p>
        )}

        {selection.mode === 'cells' && (
          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <legend className="sr-only">Cells</legend>
            {cells
              .filter((c) => isStaff || ledCellIds.includes(c.id))
              .map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-600 px-3 py-2 min-h-[44px] text-sm">
                  <input
                    type="checkbox"
                    checked={selection.cellIds.includes(c.id)}
                    onChange={() => changeSelection({ ...selection, cellIds: toggle(selection.cellIds, c.id) })}
                  />
                  {c.name}
                </label>
              ))}
          </fieldset>
        )}

        {selection.mode === 'saved_groups' && (
          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <legend className="sr-only">Saved groups</legend>
            {groups.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No saved groups yet.</p>}
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-600 px-3 py-2 min-h-[44px] text-sm">
                <input
                  type="checkbox"
                  checked={selection.groupIds.includes(g.id)}
                  onChange={() => changeSelection({ ...selection, groupIds: toggle(selection.groupIds, g.id) })}
                />
                {g.name}
              </label>
            ))}
          </fieldset>
        )}

        {selection.mode === 'explicit' && (
          <div className="space-y-2">
            <Input label="Find a person" value={memberFilter} onChange={setMemberFilter} placeholder="Type a name" />
            <p className="text-xs text-gray-500 dark:text-slate-400">{selection.profileIds.length} selected</p>
            <ul className="max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-600 divide-y divide-gray-100 dark:divide-slate-700">
              {visibleMembers.map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-2 px-3 py-2 min-h-[44px] text-sm">
                    <input
                      type="checkbox"
                      checked={selection.profileIds.includes(m.id)}
                      onChange={() => changeSelection({ ...selection, profileIds: toggle(selection.profileIds, m.id) })}
                    />
                    {m.name ?? 'Unnamed member'}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={handlePreview} loading={previewing} disabled={!!problem}>
            Preview recipients
          </Button>
          {problem && <span className="text-sm text-york-700 dark:text-york-300">{problem}</span>}
        </div>

        {preview && previewIsCurrent && (
          <div className="rounded-md border border-gray-200 dark:border-slate-600 p-3 space-y-2" aria-live="polite">
            <p className="text-sm font-medium text-gray-800 dark:text-slate-100">
              {preview.result.count === 0 ? 'No active members match this audience.' : `Will reach ${preview.result.count} active ${preview.result.count === 1 ? 'member' : 'members'}`}
            </p>
            {preview.result.recipients.length > 0 && preview.result.recipients.length <= 12 && (
              <p className="text-xs text-gray-600 dark:text-slate-300">{preview.result.recipients.map((r) => r.name ?? 'Unnamed member').join(', ')}</p>
            )}
            <p className="text-xs text-gray-500 dark:text-slate-400">Pending, rejected and inactive members are never included.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="delivery-heading" className="space-y-3">
        <h2 id="delivery-heading" className="text-sm font-semibold text-gray-800 dark:text-slate-100">How should it reach them?</h2>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-600 px-3 py-2 min-h-[44px] text-sm text-gray-500">
            <input type="checkbox" checked disabled /> In-app inbox (always)
          </label>
          {(['email', 'push'] as Channel[]).map((c) => (
            <label key={c} className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-600 px-3 py-2 min-h-[44px] text-sm">
              <input
                type="checkbox"
                checked={channels.includes(c)}
                disabled={!externalAllowed}
                onChange={() => toggleChannel(c)}
              />
              {c === 'email' ? 'Email' : 'Push notification'}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Email and push are sent separately. Members who opted out of announcements, or who have no push device, are skipped and shown as skipped.
        </p>
      </section>

      <section aria-labelledby="content-heading" className="space-y-3">
        <h2 id="content-heading" className="sr-only">Message</h2>
        <Input label="Subject" value={subject} onChange={(v) => { setSubject(v); setResult(null); }} error={errors.subject} required />
        <Input label="Message" type="textarea" value={body} onChange={(v) => { setBody(v); setResult(null); }} error={errors.body} required rows={6} />
      </section>

      {error && (
        <div role="alert" className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-york-700 dark:text-york-300">
          {error}
        </div>
      )}

      {result && (
        <div role="status" className="rounded-md border border-gray-200 dark:border-slate-600 p-4 space-y-1 text-sm">
          <p className="font-medium text-gray-800 dark:text-slate-100">Message stored and in the member inbox.</p>
          {result.dispatchError && <p className="text-york-700 dark:text-york-300">Email and push could not be started: {result.dispatchError}</p>}
          {result.dispatch && (
            <ul className="text-gray-600 dark:text-slate-300 list-disc pl-5">
              {(['email', 'push'] as const)
                .filter((c) => channels.includes(c))
                .map((c) => (
                  <li key={c}>
                    {deliveryLabel(c, 'accepted')}: {result.dispatch![c].accepted}, failed: {result.dispatch![c].failed}, skipped: {result.dispatch![c].skipped}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleSend}
          loading={sending}
          disabled={!previewIsCurrent || Object.keys(errors).length > 0 || !!problem || sending}
        >
          {keyRef.current ? 'Retry send' : 'Send message'}
        </Button>
      </div>
    </div>
  );
};
