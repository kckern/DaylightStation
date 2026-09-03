import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localTodayISO, bucketForHour, currentMealBucketId, bucketLabel } from './mealBuckets.js';

describe('localTodayISO', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the LOCAL date, not the UTC date, from a fixed Date instance', () => {
    // 2026-09-02T20:30:00-07:00 is 2026-09-03T03:30:00Z — toISOString().slice(0,10)
    // would (wrongly) say "2026-09-03". Local date components say "2026-09-02".
    const evening = new Date('2026-09-02T20:30:00-07:00');
    expect(evening.toISOString().slice(0, 10)).toBe('2026-09-03'); // sanity check on the bug this guards against
    expect(localTodayISO(evening)).toBe('2026-09-02');
  });

  it('defaults to the current system time when called with no argument', () => {
    beforeSystemTime('2026-01-05T12:00:00');
    expect(localTodayISO()).toBe('2026-01-05');
  });
});

function beforeSystemTime(iso) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

// Pins `bucketForHour` to SavedMealsService's thresholds
// (<11 morning / <15 afternoon / <20 evening / else night) at every
// boundary hour — this is the test that stops a THIRD hour->meal mapping
// drifting in alongside `getMealTimeFromHour` (backend) and
// `currentMealBucketId` (this file, mirrors getMealTimeFromHour). See the
// divergence comment on `bucketForHour` in mealBuckets.js.
describe('bucketForHour — matches SavedMealsService, NOT getMealTimeFromHour', () => {
  it.each([
    [0, 'morning'],
    [10, 'morning'],  // last morning hour
    [11, 'afternoon'], // first afternoon hour
    [14, 'afternoon'], // last afternoon hour
    [15, 'evening'],   // first evening hour
    [19, 'evening'],   // last evening hour
    [20, 'night'],     // first night hour
    [23, 'night'],
  ])('hour %i -> %s', (hour, expected) => {
    expect(bucketForHour(hour)).toBe(expected);
  });

  it('diverges from currentMealBucketId (getMealTimeFromHour) at hour 11 and hour 20 by design', () => {
    // Hour 11: getMealTimeFromHour says morning (5-12), SavedMealsService
    // says afternoon (<11 is morning, so 11 is already afternoon).
    expect(currentMealBucketId(new Date(2026, 0, 1, 11))).toBe('morning');
    expect(bucketForHour(11)).toBe('afternoon');
    // Hour 20: getMealTimeFromHour says evening (17-21), SavedMealsService
    // says night (<20 is evening, so 20 is already night).
    expect(currentMealBucketId(new Date(2026, 0, 1, 20))).toBe('evening');
    expect(bucketForHour(20)).toBe('night');
  });
});

describe('bucketLabel', () => {
  it('maps every known bucket id to its display label', () => {
    expect(bucketLabel('morning')).toBe('Breakfast');
    expect(bucketLabel('afternoon')).toBe('Lunch');
    expect(bucketLabel('evening')).toBe('Dinner');
    expect(bucketLabel('night')).toBe('Snacks');
  });

  it('falls back to the raw id for an unknown bucket rather than rendering blank', () => {
    expect(bucketLabel('bogus')).toBe('bogus');
  });
});
