/**
 * The day-key validator every health route now shares.
 *
 * NOT colocated with its module, deliberately. `isoDate.mjs` lives in
 * `shared/contracts/health/` because that is the one place the API layer, the
 * application layer AND the domain layer may all import from — `api-no-domains`
 * refuses a 4_api -> 2_domains import outright. But `shared/` is not one of
 * gate-vitest's ROOTS (`tests/unit`, `tests/isolated`, `backend`, `frontend`),
 * so a test beside the module would silently never run. This tree is scanned.
 *
 * The two cases that matter are the two a bare regex gets wrong, and both were
 * paid for before: "2026-08-32" (Invalid Date -> a later toISOString throws a
 * RangeError, surfacing as a 500 instead of the 400 the input deserves) and
 * "2026-02-31" (parses fine, then silently becomes March 3 — food lands on a
 * day nobody named).
 */
import { describe, it, expect } from 'vitest';
import { isISODate, localDateISO, defaultBucketForDate } from '#shared/contracts/health/isoDate.mjs';

const bucketForHour = (h) => (h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night');

describe('isISODate', () => {
  it('accepts a real calendar day', () => {
    expect(isISODate('2026-09-03')).toBe(true);
    expect(isISODate('2028-02-29')).toBe(true); // 2028 is a leap year
    expect(isISODate('2026-12-31')).toBe(true);
  });

  it('refuses a day number no month has — the RangeError shape', () => {
    expect(isISODate('2026-08-32')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
  });

  it('refuses a day that would silently normalize into the next month', () => {
    expect(isISODate('2026-02-31')).toBe(false);
    expect(isISODate('2026-02-29')).toBe(false); // 2026 is NOT a leap year
    expect(isISODate('2026-04-31')).toBe(false);
  });

  it('refuses anything that is not a YYYY-MM-DD string', () => {
    for (const v of ['', '2026-9-3', '03/09/2026', '2026-09-03T00:00:00Z', 'today', null, undefined, 20260903, {}, ['2026-09-03']]) {
      expect(isISODate(v)).toBe(false);
    }
  });
});

describe('localDateISO', () => {
  // Built from LOCAL components so the assertion means the same thing in any
  // process timezone — the point is that the reader is local, not that the
  // runner happens to sit at UTC-7.
  it('reads the LOCAL calendar day', () => {
    expect(localDateISO(new Date(2026, 8, 2, 20, 30))).toBe('2026-09-02');
    expect(localDateISO(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('disagrees with the naive UTC read whenever local midnight has not been crossed in UTC', () => {
    const lateEvening = new Date(2026, 8, 2, 23, 30);
    const utcRead = lateEvening.toISOString().slice(0, 10);
    // Only meaningful where the process sits behind UTC (the household's case).
    if (lateEvening.getTimezoneOffset() > 0) {
      expect(utcRead).toBe('2026-09-03');
      expect(localDateISO(lateEvening)).toBe('2026-09-02');
    } else {
      expect(localDateISO(lateEvening)).toBe('2026-09-02');
    }
  });
});

describe('defaultBucketForDate', () => {
  const now = new Date('2026-09-03T20:30:00-07:00'); // local 8:30pm -> 'night'

  it('on TODAY, the clock names the meal', () => {
    expect(defaultBucketForDate(localDateISO(now), now, bucketForHour)).toBe('night');
  });

  it('on any other day the clock is silent, and the day is filled from its first meal', () => {
    expect(defaultBucketForDate('2026-09-02', now, bucketForHour)).toBe('morning');
    expect(defaultBucketForDate('2026-09-04', now, bucketForHour)).toBe('morning');
  });
});
