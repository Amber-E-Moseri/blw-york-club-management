// Event notification routing. These rules stop a targeted or invalid event from reaching every active member.
// The edge function uses the same module (supabase/functions/_shared/audience-recipients.ts).
import fs from 'fs';
import path from 'path';
import { AudienceRouteError, routeEventAudience } from '../../supabase/functions/_shared/audience-recipients';

const base = { id: 'event-1', audience_meeting_id: null as string | null };

describe('event notification routing (fails closed)', () => {
  test('spec-less "all" is the only fellowship-wide broadcast', () => {
    expect(routeEventAudience({ ...base, audience: 'all', audience_spec_id: null })).toEqual({ kind: 'broadcast' });
  });

  test('a spec always governs, whatever the legacy audience column says', () => {
    for (const audience of ['all', 'meeting', 'cells', 'saved_groups', 'explicit']) {
      expect(routeEventAudience({ ...base, audience, audience_spec_id: 'spec-1' })).toEqual({
        kind: 'targeted',
        contentId: 'event-1',
      });
    }
  });

  test('spec-less "meeting" uses that meeting\'s attendance', () => {
    expect(routeEventAudience({ ...base, audience: 'meeting', audience_spec_id: null, audience_meeting_id: 'm-1' })).toEqual({
      kind: 'meeting',
      meetingId: 'm-1',
    });
  });

  test('spec-less "meeting" with no meeting is refused, not broadcast', () => {
    expect(() => routeEventAudience({ ...base, audience: 'meeting', audience_spec_id: null })).toThrow(AudienceRouteError);
  });

  test.each(['cells', 'saved_groups', 'explicit'])('targeted kind "%s" with no spec is refused, not broadcast', (audience) => {
    expect(() => routeEventAudience({ ...base, audience, audience_spec_id: null })).toThrow(AudienceRouteError);
  });

  test.each(['', 'everyone', 'ALL', 'public', 'unknown'])('unrecognised audience "%s" is refused', (audience) => {
    expect(() => routeEventAudience({ ...base, audience, audience_spec_id: null })).toThrow(AudienceRouteError);
  });

  test('the refusal message says why, and never says the event was sent', () => {
    try {
      routeEventAudience({ ...base, audience: 'cells', audience_spec_id: null });
      throw new Error('expected refusal');
    } catch (e) {
      expect((e as Error).message).toMatch(/Not sent/);
    }
  });
});

describe('notify-event uses the router and the frozen snapshot, and keeps no broadcast fallback', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'supabase', 'functions', 'notify-event', 'index.ts'),
    'utf8',
  );

  test('imports the router and reads targeted recipients from the snapshot RPC', () => {
    expect(source).toMatch(/import \{ routeEventAudience \} from '\.\.\/_shared\/audience-recipients\.ts'/);
    expect(source).toMatch(/rpc\('audience_content_recipients'/);
  });

  test('the old "every other audience is everyone" branch is gone', () => {
    // The previous code fell through to "every active profile" for any audience other than 'meeting'.
    expect(source).not.toMatch(/event\.audience === 'meeting'/);
    expect(source).toMatch(/route\.kind === 'targeted'/);
  });
});
