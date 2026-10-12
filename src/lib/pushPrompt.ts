/**
 * Rules for when the "Stay Updated" notification prompt may appear. Kept free of React so it can be unit tested.
 *
 * The prompt never requests browser permission by itself. Permission is requested only when the user taps
 * "Enable Notifications" (see usePushNotifications.subscribe). Here we only decide whether to show the prompt.
 */

export const PUSH_PROMPT_DISMISSED_KEY = 'push_prompt_dismissed';
export const PUSH_PROMPT_SNOOZED_UNTIL_KEY = 'push_prompt_snoozed_until';
export const PUSH_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PushPromptInput {
  /** Notifications and service workers are available in this browser. */
  supported: boolean;
  /** Current browser permission. Anything other than 'default' means the user already decided. */
  permission: NotificationPermission;
  /** This browser already has an active push subscription. */
  hasSubscription: boolean;
  /** The user chose "Don't ask again". */
  dismissedForever: boolean;
  /** Epoch ms until which "Maybe Later" suppresses the prompt, or null. */
  snoozedUntil: number | null;
  now: number;
}

export function shouldShowPushPrompt(input: PushPromptInput): boolean {
  if (!input.supported) return false;
  // 'granted' and 'denied' are decisions already made. A denied browser is never prompted again.
  if (input.permission !== 'default') return false;
  if (input.hasSubscription) return false;
  if (input.dismissedForever) return false;
  if (input.snoozedUntil !== null && input.now < input.snoozedUntil) return false;
  return true;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads the prompt state. Storage can be blocked (private browsing), in which case nothing is remembered. */
export function readPushPromptState(storage: StorageLike | null): { dismissedForever: boolean; snoozedUntil: number | null } {
  try {
    const dismissedForever = storage?.getItem(PUSH_PROMPT_DISMISSED_KEY) === 'true';
    const raw = storage?.getItem(PUSH_PROMPT_SNOOZED_UNTIL_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return { dismissedForever, snoozedUntil: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return { dismissedForever: false, snoozedUntil: null };
  }
}

/** "Maybe Later": hide the prompt for seven days. */
export function snoozePushPrompt(storage: StorageLike | null, now: number): void {
  try {
    storage?.setItem(PUSH_PROMPT_SNOOZED_UNTIL_KEY, String(now + PUSH_PROMPT_SNOOZE_MS));
  } catch {
    // Storage blocked: the prompt may reappear on the next load. Nothing else is affected.
  }
}

/** "Don't ask again": hide the prompt permanently in this browser. */
export function dismissPushPromptForever(storage: StorageLike | null): void {
  try {
    storage?.setItem(PUSH_PROMPT_DISMISSED_KEY, 'true');
  } catch {
    // As above.
  }
}
