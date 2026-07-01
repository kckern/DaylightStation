import { describe, it, expect } from 'vitest';
import {
  stallJoltPlan,
  isStallJoltExhausted,
  STALL_JOLT_LADDER,
  STALL_JOLT_GRACE_MS,
  STALL_JOLT_STEP_MS,
} from './stallJolt.js';

describe('stallJoltPlan', () => {
  it('rung 0 refreshes the URL at the intent (fresh transcode at the seek offset)', () => {
    expect(stallJoltPlan(0)).toEqual({
      reason: 'stall-jolt-refresh-url', refreshUrl: true, forceRemount: false,
    });
  });

  it('rung 1 escalates to a real remount, still refreshing the URL', () => {
    expect(stallJoltPlan(1)).toEqual({
      reason: 'stall-jolt-remount', refreshUrl: true, forceRemount: true,
    });
  });

  it('every rung refreshes the URL (never a same-session reload that cannot serve the offset)', () => {
    STALL_JOLT_LADDER.forEach((rung) => expect(rung.refreshUrl).toBe(true));
  });

  it('returns null past the last rung and for bad input', () => {
    expect(stallJoltPlan(STALL_JOLT_LADDER.length)).toBeNull();
    expect(stallJoltPlan(99)).toBeNull();
    expect(stallJoltPlan(-1)).toBeNull();
    expect(stallJoltPlan(1.5)).toBeNull();
    expect(stallJoltPlan()).toBeNull();
  });
});

describe('isStallJoltExhausted', () => {
  it('is false within the ladder, true past it', () => {
    expect(isStallJoltExhausted(0)).toBe(false);
    expect(isStallJoltExhausted(STALL_JOLT_LADDER.length - 1)).toBe(false);
    expect(isStallJoltExhausted(STALL_JOLT_LADDER.length)).toBe(true);
  });
});

describe('timing constants', () => {
  it('grace is shorter than a step, and both are sane', () => {
    expect(STALL_JOLT_GRACE_MS).toBeGreaterThan(1000);
    expect(STALL_JOLT_STEP_MS).toBeGreaterThan(STALL_JOLT_GRACE_MS - 1);
  });
});
