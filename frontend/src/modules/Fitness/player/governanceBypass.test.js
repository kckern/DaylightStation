import { describe, it, expect } from 'vitest';
import { shouldBypassGovernance } from './governanceBypass.js';

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
