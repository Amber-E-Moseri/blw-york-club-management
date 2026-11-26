// Communications delivery figures (src/lib/email/emailStats.ts). Rates must use sent messages as the denominator, so a
// failed or queued message cannot lower the open rate, and must be unavailable (not 0%) when nothing was sent.
import { formatRate, summarizeDelivery, type DeliveryLogLike } from '../lib/email/emailStats';

const log = (status: DeliveryLogLike['status'], extra: Partial<DeliveryLogLike> = {}): DeliveryLogLike => ({
  status,
  opened_at: null,
  clicked_at: null,
  ...extra,
});

const at = '2026-11-20T14:00:00Z';

describe('open and click rates use sent messages as the denominator', () => {
  it('divides opens by sent messages, not by every row in the window', () => {
    const logs = [
      log('sent', { opened_at: at }),
      log('sent', { opened_at: at }),
      log('sent'),
      log('sent'),
      log('failed'),
      log('failed'),
      log('queued'),
      log('queued'),
    ];
    const s = summarizeDelivery(logs);
    expect(s.sent).toBe(4);
    expect(s.opened).toBe(2);
    expect(s.openRate).toBe(50);
    expect(s.trackingStatus).toBe('recorded-events-only');
    expect(s.deliveryStatus).toBe('unavailable');
  });

  it('does not let failed or queued messages lower the open rate', () => {
    const withoutFailures = summarizeDelivery([log('sent', { opened_at: at }), log('sent')]);
    const withFailures = summarizeDelivery([
      log('sent', { opened_at: at }),
      log('sent'),
      log('failed'),
      log('failed'),
      log('failed'),
      log('queued'),
    ]);
    expect(withoutFailures.openRate).toBe(50);
    expect(withFailures.openRate).toBe(withoutFailures.openRate);
  });

  it('counts clicks against sent messages too', () => {
    const s = summarizeDelivery([
      log('sent', { clicked_at: at }),
      log('sent'),
      log('sent'),
      log('sent'),
      log('failed'),
    ]);
    expect(s.clicked).toBe(1);
    expect(s.clickRate).toBe(25);
  });

  it('ignores an open recorded on a message that was not sent', () => {
    const s = summarizeDelivery([log('failed', { opened_at: at }), log('sent')]);
    expect(s.opened).toBe(0);
    expect(s.openRate).toBe(0);
  });

  it('rounds to a whole percent', () => {
    const s = summarizeDelivery([log('sent', { opened_at: at }), log('sent'), log('sent')]);
    expect(s.openRate).toBe(33);
  });
});

describe('rates are unavailable when nothing was sent', () => {
  it('returns null rates with no sent messages, and shows a dash rather than 0%', () => {
    const s = summarizeDelivery([log('failed'), log('queued')]);
    expect(s.sent).toBe(0);
    expect(s.openRate).toBeNull();
    expect(s.clickRate).toBeNull();
    expect(s.trackingStatus).toBe('unavailable');
    expect(formatRate(s.openRate)).toBe('—');
    expect(formatRate(s.clickRate)).toBe('—');
  });

  it('returns null rates for an empty window', () => {
    const s = summarizeDelivery([]);
    expect(s.windowSize).toBe(0);
    expect(s.openRate).toBeNull();
    expect(formatRate(s.openRate)).toBe('—');
  });

  it('shows a real 0% when messages were sent and none were opened', () => {
    const s = summarizeDelivery([log('sent'), log('sent')]);
    expect(s.openRate).toBe(0);
    expect(formatRate(s.openRate)).toBe('0%');
  });
});

describe('window size and counts', () => {
  it('reports the whole loaded window and the failed count separately', () => {
    const s = summarizeDelivery([log('sent'), log('failed'), log('queued'), log('bounced')]);
    expect(s.windowSize).toBe(4);
    expect(s.sent).toBe(1);
    expect(s.failed).toBe(1);
  });
});
