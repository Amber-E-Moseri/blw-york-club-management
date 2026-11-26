// Delivery figures for the Communications page. Pure functions, so the rules are tested without the UI.
//
// Open and click rates use SENT messages as the denominator. A queued or failed message was never delivered, so it
// cannot be opened, and counting it made the rate fall whenever a send failed. When nothing has been sent the rate is
// null, and the UI shows an unavailable marker rather than 0%.
//
// Open tracking is a 1x1 image. Clients that block remote images never report an open, so opens are a lower bound.
// Delivered and bounced are not reported: the send path does not record a verified delivery or bounce, so no figure
// for them is shown as verified.

import type { EmailLog } from '../../types';

export type DeliveryLogLike = Pick<EmailLog, 'status' | 'opened_at' | 'clicked_at'>;

export interface DeliverySummary {
  /** Messages in the loaded window (the fetch returns at most 200, after any status filter). */
  windowSize: number;
  sent: number;
  failed: number;
  /** Sent messages with an open recorded. */
  opened: number;
  /** Sent messages with a click recorded. */
  clicked: number;
  /** Whole-number percent of sent messages opened, or null when nothing was sent. */
  openRate: number | null;
  /** Whole-number percent of sent messages clicked, or null when nothing was sent. */
  clickRate: number | null;
}

function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100);
}

export function summarizeDelivery(logs: readonly DeliveryLogLike[]): DeliverySummary {
  const sentLogs = logs.filter((log) => log.status === 'sent');
  const opened = sentLogs.filter((log) => log.opened_at).length;
  const clicked = sentLogs.filter((log) => log.clicked_at).length;
  const sent = sentLogs.length;
  return {
    windowSize: logs.length,
    sent,
    failed: logs.filter((log) => log.status === 'failed').length,
    opened,
    clicked,
    openRate: percentOf(opened, sent),
    clickRate: percentOf(clicked, sent),
  };
}

/** Display text for a rate: "42%", or an em dash when the rate is unavailable. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}
