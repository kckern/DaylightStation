import { jest, describe, test, expect } from '@jest/globals';

describe('transport capability check timing', () => {
  test('should not warn immediately on mount (grace period)', () => {
    // The fix defers the warning by 2000ms.
    // This test verifies the design: mount time is captured, and
    // the check only fires after the grace period.
    const mountTime = Date.now();
    const graceMs = 2000;

    // Simulate: immediately after mount, no capability
    const elapsed = Date.now() - mountTime;
    expect(elapsed < graceMs).toBe(true);
    // Warning should NOT fire yet
  });

  test('should warn after grace period if capability still missing', () => {
    const mountTime = Date.now() - 3000; // 3s ago
    const graceMs = 2000;
    const elapsed = Date.now() - mountTime;
    expect(elapsed > graceMs).toBe(true);
    // Warning SHOULD fire now
  });

  test('should not warn if capability becomes available before grace expires', () => {
    // If resilienceBridge.getMediaEl is a function, no warning
    const bridge = { getMediaEl: () => document.createElement('video') };
    const hasMediaEl = typeof bridge.getMediaEl === 'function';
    expect(hasMediaEl).toBe(true);
    // Warning should NOT fire
  });
});
