import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('batchedForceUpdate throttle', () => {
  let forceUpdateCount;
  let batchedForceUpdate;
  let scheduledCallback;

  beforeEach(() => {
    forceUpdateCount = 0;
    scheduledCallback = null;

    // useFakeTimers() patches global requestAnimationFrame, so install it
    // BEFORE replacing rAF with our spy — otherwise vitest overwrites our
    // mock and the assertion fails with "is not a spy".
    vi.useFakeTimers();

    // Mock requestAnimationFrame (post-useFakeTimers so this wins).
    global.requestAnimationFrame = vi.fn((cb) => { scheduledCallback = cb; return 1; });

    // Simulate the throttled batchedForceUpdate logic
    const MIN_UPDATE_INTERVAL_MS = 250;
    let lastUpdateTime = 0;
    let scheduled = false;
    let throttleTimer = null;

    batchedForceUpdate = () => {
      const now = Date.now();
      const elapsed = now - lastUpdateTime;

      if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
        // Enough time has passed — schedule immediately
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            lastUpdateTime = Date.now();
            forceUpdateCount++;
          });
        }
      } else if (!throttleTimer) {
        // Too soon — schedule a delayed update
        const delay = MIN_UPDATE_INTERVAL_MS - elapsed;
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => {
              scheduled = false;
              lastUpdateTime = Date.now();
              forceUpdateCount++;
            });
          }
        }, delay);
      }
      // Otherwise: update already scheduled or throttle timer already pending — drop
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.requestAnimationFrame;
  });

  it('should fire immediately on first call', () => {
    batchedForceUpdate();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('should NOT fire again within 250ms', () => {
    batchedForceUpdate();
    // Flush the RAF
    scheduledCallback?.();

    // Call 20 more times rapidly (simulating 20 HR samples)
    for (let i = 0; i < 20; i++) {
      batchedForceUpdate();
    }

    // Only 1 RAF should have fired, plus 1 throttle timer pending
    expect(forceUpdateCount).toBe(1);
  });

  it('should fire again after 250ms', () => {
    batchedForceUpdate();
    scheduledCallback?.();
    expect(forceUpdateCount).toBe(1);

    // Advance 250ms
    vi.advanceTimersByTime(250);

    batchedForceUpdate();
    // Should schedule new RAF
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('should coalesce rapid calls into max ~4/sec', () => {
    // Simulate 1 second of 20 calls/sec
    for (let i = 0; i < 20; i++) {
      batchedForceUpdate();
      if (scheduledCallback) {
        scheduledCallback();
        scheduledCallback = null;
      }
      vi.advanceTimersByTime(50); // 50ms between calls
    }

    // At 250ms throttle, expect ~4 actual updates in 1 second
    expect(forceUpdateCount).toBeLessThanOrEqual(5);
    expect(forceUpdateCount).toBeGreaterThanOrEqual(3);
  });
});
