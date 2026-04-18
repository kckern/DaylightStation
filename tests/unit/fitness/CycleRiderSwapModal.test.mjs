import { describe, it, expect, beforeAll } from '@jest/globals';

/**
 * CycleRiderSwapModal helper tests (Task 24).
 *
 * Following Task 20 precedent, we unit-test the pure helper
 * (`formatCooldownHint`) extracted from the modal component. The component
 * itself is a portal-based React modal whose rendering behavior is covered
 * by integration/flow tests — here we only exercise the deterministic logic
 * that shapes its UI hints.
 */

let formatCooldownHint;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/overlays/cycleSwapModalUtils.js');
  formatCooldownHint = mod.formatCooldownHint;
});

describe('formatCooldownHint', () => {
  it('returns null when no cooldown', () => {
    expect(formatCooldownHint(null, 10000)).toBeNull();
    expect(formatCooldownHint(undefined, 10000)).toBeNull();
  });

  it('returns null when cooldown expired', () => {
    expect(formatCooldownHint(5000, 10000)).toBeNull();
  });

  it('returns null when cooldown exactly at now', () => {
    expect(formatCooldownHint(10000, 10000)).toBeNull();
  });

  it('returns null when now is missing/zero', () => {
    expect(formatCooldownHint(10000, 0)).toBeNull();
    expect(formatCooldownHint(10000, null)).toBeNull();
    expect(formatCooldownHint(10000, undefined)).toBeNull();
  });

  it('returns cooldown minute hint for active cooldown', () => {
    expect(formatCooldownHint(10000 + 60000, 10000)).toMatch(/1 min/);
    expect(formatCooldownHint(10000 + 120000, 10000)).toMatch(/2 min/);
  });

  it('ceils partial minute', () => {
    // 30s remaining → ceil to 1 min
    expect(formatCooldownHint(10000 + 30000, 10000)).toMatch(/1 min/);
    // 61s remaining → ceil to 2 min
    expect(formatCooldownHint(10000 + 61000, 10000)).toMatch(/2 min/);
  });

  it('includes the cooldown prefix', () => {
    const hint = formatCooldownHint(10000 + 60000, 10000);
    expect(hint).toMatch(/cooldown/i);
  });
});
