import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../foundation/Button';
import { Badge } from '../foundation/Badge';
import { getPersonIdentity, validateIdentityReason } from '../../lib/queries/identityReview';
import { linkPendingProfileToPerson, listIdentityLinkQueue, type IdentityLinkItem } from '../../lib/queries/identityLinkQueue';
import type { PersonIdentity } from '../../types/identityReview';

interface RowState {
  reason: string;
  confirmed: boolean;
  reviewed: PersonIdentity | null;
  busy: boolean;
  error: string | null;
  message: string | null;
}

const emptyRow = (): RowState => ({ reason: '', confirmed: false, reviewed: null, busy: false, error: null, message: null });

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100';

/**
 * Staff queue for existing members who need identity linking before approval. Staff see masked addresses in the list.
 * Revealing the matching person's full details is a reason-gated, audited call (get_person_identity). Linking is a
 * separate, explicitly confirmed, reason-gated call (link_pending_profile_to_person). Nothing links automatically.
 */
export const IdentityLinkQueue: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [items, setItems] = useState<IdentityLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const patch = (profileId: string, change: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [profileId]: { ...(prev[profileId] ?? emptyRow()), ...change } }));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await listIdentityLinkQueue(100));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The linking queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (item: IdentityLinkItem) => {
    const row = rows[item.profileId] ?? emptyRow();
    const invalid = validateIdentityReason(row.reason);
    if (invalid) return patch(item.profileId, { error: invalid });
    patch(item.profileId, { busy: true, error: null });
    try {
      const reviewed = await getPersonIdentity(item.candidatePersonId, row.reason);
      patch(item.profileId, { busy: false, reviewed });
    } catch (e) {
      patch(item.profileId, { busy: false, error: e instanceof Error ? e.message : 'Could not show this person.' });
    }
  };

  const link = async (item: IdentityLinkItem) => {
    const row = rows[item.profileId] ?? emptyRow();
    const invalid = validateIdentityReason(row.reason);
    if (invalid) return patch(item.profileId, { error: invalid });
    if (!row.confirmed) return patch(item.profileId, { error: 'Confirm that this is the same person first.' });
    patch(item.profileId, { busy: true, error: null, message: null });
    try {
      await linkPendingProfileToPerson(item.profileId, item.candidatePersonId, row.reason);
      patch(item.profileId, { busy: false, message: 'Linked. The account can now be approved from Pending Approvals.' });
      await load();
      onChanged?.();
    } catch (e) {
      patch(item.profileId, { busy: false, error: e instanceof Error ? e.message : 'The account could not be linked.' });
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="identity-link-heading">
      <div>
        <h2 id="identity-link-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
          Accounts waiting for identity linking
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          These members have a pending account whose email matches an existing person record. They cannot be approved until
          a reviewer links the account to that person.
        </p>
      </div>

      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-slate-300">No accounts are waiting for identity linking.</p>
      )}

      {items.map((item) => {
        const row = rows[item.profileId] ?? emptyRow();
        const blocked = item.pendingEmailChange || !item.emailVerified;
        const canLink = !blocked && !row.busy && row.confirmed && validateIdentityReason(row.reason) === null;
        return (
          <article key={item.profileId} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-4">
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{item.profileName || '(no name)'}</h3>
              <span className="text-sm text-gray-500 dark:text-slate-400">{item.profileMaskedEmail ?? 'no email'}</span>
              {item.emailVerified
                ? <Badge variant="success" size="small">Email verified</Badge>
                : <Badge variant="warning" size="small">Waiting for email verification</Badge>}
              {item.pendingEmailChange && <Badge variant="error" size="small">Pending email change</Badge>}
            </header>

            <p className="text-sm text-gray-700 dark:text-slate-200">
              Matching person: <span className="font-medium">{item.candidateName || 'Person'}</span>{' '}
              <span className="text-gray-500 dark:text-slate-400">({item.candidateMaskedEmail ?? 'no email'})</span>
            </p>

            {item.pendingEmailChange && (
              <p role="alert" className="text-sm text-red-600">
                This account has a pending email change. It cannot be linked until that change is resolved.
              </p>
            )}
            {!item.emailVerified && !item.pendingEmailChange && (
              <p className="text-sm text-gray-600 dark:text-slate-300">
                The member has not verified this email yet. Linking becomes possible after they enter their code.
              </p>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200" htmlFor={`link-reason-${item.profileId}`}>
                Reason (required, recorded in the audit log)
              </label>
              <input
                id={`link-reason-${item.profileId}`}
                className={inputClass}
                value={row.reason}
                maxLength={500}
                disabled={blocked || row.busy}
                onChange={(e) => patch(item.profileId, { reason: e.target.value, error: null })}
              />
              <Button variant="secondary" size="small" onClick={() => void review(item)} disabled={blocked || row.busy}>
                Show matching person details
              </Button>
              {row.reviewed && (
                <p className="text-sm text-gray-700 dark:text-slate-200">
                  {row.reviewed.fullName || 'Person'} · {row.reviewed.email ?? 'no email'} · {row.reviewed.phone ?? 'no phone'}
                </p>
              )}
            </div>

            <div className="space-y-2 border-t border-gray-100 dark:border-slate-800 pt-4">
              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={row.confirmed}
                  disabled={blocked || row.busy}
                  onChange={(e) => patch(item.profileId, { confirmed: e.target.checked, error: null })}
                />
                <span>I have checked that this member is the same person as the matching record.</span>
              </label>
              <Button variant="primary" size="small" onClick={() => void link(item)} disabled={!canLink}>
                Link account to this person
              </Button>
              {row.error && <p role="alert" className="text-sm text-red-600">{row.error}</p>}
              {row.message && <p role="status" className="text-sm text-green-700">{row.message}</p>}
            </div>
          </article>
        );
      })}
    </section>
  );
};
