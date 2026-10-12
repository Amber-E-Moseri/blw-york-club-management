import {
  PUSH_PROMPT_DISMISSED_KEY,
  PUSH_PROMPT_SNOOZE_MS,
  PUSH_PROMPT_SNOOZED_UNTIL_KEY,
  dismissPushPromptForever,
  readPushPromptState,
  shouldShowPushPrompt,
  snoozePushPrompt,
} from '../lib/pushPrompt';

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

const base = {
  supported: true,
  permission: 'default' as NotificationPermission,
  hasSubscription: false,
  dismissedForever: false,
  snoozedUntil: null as number | null,
  now: NOW,
};

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('shouldShowPushPrompt', () => {
  it('shows the prompt for a supported browser that has not decided yet', () => {
    expect(shouldShowPushPrompt(base)).toBe(true);
  });

  it('never shows when notifications are unsupported', () => {
    expect(shouldShowPushPrompt({ ...base, supported: false })).toBe(false);
  });

  it('never shows once permission is denied, so a denied browser is not prompted repeatedly', () => {
    expect(shouldShowPushPrompt({ ...base, permission: 'denied' })).toBe(false);
  });

  it('never shows once permission is granted', () => {
    expect(shouldShowPushPrompt({ ...base, permission: 'granted' })).toBe(false);
  });

  it('respects an existing push subscription', () => {
    expect(shouldShowPushPrompt({ ...base, hasSubscription: true })).toBe(false);
  });

  it('respects "Don\'t ask again"', () => {
    expect(shouldShowPushPrompt({ ...base, dismissedForever: true })).toBe(false);
  });

  it('is suppressed while the seven-day snooze is active', () => {
    expect(shouldShowPushPrompt({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
  });

  it('shows again once the snooze has expired', () => {
    expect(shouldShowPushPrompt({ ...base, snoozedUntil: NOW - 1 })).toBe(true);
  });
});

describe('snooze and dismiss state', () => {
  it('"Maybe Later" stores a seven-day snooze', () => {
    const storage = new MemoryStorage();
    snoozePushPrompt(storage, NOW);
    const state = readPushPromptState(storage);
    expect(state.snoozedUntil).toBe(NOW + PUSH_PROMPT_SNOOZE_MS);
    expect(PUSH_PROMPT_SNOOZE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(shouldShowPushPrompt({ ...base, ...state, now: NOW + 6 * 24 * 60 * 60 * 1000 })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, ...state, now: NOW + 8 * 24 * 60 * 60 * 1000 })).toBe(true);
  });

  it('"Don\'t ask again" stores a permanent dismissal', () => {
    const storage = new MemoryStorage();
    dismissPushPromptForever(storage);
    expect(storage.getItem(PUSH_PROMPT_DISMISSED_KEY)).toBe('true');
    expect(readPushPromptState(storage).dismissedForever).toBe(true);
  });

  it('ignores a corrupt snooze value rather than suppressing the prompt', () => {
    const storage = new MemoryStorage();
    storage.setItem(PUSH_PROMPT_SNOOZED_UNTIL_KEY, 'not-a-number');
    expect(readPushPromptState(storage).snoozedUntil).toBeNull();
  });

  it('falls back to showing the prompt when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readPushPromptState(blocked)).toEqual({ dismissedForever: false, snoozedUntil: null });
    expect(() => snoozePushPrompt(blocked, NOW)).not.toThrow();
    expect(() => dismissPushPromptForever(blocked)).not.toThrow();
  });
});
