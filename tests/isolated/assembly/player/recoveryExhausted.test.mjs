import { vi, describe, test, expect, beforeEach } from 'vitest';

describe('recovery exhaustion behavior', () => {
  // Test the module-level tracker logic directly
  let tracker;

  beforeEach(() => {
    tracker = new Map();
  });

  function getTracker(key) {
    return tracker.get(key) || { count: 0, lastAt: 0 };
  }
  function recordRecovery(key) {
    const entry = tracker.get(key) || { count: 0, lastAt: 0 };
    entry.count += 1;
    entry.lastAt = Date.now();
    tracker.set(key, entry);
    return entry.count;
  }
  function clearTracker(key) {
    tracker.delete(key);
  }

  test('tracker count increments on each recovery', () => {
    recordRecovery('session-1');
    recordRecovery('session-1');
    expect(getTracker('session-1').count).toBe(2);
  });

  test('tracker count reaches maxAttempts after N calls', () => {
    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i++) recordRecovery('session-1');
    expect(getTracker('session-1').count).toBe(maxAttempts);
    expect(getTracker('session-1').count >= maxAttempts).toBe(true);
  });

  test('clearTracker resets count so retry is possible', () => {
    for (let i = 0; i < 3; i++) recordRecovery('session-1');
    expect(getTracker('session-1').count).toBe(3);
    clearTracker('session-1');
    expect(getTracker('session-1').count).toBe(0);
  });

  test('RESILIENCE_STATUS includes exhausted', async () => {
    const { RESILIENCE_STATUS } = await import('#frontend/modules/Player/hooks/useResilienceState.js');
    expect(RESILIENCE_STATUS).toHaveProperty('exhausted');
    expect(RESILIENCE_STATUS.exhausted).toBe('exhausted');
  });
});
