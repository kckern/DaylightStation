import { describe, it, expect } from 'vitest';
import { shouldMarkRejoin, hasHeartRateData } from './chartCache.js';

describe('shouldMarkRejoin', () => {
  it('marks a real dropout: inactive right after the last seen tick', () => {
    const prev = { lastSeenTick: 4, lastValue: 10, isActive: false };
    const next = { active: [true, true, true, true, true, false, false, true, true] };
    expect(shouldMarkRejoin(prev, next)).toBe(true);
  });

  it('does not mark a stint that was moved back continuously (no inactive tick)', () => {
    const prev = { lastSeenTick: 4, lastValue: 10, isActive: false };
    const next = { active: [true, true, true, true, true, true, true, true, true] };
    expect(shouldMarkRejoin(prev, next)).toBe(false);
  });

  it('never marks without a previous sighting', () => {
    expect(shouldMarkRejoin(null, { active: [true] })).toBe(false);
    expect(shouldMarkRejoin({ lastSeenTick: -1, lastValue: null }, { active: [true] })).toBe(false);
  });
});

describe('hasHeartRateData', () => {
  it('is false once a person\'s stint was moved away (all HR cells null)', () => {
    const series = { a: [null, null, null], b: [null, 120, 121] };
    const getSeries = (id) => series[id] || [];
    expect(hasHeartRateData(getSeries, 'a')).toBe(false);
    expect(hasHeartRateData(getSeries, 'b')).toBe(true);
    expect(hasHeartRateData(getSeries, 'missing')).toBe(false);
  });
  it('treats a missing getter as "unknown → keep"', () => {
    expect(hasHeartRateData(null, 'a')).toBe(true);
  });
});
