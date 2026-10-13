import React, { useEffect, useState } from 'react';
import { MessageComposer } from '../components/feature/MessageComposer';
import { PageHeader } from '../components/foundation/PageHeader';
import { allowedModes, deliveryLabel, MESSAGE_STATUS_LABEL, messageStatusFor } from '../lib/communications/messaging';
import {
  listInbox,
  listSentMessages,
  markMessageRead,
  type InboxMessage,
  type SendResult,
  type SentMessage,
} from '../lib/queries/communications';
import type { AuthUser } from '../lib/auth';
import { cn } from '../lib/utils';

interface Props {
  user: AuthUser | null;
}

type Tab = 'inbox' | 'compose' | 'sent';

export const Communications: React.FC<Props> = ({ user }) => {
  const canCompose = !!user && allowedModes(user.role, user.cellId).length > 0;
  const [tab, setTab] = useState<Tab>('inbox');
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'inbox', label: 'Inbox' },
    ...(canCompose ? [{ id: 'compose' as Tab, label: 'New message' }, { id: 'sent' as Tab, label: 'Sent' }] : []),
  ];

  async function refreshInbox() {
    try {
      setInbox(await listInbox());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your inbox.');
    }
  }

  async function refreshSent() {
    try {
      setSent(await listSentMessages());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load sent messages.');
    }
  }

  useEffect(() => {
    if (!user) return;
    refreshInbox();
    if (canCompose) refreshSent();
    // Reload only when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleOpen(message: InboxMessage) {
    setOpenId(openId === message.messageId ? null : message.messageId);
    if (!message.readAt) {
      try {
        await markMessageRead(message.messageId);
        setInbox((items) => items.map((i) => (i.messageId === message.messageId ? { ...i, readAt: new Date().toISOString() } : i)));
      } catch {
        // The read marker is best-effort. The next load shows the stored state.
      }
    }
  }

  function handleSent(result: SendResult) {
    setLoadError(null);
    refreshSent();
    if (!result.dispatchError) setTab('sent');
  }

  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          eyebrow="Community"
          title="Messages"
          description="Personal and group messages from BLW York leadership."
        />

        <div role="tablist" aria-label="Messages" className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-2 min-h-[44px] text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                tab === t.id
                  ? 'border-york-600 text-york-700 dark:text-york-300'
                  : 'border-transparent text-gray-500 dark:text-slate-400',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loadError && (
          <div role="alert" className="rounded-md border border-york-200 dark:border-york-800 bg-york-50 dark:bg-york-900/30 px-4 py-3 text-sm text-york-700 dark:text-york-300">
            {loadError}
          </div>
        )}

        {tab === 'inbox' && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
            {inbox.length === 0 && <p className="p-6 text-sm text-gray-500 dark:text-slate-400">No messages yet.</p>}
            {inbox.map((m) => (
              <article key={m.messageId} className="px-4 sm:px-6 py-4">
                <button
                  type="button"
                  onClick={() => handleOpen(m)}
                  aria-expanded={openId === m.messageId}
                  className="w-full text-left min-h-[44px] flex items-start justify-between gap-3"
                >
                  <span className={cn('text-sm', !m.readAt ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-300')}>
                    {m.subject}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-slate-400 whitespace-nowrap">
                    {!m.readAt && <span className="mr-2 text-york-700 dark:text-york-300">New</span>}
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                </button>
                {openId === m.messageId && (
                  <p className="mt-2 text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{m.body}</p>
                )}
              </article>
            ))}
          </div>
        )}

        {tab === 'compose' && canCompose && user && (
          <div className="card">
            <MessageComposer user={user} onSent={handleSent} />
          </div>
        )}

        {tab === 'sent' && canCompose && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
            {sent.length === 0 && <p className="p-6 text-sm text-gray-500 dark:text-slate-400">Nothing sent yet.</p>}
            {sent.map((m) => {
              const status = messageStatusFor(m.deliveries.map((d) => d.status));
              return (
                <article key={m.id} className="px-4 sm:px-6 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{m.subject}</p>
                    <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">{new Date(m.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {m.recipientCount} {m.recipientCount === 1 ? 'recipient' : 'recipients'} · {MESSAGE_STATUS_LABEL[status]}
                  </p>
                  <ul className="text-xs text-gray-600 dark:text-slate-300 space-y-0.5">
                    {m.deliveries.map((d) => (
                      <li key={`${d.channel}-${d.status}`}>
                        {deliveryLabel(d.channel, d.status, d.reason)} · {d.count}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
