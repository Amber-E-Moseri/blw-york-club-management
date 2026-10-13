import {
  allowedModes,
  deliveryLabel,
  emptySelection,
  messageStatusFor,
  newIdempotencyKey,
  selectionProblem,
  toSendArgs,
  validateDraft,
  type DraftInput,
} from '../lib/communications/messaging';

const OWN_CELL = 'cell-a';
const OTHER_CELL = 'cell-b';

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    subject: 'Prayer night',
    body: 'Join us Thursday.',
    selection: emptySelection('all'),
    channels: ['inbox'],
    ...overrides,
  };
}

describe('who may pick which audience (UX gate; the database re-checks)', () => {
  test('admin and coordinator may use every mode', () => {
    expect(allowedModes('admin')).toEqual(['all', 'cells', 'saved_groups', 'explicit']);
    expect(allowedModes('coordinator')).toEqual(['all', 'cells', 'saved_groups', 'explicit']);
  });

  test('cell leader may use only cells', () => {
    expect(allowedModes('cell_leader', OWN_CELL)).toEqual(['cells']);
  });

  test('a cell leader with no cell has no audience at all', () => {
    expect(allowedModes('cell_leader')).toEqual([]);
  });

  test('members cannot compose', () => {
    expect(allowedModes('member', OWN_CELL)).toEqual([]);
  });
});

describe('cell-leader scope', () => {
  test('leader sends within their own cell', () => {
    expect(selectionProblem('cell_leader', OWN_CELL, { ...emptySelection('cells'), cellIds: [OWN_CELL] })).toBeNull();
  });

  test('leader cannot pick another cell', () => {
    expect(selectionProblem('cell_leader', OWN_CELL, { ...emptySelection('cells'), cellIds: [OTHER_CELL] })).toBe(
      'Cell leaders can message only their own cell.',
    );
  });

  test('leader cannot add a second cell alongside their own', () => {
    expect(selectionProblem('cell_leader', OWN_CELL, { ...emptySelection('cells'), cellIds: [OWN_CELL, OTHER_CELL] })).toBe(
      'Cell leaders can message only their own cell.',
    );
  });

  test('leader cannot switch to everyone', () => {
    expect(selectionProblem('cell_leader', OWN_CELL, emptySelection('all'))).toBe('You cannot send to this audience.');
  });

  test('staff may pick any cell combination', () => {
    expect(selectionProblem('admin', undefined, { ...emptySelection('cells'), cellIds: [OWN_CELL, OTHER_CELL] })).toBeNull();
  });
});

describe('request shape sent to send_message', () => {
  test('inbox is always included, and channels are deduplicated', () => {
    const args = toSendArgs(draft({ channels: ['email', 'email'] }), 'key-1');
    expect(args.p_channels).toEqual(['inbox', 'email']);
  });

  test('only the id list for the chosen mode is populated', () => {
    const args = toSendArgs(
      draft({ selection: { mode: 'explicit', cellIds: [OWN_CELL], groupIds: ['g1'], profileIds: ['p1', 'p2'] } }),
      'key-2',
    );
    expect(args.p_mode).toBe('explicit');
    expect(args.p_cell_ids).toEqual([]);
    expect(args.p_group_ids).toEqual([]);
    expect(args.p_profile_ids).toEqual(['p1', 'p2']);
  });

  test('subject and body are trimmed and the idempotency key is carried through', () => {
    const args = toSendArgs(draft({ subject: '  Hi  ', body: '  Body  ' }), 'key-3');
    expect(args.p_subject).toBe('Hi');
    expect(args.p_body).toBe('Body');
    expect(args.p_idempotency_key).toBe('key-3');
  });
});

describe('draft validation', () => {
  test('a complete draft has no errors', () => {
    expect(validateDraft(draft())).toEqual({});
  });

  test('blank subject and body are rejected', () => {
    expect(validateDraft(draft({ subject: '   ', body: '' }))).toEqual({
      subject: 'Add a subject.',
      body: 'Write a message.',
    });
  });

  test('a subject over 200 characters is rejected', () => {
    expect(validateDraft(draft({ subject: 'x'.repeat(201) })).subject).toMatch(/under 200/);
  });
});

describe('delivery labels never claim delivery the system cannot prove', () => {
  test('inbox stored reads as in the member inbox', () => {
    expect(deliveryLabel('inbox', 'stored')).toBe('Inbox: in member inbox');
  });

  test('accepted reads as accepted by the relay or push service, not delivered', () => {
    expect(deliveryLabel('email', 'accepted')).toBe('Email: accepted by mail relay');
    expect(deliveryLabel('push', 'accepted')).toBe('Push: accepted by push service');
    expect(deliveryLabel('email', 'accepted')).not.toMatch(/deliver/i);
  });

  test('a failure carries its reason', () => {
    expect(deliveryLabel('email', 'failed', 'EMAIL_PROVIDER_NOT_CONFIGURED')).toBe(
      'Email: failed (EMAIL_PROVIDER_NOT_CONFIGURED)',
    );
  });

  test('a skip explains why', () => {
    expect(deliveryLabel('email', 'skipped', 'opt-out-all')).toBe('Email: skipped (opt-out-all)');
  });
});

describe('message status summary', () => {
  test('stored inbox rows alone are complete, not delivered', () => {
    expect(messageStatusFor(['stored', 'stored'])).toBe('complete');
  });

  test('anything waiting keeps the message sending', () => {
    expect(messageStatusFor(['stored', 'pending'])).toBe('sending');
    expect(messageStatusFor(['stored', 'sending'])).toBe('sending');
  });

  test('a failure alongside successes is partial', () => {
    expect(messageStatusFor(['accepted', 'failed'])).toBe('partially_failed');
  });

  test('all external attempts failed is failed', () => {
    expect(messageStatusFor(['failed', 'failed'])).toBe('failed');
  });

  test('skipped rows never count as failures', () => {
    expect(messageStatusFor(['stored', 'skipped'])).toBe('complete');
  });
});

describe('idempotency key', () => {
  test('is a UUID v4 shape', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('two calls give different keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
