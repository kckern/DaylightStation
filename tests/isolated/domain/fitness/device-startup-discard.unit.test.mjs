import { describe, it, expect, vi } from 'vitest';

describe('device startup HR discard', () => {
  const STARTUP_DISCARD_COUNT = 3; // Discard first 3 HR readings per device

  function shouldDiscardHr(deviceId, sampleCountMap) {
    const count = sampleCountMap.get(deviceId) || 0;
    sampleCountMap.set(deviceId, count + 1);
    return count < STARTUP_DISCARD_COUNT;
  }

  it('should discard first 3 HR readings from a device', () => {
    const counts = new Map();
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 1st
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 2nd
    expect(shouldDiscardHr('28676', counts)).toBe(true);  // 3rd
    expect(shouldDiscardHr('28676', counts)).toBe(false); // 4th — accept
  });

  it('should track counts per device independently', () => {
    const counts = new Map();
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28688', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28688', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(true);
    expect(shouldDiscardHr('28676', counts)).toBe(false); // 28676 past threshold
    expect(shouldDiscardHr('28688', counts)).toBe(true);  // 28688 still discarding
    expect(shouldDiscardHr('28688', counts)).toBe(false);  // 28688 past threshold
  });
});
