import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '../components/foundation/Button';
import { PageHeader } from '../components/foundation/PageHeader';
import { Badge } from '../components/foundation/Badge';
import { IdentityLinkQueue } from '../components/feature/IdentityLinkQueue';
import { effectiveRole, type AuthUser } from '../lib/auth';
import {
  getClaimIdentity,
  getPersonIdentity,
  listIdentityClaims,
  resolveIdentityClaim,
  validateIdentityReason,
} from '../lib/queries/identityReview';
import type {
  ClaimIdentity,
  IdentityClaimSummary,
  IdentityResolutionDecision,
  PersonIdentity,
} from '../types/identityReview';

interface Props { user: AuthUser | null; }

const CAN_REVIEW = ['admin', 'coordinator'];

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100';

interface ClaimState {
  reason: string;
  identity: ClaimIdentity | null;
  revealError: string | null;
  candidateId: string | null;
  decision: IdentityResolutionDecision | null;
  resolutionReason: string;
  busy: boolean;
  message: string | null;
  error: string | null;
  candidates: Record<string, PersonIdentity | undefined>;
}

const emptyState = (): ClaimState => ({
  reason: '',
  identity: null,
  revealError: null,
  candidateId: null,
  decision: null,
  resolutionReason: '',
  busy: false,
  message: null,
  error: null,
  candidates: {},
});

export const PersonIdentityReview: React.FC<Props> = ({ user }) => {
  const role = effectiveRole(user);
  const allowed = CAN_REVIEW.includes(role);

  const [claims, setClaims] = useState<IdentityClaimSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ClaimState>>({});

  const update = (claimId: string, patch: Partial<ClaimState>) =>
    setStates((prev) => ({ ...prev, [claimId]: { ...(prev[claimId] ?? emptyState()), ...patch } }));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setClaims(await listIdentityClaims('open', 100));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The review queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const reveal = async (claim: IdentityClaimSummary) => {
    const state = states[claim.claimId] ?? emptyState();
    const invalid = validateIdentityReason(state.reason);
    if (invalid) return update(claim.claimId, { revealError: invalid });
    update(claim.claimId, { busy: true, revealError: null });
    try {
      const identity = await getClaimIdentity(claim.claimId, state.reason);
      update(claim.claimId, { identity, busy: false });
    } catch (e) {
      update(claim.claimId, { busy: false, revealError: e instanceof Error ? e.message : 'Could not reveal the submitted details.' });
    }
  };

  const revealCandidate = async (claim: IdentityClaimSummary, personId: string) => {
    const state = states[claim.claimId] ?? emptyState();
    const invalid = validateIdentityReason(state.reason);
    if (invalid) return update(claim.claimId, { revealError: invalid });
    update(claim.claimId, { busy: true, revealError: null });
    try {
      const identity = await getPersonIdentity(personId, state.reason);
      update(claim.claimId, {
        busy: false,
        candidates: { ...state.candidates, [personId]: identity },
      });
    } catch (e) {
      update(claim.claimId, { busy: false, revealError: e instanceof Error ? e.message : 'Could not reveal this person.' });
    }
  };

  const resolve = async (claim: IdentityClaimSummary) => {
    const state = states[claim.claimId] ?? emptyState();
    if (!state.decision) return update(claim.claimId, { error: 'Choose attach or keep separate first.' });
    const invalid = validateIdentityReason(state.resolutionReason);
    if (invalid) return update(claim.claimId, { error: invalid });
    update(claim.claimId, { busy: true, error: null, message: null });
    try {
      const outcome = await resolveIdentityClaim(claim.claimId, state.decision, state.candidateId, state.resolutionReason);
      const text = outcome === 'attached'
        ? 'Attached to the chosen person.'
        : outcome === 'kept_separate'
          ? 'Kept as a separate person.'
          : 'This review no longer matches a record and was closed.';
      update(claim.claimId, { busy: false, message: text });
      await load();
    } catch (e) {
      update(claim.claimId, { busy: false, error: e instanceof Error ? e.message : 'The review could not be resolved.' });
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <PageHeader title="Identity review" description="Available to administrators and coordinators." />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Identity review"
        icon={<ClipboardCheck className="w-5 h-5" />}
        description="Contacts logged with an email or phone that already belongs to another person wait here. Nothing is merged until a reviewer decides."
        actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      <IdentityLinkQueue />

      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      {!loading && !loadError && claims.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-slate-300">No contacts are waiting for review.</p>
      )}

      {claims.map((claim) => {
        const state = states[claim.claimId] ?? emptyState();
        return (
          <section key={claim.claimId} className="rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-4">
            <header className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{claim.contactName}</h2>
              <Badge>{claim.status}</Badge>
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {new Date(claim.createdAt).toLocaleDateString()}
              </span>
            </header>

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Matching people</p>
              <ul className="space-y-2">
                {claim.candidatePersonIds.map((personId, index) => {
                  const shown = state.candidates[personId];
                  return (
                    <li key={personId} className="flex flex-wrap items-center gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`candidate-${claim.claimId}`}
                          checked={state.candidateId === personId}
                          onChange={() => update(claim.claimId, { candidateId: personId })}
                        />
                        <span>{claim.candidateNames[index] ?? 'Person'}</span>
                      </label>
                      {shown ? (
                        <span className="text-gray-600 dark:text-slate-300">
                          {shown.email ?? 'no email'} · {shown.phone ?? 'no phone'}
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => void revealCandidate(claim, personId)}
                          disabled={state.busy}
                        >
                          Show details (needs reason)
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200" htmlFor={`reason-${claim.claimId}`}>
                Reason for viewing details
              </label>
              <input
                id={`reason-${claim.claimId}`}
                className={inputClass}
                value={state.reason}
                onChange={(e) => update(claim.claimId, { reason: e.target.value, revealError: null })}
                maxLength={500}
              />
              <Button variant="secondary" size="small" onClick={() => void reveal(claim)} disabled={state.busy}>
                Show submitted details
              </Button>
              {state.identity && (
                <p className="text-sm text-gray-700 dark:text-slate-200">
                  Submitted: {state.identity.submittedEmail ?? 'no email'} · {state.identity.submittedPhone ?? 'no phone'}
                </p>
              )}
              {state.revealError && <p role="alert" className="text-sm text-red-600">{state.revealError}</p>}
            </div>

            <div className="space-y-2 border-t border-gray-100 dark:border-slate-800 pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={state.decision === 'attach' ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => update(claim.claimId, { decision: 'attach' })}
                  disabled={state.busy}
                >
                  Same person: attach
                </Button>
                <Button
                  variant={state.decision === 'keep_separate' ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => update(claim.claimId, { decision: 'keep_separate' })}
                  disabled={state.busy}
                >
                  Different person: keep separate
                </Button>
              </div>
              <input
                aria-label="Reason for this decision"
                className={inputClass}
                placeholder="Reason for this decision"
                value={state.resolutionReason}
                onChange={(e) => update(claim.claimId, { resolutionReason: e.target.value, error: null })}
                maxLength={500}
              />
              <Button variant="primary" size="small" onClick={() => void resolve(claim)} disabled={state.busy}>
                Record decision
              </Button>
              {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
              {state.message && <p role="status" className="text-sm text-green-700">{state.message}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
};
