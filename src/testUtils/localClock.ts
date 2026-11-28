// Pins the clock for the tests in one file and restores the real clock afterwards.
// `now` is a factory so the Date is built inside the test run rather than at import time.
// The process time zone cannot be changed here: Jest's sandbox copies process.env, so assigning TZ inside a test
// does not reach the real process. Run the suites under the zone you want to check (for example TZ=UTC or TZ=America/Toronto).
export function pinClock(now: () => Date): void {
  beforeAll(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(now());
  });

  afterAll(() => {
    jest.useRealTimers();
  });
}
