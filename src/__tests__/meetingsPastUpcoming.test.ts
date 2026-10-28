// Upcoming and Past meeting lists, checked against the filters and ordering they send. The Supabase client is the recorder.
import { fetchMeetings } from '../lib/queries/meetings';
import { pinClock } from '../testUtils/localClock';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fake = require('../testUtils/supabaseRecorder').__fake as {
  log: Array<{ target: string; op: string; args: unknown[] }>;
  reset: () => void;
};

// Local 21:30 on 27 Oct 2026. In Toronto the UTC date is already the 28th, which the old code got wrong.
const pinnedNow = () => new Date(2026, 9, 27, 21, 30);
pinClock(pinnedNow);

beforeEach(() => {
  fake.reset();
  jest.setSystemTime(pinnedNow());
});

const callsFor = (op: string) => fake.log.filter((call) => call.target === 'meetings' && call.op === op).map((call) => call.args);

describe('Upcoming list', () => {
  test('includes meetings dated today, soonest first', async () => {
    await fetchMeetings(true);

    expect(callsFor('gte')).toContainEqual(['date', '2026-10-27']);
    expect(callsFor('order')).toEqual([
      ['date', { ascending: true }],
      ['time', { ascending: true }],
    ]);
  });
});

describe('Past list', () => {
  test('only asks for dates before today', async () => {
    await fetchMeetings(false);

    expect(callsFor('lt')).toContainEqual(['date', '2026-10-27']);
    expect(callsFor('gte').filter((args) => args[0] === 'date')).toEqual([]);
  });

  test('is ordered newest first', async () => {
    await fetchMeetings(false);

    expect(callsFor('order')).toEqual([
      ['date', { ascending: false }],
      ['time', { ascending: false }],
    ]);
  });

  test('moves to the new month on the first local day', async () => {
    jest.setSystemTime(new Date(2026, 10, 1, 0, 30));

    await fetchMeetings(false);

    expect(callsFor('lt')).toContainEqual(['date', '2026-11-01']);
  });
});
