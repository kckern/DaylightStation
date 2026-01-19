import { jest } from '@jest/globals';

describe('VoiceMemoOverlay stale state cooldown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should not reset stale state within 500ms cooldown period', () => {
    const STALE_STATE_COOLDOWN_MS = 500;
    // Initialize to -Infinity to allow first reset at any time
    let lastResetTime = -Infinity;

    const shouldResetStaleState = (now) => {
      if (now - lastResetTime < STALE_STATE_COOLDOWN_MS) {
        return false;
      }
      lastResetTime = now;
      return true;
    };

    // First call should always succeed (no cooldown yet)
    expect(shouldResetStaleState(0)).toBe(true);
    // Calls within 500ms should be blocked
    expect(shouldResetStaleState(100)).toBe(false);
    expect(shouldResetStaleState(400)).toBe(false);
    // Call at 600ms (600ms after first reset at 0) should succeed
    expect(shouldResetStaleState(600)).toBe(true);
    // Calls within 500ms of last reset (600) should be blocked
    expect(shouldResetStaleState(700)).toBe(false);
    expect(shouldResetStaleState(1000)).toBe(false);
    // Call at 1100ms (500ms after reset at 600) should succeed
    expect(shouldResetStaleState(1100)).toBe(true);
  });

  test('should track reset count and log warning after 3 resets in 5 seconds', () => {
    const STALE_STATE_COOLDOWN_MS = 500;
    const WARNING_WINDOW_MS = 5000;
    const WARNING_THRESHOLD = 3;

    // Initialize to -Infinity to allow first reset at any time
    let lastResetTime = -Infinity;
    let resetTimes = [];
    let warningLogged = false;

    const shouldResetStaleState = (now) => {
      if (now - lastResetTime < STALE_STATE_COOLDOWN_MS) {
        return false;
      }
      resetTimes = resetTimes.filter(t => now - t < WARNING_WINDOW_MS);
      resetTimes.push(now);
      if (resetTimes.length >= WARNING_THRESHOLD) {
        warningLogged = true;
      }
      lastResetTime = now;
      return true;
    };

    // Three resets within 5 seconds should trigger warning
    shouldResetStaleState(0);     // 1st reset
    shouldResetStaleState(600);   // 2nd reset (600ms > 500ms cooldown)
    shouldResetStaleState(1200);  // 3rd reset (1200ms - 600ms = 600ms > 500ms cooldown)

    expect(warningLogged).toBe(true);
    expect(resetTimes.length).toBe(3);
  });

  test('should not warn when resets are spread over more than 5 seconds', () => {
    const STALE_STATE_COOLDOWN_MS = 500;
    const WARNING_WINDOW_MS = 5000;
    const WARNING_THRESHOLD = 3;

    let lastResetTime = -Infinity;
    let resetTimes = [];
    let warningLogged = false;

    const shouldResetStaleState = (now) => {
      if (now - lastResetTime < STALE_STATE_COOLDOWN_MS) {
        return false;
      }
      resetTimes = resetTimes.filter(t => now - t < WARNING_WINDOW_MS);
      resetTimes.push(now);
      if (resetTimes.length >= WARNING_THRESHOLD) {
        warningLogged = true;
      }
      lastResetTime = now;
      return true;
    };

    // Resets spread over more than 5 seconds should not trigger warning
    shouldResetStaleState(0);      // 1st reset
    shouldResetStaleState(3000);   // 2nd reset
    shouldResetStaleState(6000);   // 3rd reset - but 1st is now outside 5s window

    expect(warningLogged).toBe(false);
    expect(resetTimes.length).toBe(2); // Only 2 resets within window
  });
});
