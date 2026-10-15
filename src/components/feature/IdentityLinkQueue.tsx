import React, { useState } from 'react';
import { Button } from '../foundation/Button';
import { getPersonIdentity, validateIdentityReason } from '../../lib/queries/identityReview';
import { linkPendingProfileToPerson, listAccountLinkQueue, type AccountLinkItem } from '../../lib/queries/identityLinkQueue';
import type { PersonIdentity } from '../../types/identityReview';

interface RowState {
  reviewed: PersonIdentity | null;
  confirmed: boolean;
  busy: boolean;
  error: string | null;
  message: string | null;
}

const emptyRow = (): RowState => ({ reviewed: null, confirmed: false, busy: false, error: null, message: null });

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100';

/**
 * The single operational queue for accounts awaiting link (migration 103). It lives on the approvals page, which only
 * administrators and coordinators reach. Opening the queue needs a reason, and the database records every read. A row is
 * linked only after the reviewer ticks the confirmation. Nothing links automatically.
 */
export const IdentityLinkQueue: React.FC = () => {
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<AccountLinkItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const reasonInvalid = validateIdentityReason(reason);

  const patch = (profileId: string, change: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [profileId]: { ...(prev[profileId] ?? emptyRow()), ...change } }));

  const load = async () => {
    if (reasonInvalid) return;
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await listAccountLinkQueue(reason));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The linking queue could not be loaded.');
    }
    setLoading(false);
  };

  const reveal = async (item: AccountLinkItem) => {
    if (!item.personId || reasonInvalid) return;
    patch(item.profileId, { busy: true, error: null });
    try {
      const reviewed = await getPersonIdentity(item.personId, reason);
      patch(item.profileId, { busy: false, reviewed });
    } catch (e) {
      patch(item.profileId, { busy: false, error: e instanceof Error ? e.message : 'Could not show this person.' });
    }
  };

  const link = async (item: AccountLinkItem) => {
    const row = rows[item.profileId] ?? emptyRow();
    if (!item.personId || reasonInvalid) return;
    if (!row.confirmed) return patch(item.profileId, { error: 'Confirm that this account belongs to the matching person first.' });
    patch(item.profileId, { busy: true, error: null, message: null });
    try {
      await linkPendingProfileToPerson(item.profileId, item.personId, reason);
      setItems((prev) => (prev ?? []).filter((x) => x.profileId !== item.profileId));
    } catch (e) {
      patch(item.profileId, { busy: false, error: e instanceof Error ? e.message : 'The account could not be linked.' });
    }
  };

  return (
    <section aria-labelledby="accounts-awaiting-link" className="space-y-4 border-t border-gray-200 dark:border-slate-800 pt-6">
      <div className="space-y-1">
        <h2 id="accounts-awaiting-link" className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          Accounts awaiting link
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-300">
          Verified sign-ups whose email matches an existing person record. They must be linked to that person before they can
          be approved. Nothing is linked automatically.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
          Reason for opening this queue and for any details (required)
          <input
            className={`${inputClass} mt-1`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Desk check of applicant identity"
          />
        </label>
        <Button variant="secondary" size="small" loading={loading} disabled={!!reasonInvalid} onClick={() => void load()}>
          {items === null ? 'Open queue' : 'Refresh queue'}
        </Button>
      </div>
      {reasonInvalid && reason.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-slate-400">{reasonInvalid}</p>
      )}

      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}

      {items !== null && items.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-slate-300">No verified accounts are waiting for a link.</p>
      )}

      {items?.map((item) => {
        const row = rows[item.profileId] ?? emptyRow();
        const canLink = !!item.personId && row.confirmed && !row.busy && !reasonInvalid;
        return (
          <article key={item.profileId} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-3">
            <header>
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{item.displayName || '(no name)'}</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Signed up {new Date(item.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </header>

            {!item.personId ? (
              <p className="text-sm text-gray-600 dark:text-slate-300">
                No existing person holds this account&apos;s email, so it cannot be linked here. Check the people records, then
                refresh the queue.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-700 dark:text-slate-200">
                  Matching person: <span className="font-medium">{item.personName ?? 'Person'}</span>
                </p>
                {row.reviewed ? (
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    {row.reviewed.fullName || 'Person'} · {row.reviewed.email ?? 'no email'} · {row.reviewed.phone ?? 'no phone'}
                  </p>
                ) : (
                  <Button variant="secondary" size="small" onClick={() => void reveal(item)} disabled={row.busy || !!reasonInvalid}>
                    Show matching person&apos;s details
                  </Button>
                )}
                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={row.confirmed}
                    disabled={row.busy}
                    onChange={(e) => patch(item.profileId, { confirmed: e.target.checked, error: null })}
                  />
                  <span>I confirm this account belongs to {item.personName ?? 'the matching person'}.</span>
                </label>
                <Button variant="primary" size="small" loading={row.busy} disabled={!canLink} onClick={() => void link(item)}>
                  Link account to {item.personName ?? 'this person'}
                </Button>
              </>
            )}
            {row.error && <p role="alert" className="text-sm text-red-600">{row.error}</p>}
          </article>
        );
      })}
    </section>
  );
};
