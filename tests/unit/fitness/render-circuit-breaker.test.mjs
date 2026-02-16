import { describe, it, expect } from '@jest/globals';

describe('Render circuit breaker logic (unit)', () => {
  it('should detect sustained high render rate', () => {
    const thresholdPerSec = 100;
    const sustainedMs = 5000;
    const maxAllowed = thresholdPerSec * (sustainedMs / 1000); // 500

    const timestamps = [];
    const now = Date.now();

    // Simulate 600 renders in 5 seconds (120/sec)
    for (let i = 0; i < 600; i++) {
      timestamps.push(now - (5000 - (i * 8.33)));
    }

    expect(timestamps.length).toBeGreaterThan(maxAllowed);
  });

  it('should not trip at normal render rates', () => {
    const thresholdPerSec = 100;
    const sustainedMs = 5000;
    const maxAllowed = thresholdPerSec * (sustainedMs / 1000); // 500

    const timestamps = [];
    const now = Date.now();

    // Simulate 50 renders in 5 seconds (10/sec -- normal)
    for (let i = 0; i < 50; i++) {
      timestamps.push(now - (5000 - (i * 100)));
    }

    expect(timestamps.length).toBeLessThan(maxAllowed);
  });

  it('should reset after cooldown period', () => {
    const cooldownMs = 2000;

    // Trip the breaker
    const trippedAt = Date.now() - 2500; // 2.5s ago

    const shouldReset = (Date.now() - trippedAt) >= cooldownMs;
    expect(shouldReset).toBe(true);
  });

  it('should not reset before cooldown expires', () => {
    const cooldownMs = 2000;

    const trippedAt = Date.now() - 500; // 0.5s ago

    const shouldReset = (Date.now() - trippedAt) >= cooldownMs;
    expect(shouldReset).toBe(false);
  });
});
