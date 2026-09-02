import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
const { FitnessSession } = await import('./FitnessSession.js');

/**
 * Regression: a v3 session carries its window as `session.start`/`session.end`
 * wall-clock strings — `dehydrateSessionRecord` only writes numeric
 * startTime/endTime for PRE-v3 records. Hydration read only the numeric field
 * and silently fell back to `now`, so every v3 resume rebased the session to
 * the reload moment. Session 20260901154746 ended up claiming a 20-minute
 * window over a 94-minute workout, with every pre-reload tick gone.
 */
describe('FitnessSession resume — v3 session window', () => {
  // The resume path pads the gap between the session's end and NOW, and
  // padWithNulls prunes the head once the series grows past its window. Left on
  // the real clock these tests pass in the morning and fail by evening, because
  // the gap keeps growing against a fixed fixture. Pin the clock just after the
  // session ends so the gap is the small, intended one.
  afterEach(() => { vi.useRealTimers(); });
  const pinClockJustAfterSession = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T17:22:00.000'));
  };
  const v3 = (startStr, endStr) => ({
    sessionId: '20260901154746',
    version: 3,
    session: { id: '20260901154746', start: startStr, end: endStr, duration_seconds: 5613 },
    timeline: { series: { 'user_3:rings': [1, 2, 3] }, tick_count: 3, events: [] },
  });

  it('takes its start from session.start rather than the reload moment', () => {
    const s = new FitnessSession();
    const expected = new Date('2026-09-01T15:47:46.102').getTime();
    s._hydrateFromSession(v3('2026-09-01 15:47:46.102', '2026-09-01 17:21:16.000'));
    expect(s.startTime).toBe(expected);
  });

  it('does not rebase to now — the whole point of the fix', () => {
    const s = new FitnessSession();
    const before = Date.now();
    s._hydrateFromSession(v3('2026-09-01 15:47:46.102', '2026-09-01 17:21:16.000'));
    // `now` would be within a few ms of `before`; the real start is hours off.
    expect(Math.abs(s.startTime - before)).toBeGreaterThan(60_000);
  });

  it('still honours a numeric startTime when a pre-v3 record supplies one', () => {
    const s = new FitnessSession();
    s._hydrateFromSession({ sessionId: 'fs_1', startTime: 1_700_000_000_000, timeline: {} });
    expect(s.startTime).toBe(1_700_000_000_000);
  });

  it('falls back to now only when neither form is present', () => {
    const s = new FitnessSession();
    const before = Date.now();
    s._hydrateFromSession({ sessionId: 'fs_2', timeline: {} });
    expect(s.startTime).toBeGreaterThanOrEqual(before);
  });

  it('restores the saved ticks rather than starting the count over', () => {
    pinClockJustAfterSession();
    const s = new FitnessSession();
    s._hydrateFromSession(v3('2026-09-01 15:47:46.102', '2026-09-01 17:21:16.000'));
    // The tail is null padding for the gap since the session's real end; what
    // matters is that the pre-reload values survived rather than being dropped.
    expect(s.timeline.series['user_3:rings'].slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('measures the resume gap from session.end, not from the start', () => {
    // With no numeric endTime, the old code fell back to startTime + 0 and
    // padded the gap as if the session had never run.
    pinClockJustAfterSession();
    const s = new FitnessSession();
    s._hydrateFromSession(v3('2026-09-01 15:47:46.102', '2026-09-01 17:21:16.000'));
    const paddedTo = s.timeline.series['user_3:rings'].length;
    const fromEnd = Math.floor((Date.now() - new Date('2026-09-01T17:21:16.000').getTime()) / 5000);
    expect(Math.abs(paddedTo - (3 + fromEnd))).toBeLessThanOrEqual(2);
  });
});
