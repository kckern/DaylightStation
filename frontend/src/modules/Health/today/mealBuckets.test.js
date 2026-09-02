import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localTodayISO } from './mealBuckets.js';

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
