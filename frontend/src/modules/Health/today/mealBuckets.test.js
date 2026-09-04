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

describe('one hour policy for every entry point', () => {
  it.each([[0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'],
    [16, 'afternoon'], [17, 'evening'], [20, 'evening'], [21, 'night'], [23, 'night']])(
    'hour %i -> %s', (hour, expected) => expect(bucketForHour(hour)).toBe(expected),
  );
  it.each(Array.from({ length: 24 }, (_, i) => i))('current hour %i uses the shared policy', hour => {
    expect(currentMealBucketId(new Date(2026, 0, 1, hour))).toBe(bucketForHour(hour));
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
