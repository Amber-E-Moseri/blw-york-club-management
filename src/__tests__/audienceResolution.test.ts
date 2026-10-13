// Client preview and spec conversions for the canonical audience model. The database certification
// (supabase/verification/audience_reconcile_certification.mjs) is authoritative; these rules must agree with it.
import { resolveAudience, resolveRecipientIds, validateAudienceSpec } from '../lib/audience/resolveAudience';
import {
  draftToTerms,
  emptySpecDraft,
  flipEffect,
  removeTerm,
  termsToDraft,
  toCreateSpecArgs,
  toggleInclude,
} from '../lib/audience/spec';
import type {
  AudienceCandidate,
  AudienceData,
  AudienceScope,
  AudienceSpecDraft,
} from '../types/audience';

const CELL_A = 'cell-a';
const CELL_B = 'cell-b';
const CELL_C = 'cell-c';

const ADMIN = 'p-admin';
const LEADER_A = 'p-leader-a';
const A1 = 'p-a1';
const A2 = 'p-a2';
const A_PENDING = 'p-a-pending';
const B1 = 'p-b1';
const B_REJECTED = 'p-b-rejected';

const candidate = (
  id: string,
  status: AudienceCandidate['status'],
  cellId: string | null,
  fullName = id,
): AudienceCandidate => ({ id, fullName, email: `${id}@example.test`, cellId, status });

const people: AudienceCandidate[] = [
  candidate(ADMIN, 'active', null, 'Admin'),
  candidate(LEADER_A, 'active', CELL_A, 'Leader A'),
  candidate(A1, 'active', CELL_A, 'A1'),
  candidate(A2, 'active', CELL_A, 'A2'),
  candidate(A_PENDING, 'pending', CELL_A, 'A pending'),
  candidate(B1, 'active', CELL_B, 'B1'),
  candidate(B_REJECTED, 'rejected', CELL_B, 'B rejected'),
];

const GROUP_MIXED = 'g-mixed';
const GROUP_ARCHIVED = 'g-archived';

const data: AudienceData = {
  candidates: people,
  cells: [
    { id: CELL_A, name: 'Cell A' },
    { id: CELL_B, name: 'Cell B' },
    { id: CELL_C, name: 'Cell C (empty)' },
  ],
  groups: [
    // Crosses cells and includes a pending member. Leader A must see only the A-cell active member.
    { id: GROUP_MIXED, name: 'Mixed group', isActive: true, memberIds: [A1, B1, A_PENDING] },
    { id: GROUP_ARCHIVED, name: 'Archived group', isActive: false, memberIds: [A2] },
  ],
};

const admin: AudienceScope = { canUseEveryone: true, ledCellIds: [CELL_A, CELL_B, CELL_C], canExclude: true };
const leaderA: AudienceScope = { canUseEveryone: false, ledCellIds: [CELL_A], canExclude: false };

const spec = (over: Partial<AudienceSpecDraft>): AudienceSpecDraft => ({ ...emptySpecDraft(), ...over });

describe('recipient preview: everyone', () => {
  test('admin "all" returns every active profile and no pending or rejected ones', () => {
    const r = resolveAudience(spec({ mode: 'all' }), data, admin);
    expect(r.errors).toEqual([]);
    expect(r.recipientIds).toEqual([ADMIN, LEADER_A, A1, A2, B1].sort());
    expect(r.recipientIds).not.toContain(A_PENDING);
    expect(r.recipientIds).not.toContain(B_REJECTED);
  });

  test('a cell leader cannot address everyone', () => {
    const r = resolveAudience(spec({ mode: 'all' }), data, leaderA);
    expect(r.errors).toContain('everyone_not_permitted');
    expect(r.recipientIds).toEqual([]);
  });

  test('"all" with an include kind is refused, never silently widened to a broadcast', () => {
    const errors = validateAudienceSpec(spec({ mode: 'all', cellIds: [CELL_A] }), data, admin);
    expect(errors).toEqual(['mode_mismatch']);
  });
});

describe('recipient preview: cells, groups and specific members', () => {
  test('a cell resolves to its active members only', () => {
    const r = resolveAudience(spec({ mode: 'cells', cellIds: [CELL_A] }), data, leaderA);
    expect(r.errors).toEqual([]);
    expect(r.recipientIds).toEqual([A1, A2, LEADER_A].sort());
    expect(r.recipientIds).not.toContain(A_PENDING);
  });

  test('a saved group resolves to its active members only', () => {
    const r = resolveAudience(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), data, admin);
    expect(r.recipientIds).toEqual([A1, B1].sort());
  });

  test('a named pending person resolves to nothing and is not an authorization error', () => {
    const r = resolveAudience(spec({ mode: 'explicit', profileIds: [A_PENDING] }), data, admin);
    expect(r.errors).toEqual(['empty_audience']);
    expect(r.recipientIds).toEqual([]);
  });

  test('an explicit list resolves to exactly the named active people', () => {
    const r = resolveAudience(spec({ mode: 'explicit', profileIds: [A2, B1] }), data, admin);
    expect(r.recipientIds).toEqual([A2, B1].sort());
  });
});

describe('cross-cell isolation', () => {
  test('a leader cannot target a cell they do not lead', () => {
    const errors = validateAudienceSpec(spec({ mode: 'cells', cellIds: [CELL_B] }), data, leaderA);
    expect(errors).toEqual(['out_of_scope_cell']);
    expect(resolveAudience(spec({ mode: 'cells', cellIds: [CELL_B] }), data, leaderA).recipientIds).toEqual([]);
  });

  test('a leader cannot target a saved group, a person, or several cells', () => {
    expect(validateAudienceSpec(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), data, leaderA)).toContain('mode_mismatch');
    expect(validateAudienceSpec(spec({ mode: 'explicit', profileIds: [B1] }), data, leaderA)).toContain('mode_mismatch');
    expect(validateAudienceSpec(spec({ mode: 'cells', cellIds: [CELL_A, CELL_B] }), data, leaderA)).toContain('mode_mismatch');
  });

  test('a leader cannot use exclusions', () => {
    const errors = validateAudienceSpec(spec({ mode: 'cells', cellIds: [CELL_A], excludedProfileIds: [A2] }), data, leaderA);
    expect(errors).toEqual(['exclusions_not_permitted']);
  });

  test('a leader cannot preview a shared group, so no cross-cell membership is shown', () => {
    const r = resolveAudience(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), data, leaderA);
    expect(r.errors).toContain('mode_mismatch');
    expect(r.recipientIds).toEqual([]);
  });

  test('the resolver still drops out-of-scope members as a second line of defence', () => {
    // Validation stops leaders building a group spec. If one reached the resolver, B1 must still be dropped.
    const ids = resolveRecipientIds(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), data, leaderA);
    expect(ids).toEqual([A1]);
    expect(ids).not.toContain(B1);
  });
});

describe('deduplication of overlapping audiences', () => {
  test('one person reached by a cell, a person and a group appears exactly once', () => {
    const r = resolveAudience(
      spec({ mode: 'composite', cellIds: [CELL_A], profileIds: [A1], groupIds: [GROUP_MIXED] }),
      data,
      leaderA,
    );
    // Composite is staff-only for leaders, so use an admin here: the dedupe rule is what is under test.
    const adminR = resolveAudience(
      spec({ mode: 'composite', cellIds: [CELL_A], profileIds: [A1], groupIds: [GROUP_MIXED] }),
      data,
      admin,
    );
    expect(r.errors).toContain('mode_mismatch');
    expect(adminR.errors).toEqual([]);
    expect(adminR.recipientIds.filter((id) => id === A1)).toHaveLength(1);
    expect(new Set(adminR.recipientIds).size).toBe(adminR.recipientIds.length);
    expect(adminR.recipientIds).toEqual([A1, A2, B1, LEADER_A].sort());
  });
});

describe('exclusion', () => {
  test('an exclusion removes a person an include reaches (exclusion wins)', () => {
    const r = resolveAudience(spec({ mode: 'all', excludedProfileIds: [A2] }), data, admin);
    expect(r.recipientIds).not.toContain(A2);
    expect(r.recipientIds).toContain(A1);
  });

  test('"everyone except cell B" removes every member of cell B', () => {
    const r = resolveAudience(spec({ mode: 'all', excludedCellIds: [CELL_B] }), data, admin);
    expect(r.recipientIds).toEqual([ADMIN, LEADER_A, A1, A2].sort());
  });

  test('an excluded group removes its members even when an include reaches them through a cell', () => {
    const r = resolveAudience(
      spec({ mode: 'composite', cellIds: [CELL_A], profileIds: [B1], excludedGroupIds: [GROUP_MIXED] }),
      data,
      admin,
    );
    expect(r.recipientIds).not.toContain(A1);
    expect(r.recipientIds).not.toContain(B1);
    expect(r.recipientIds).toEqual([A2, LEADER_A].sort());
  });

  test('an exclusion-only spec has no include and is refused', () => {
    const errors = validateAudienceSpec(spec({ mode: 'composite', excludedCellIds: [CELL_A] }), data, admin);
    expect(errors).toEqual(['no_include']);
  });

  test('excluding everyone who is included leaves an empty audience, reported as a validation result', () => {
    const r = resolveAudience(spec({ mode: 'explicit', profileIds: [A1], excludedProfileIds: [A1] }), data, admin);
    expect(r.errors).toEqual(['empty_audience']);
    expect(r.recipientIds).toEqual([]);
  });
});

describe('validation: refusals never become a broadcast', () => {
  test('an empty spec reports no include', () => {
    expect(validateAudienceSpec(spec({ mode: 'composite' }), data, admin)).toEqual(['no_include']);
  });

  test('an archived group is refused as unknown', () => {
    const r = resolveAudience(spec({ mode: 'saved_groups', groupIds: [GROUP_ARCHIVED] }), data, admin);
    expect(r.errors).toEqual(['unknown_group']);
    expect(r.recipientIds).toEqual([]);
  });

  test('an unknown person is refused the same way as an out-of-scope one', () => {
    const r = resolveAudience(spec({ mode: 'explicit', profileIds: ['p-missing'] }), data, admin);
    expect(r.errors).toEqual(['out_of_scope_member']);
  });

  test('a mode that does not match its kinds is refused and nothing is resolved', () => {
    const r = resolveAudience(spec({ mode: 'cells', groupIds: [GROUP_MIXED] }), data, admin);
    expect(r.errors).toContain('mode_mismatch');
    expect(r.recipientIds).toEqual([]);
  });

  test('errors come back in a stable order', () => {
    const errors = validateAudienceSpec(
      spec({ mode: 'all', excludedCellIds: [CELL_A] }),
      data,
      leaderA,
    );
    expect(errors).toEqual(['everyone_not_permitted', 'exclusions_not_permitted']);
  });
});

describe('membership is a function of current data (the preview is not stored)', () => {
  test('a changed group changes the next preview', () => {
    const before = resolveAudience(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), data, admin);
    const changed: AudienceData = {
      ...data,
      groups: data.groups.map((g) => (g.id === GROUP_MIXED ? { ...g, memberIds: [A1] } : g)),
    };
    const after = resolveAudience(spec({ mode: 'saved_groups', groupIds: [GROUP_MIXED] }), changed, admin);
    expect(before.recipientIds).toContain(B1);
    expect(after.recipientIds).toEqual([A1]);
  });
});

describe('composer conversions and RPC arguments', () => {
  test('toggling an include adds it once and toggling again removes it', () => {
    let terms = toggleInclude([], { kind: 'cell', id: CELL_A, effect: 'include' });
    expect(terms).toHaveLength(1);
    terms = toggleInclude(terms, { kind: 'cell', id: CELL_A, effect: 'include' });
    expect(terms).toEqual([]);
  });

  test('flipping a term turns an include into an exclusion and back', () => {
    const terms = toggleInclude([], { kind: 'person', id: A2, effect: 'include' });
    const excluded = flipEffect(terms, { kind: 'person', id: A2, effect: 'include' });
    expect(termsToDraft(excluded).excludedProfileIds).toEqual([A2]);
    expect(termsToDraft(flipEffect(excluded, { kind: 'person', id: A2, effect: 'exclude' })).profileIds).toEqual([A2]);
  });

  test('choosing a named include removes "everyone" in the composer', () => {
    const everyone = [{ kind: 'everyone' as const, id: null, effect: 'include' as const }];
    expect(termsToDraft(everyone).mode).toBe('all');
    const withCell = toggleInclude(everyone, { kind: 'cell', id: CELL_A, effect: 'include' });
    expect(withCell.some((t) => t.kind === 'everyone')).toBe(false);
    expect(termsToDraft(withCell).mode).toBe('cells');
  });

  test('a contradiction (everyone plus a named kind) is kept and refused, never resolved silently', () => {
    const contradiction = termsToDraft([
      { kind: 'everyone', id: null, effect: 'include' },
      { kind: 'cell', id: CELL_A, effect: 'include' },
    ]);
    expect(contradiction.mode).toBe('all');
    expect(contradiction.cellIds).toEqual([CELL_A]);
    expect(validateAudienceSpec(contradiction, data, admin)).toEqual(['mode_mismatch']);
  });

  test('choosing everyone clears named includes but keeps exclusions', () => {
    let terms = toggleInclude([], { kind: 'cell', id: CELL_A, effect: 'include' });
    terms = toggleInclude(terms, { kind: 'person', id: A2, effect: 'include' });
    terms = flipEffect(terms, { kind: 'person', id: A2, effect: 'include' });
    terms = toggleInclude(terms, { kind: 'everyone', id: null, effect: 'include' });
    expect(terms).toEqual([
      { kind: 'person', id: A2, effect: 'exclude' },
      { kind: 'everyone', id: null, effect: 'include' },
    ]);
  });

  test('a draft round-trips through terms without losing kinds or exclusions', () => {
    const draft = spec({
      mode: 'composite',
      cellIds: [CELL_A],
      groupIds: [GROUP_MIXED],
      profileIds: [B1],
      excludedProfileIds: [A2],
    });
    const back = termsToDraft(draftToTerms(draft));
    expect(back.cellIds).toEqual([CELL_A]);
    expect(back.groupIds).toEqual([GROUP_MIXED]);
    expect(back.profileIds).toEqual([B1]);
    expect(back.excludedProfileIds).toEqual([A2]);
    expect(back.mode).toBe('composite');
  });

  test('RPC arguments send empty kinds as null, and never send recipient ids as authority', () => {
    const args = toCreateSpecArgs(spec({ mode: 'cells', cellIds: [CELL_A, CELL_A] }));
    expect(args).toEqual({
      p_mode: 'cells',
      p_cell_ids: [CELL_A],
      p_group_ids: null,
      p_profile_ids: null,
      p_excluded_cell_ids: null,
      p_excluded_group_ids: null,
      p_excluded_profile_ids: null,
    });
  });

  test('removing a term leaves the rest of the selection intact', () => {
    const terms = [
      { kind: 'cell' as const, id: CELL_A, effect: 'include' as const },
      { kind: 'person' as const, id: A2, effect: 'exclude' as const },
    ];
    expect(removeTerm(terms, { kind: 'person', id: A2, effect: 'exclude' })).toEqual([terms[0]]);
  });
});
