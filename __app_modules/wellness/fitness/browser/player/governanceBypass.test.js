import { describe, it, expect } from 'vitest';
import { shouldBypassGovernance, applyGovernanceBypass } from "./governanceBypass.js";

describe('shouldBypassGovernance', () => {
  it('governs (no bypass) when no flags are set', () => {
    expect(shouldBypassGovernance({})).toBe(false);
    expect(shouldBypassGovernance()).toBe(false);
    expect(shouldBypassGovernance({ nogovernProp: false, bypassActive: false, itemNogovern: false })).toBe(false);
  });

  it('bypasses when the sticky nogovern prop is set', () => {
    expect(shouldBypassGovernance({ nogovernProp: true })).toBe(true);
  });

  it('bypasses when a runtime bypass is active (in-player unlock)', () => {
    expect(shouldBypassGovernance({ bypassActive: true })).toBe(true);
  });

  it('bypasses when the current item is tagged nogovern (T4.2 seam)', () => {
    expect(shouldBypassGovernance({ itemNogovern: true })).toBe(true);
  });

  it('coerces truthy/falsy values to a boolean', () => {
    expect(shouldBypassGovernance({ itemNogovern: undefined })).toBe(false);
    expect(shouldBypassGovernance({ bypassActive: 1 })).toBe(true);
  });
});

describe('applyGovernanceBypass', () => {
  const locked = { status: 'pending', videoLocked: true, isGoverned: true, audioDuck: { level: 0.2 }, challenge: { id: 'c1' }, deadline: 123, requirements: [1] };

  it('returns the engine snapshot itself (same identity) when not bypassed', () => {
    expect(applyGovernanceBypass(locked, false)).toBe(locked);
  });

  it('releases the lock and its side channels when bypassed, keeping the rest', () => {
    expect(applyGovernanceBypass(locked, true)).toEqual({
      status: 'unlocked', videoLocked: false, isGoverned: false,
      audioDuck: null, challenge: null, deadline: null, requirements: [1],
    });
    expect(locked.videoLocked).toBe(true); // never mutates the engine snapshot
  });

  it('tolerates a missing snapshot', () => {
    expect(applyGovernanceBypass(null, true)).toMatchObject({ videoLocked: false, isGoverned: false });
  });
});
