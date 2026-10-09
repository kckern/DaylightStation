import { describe, it, expect } from 'vitest';
import { keyFallbackNeeded } from './touchCapability.js';

describe('keyFallbackNeeded', () => {
  it('is true on a screen with no touch — the office PC', () => {
    expect(keyFallbackNeeded(null, { maxTouchPoints: 0 })).toBe(true);
  });

  it('is false on a touchscreen — the kiosk tablet keeps its buttons', () => {
    expect(keyFallbackNeeded(null, { maxTouchPoints: 10 })).toBe(false);
  });

  it('lets config force it on, for someone who prefers the keys', () => {
    expect(keyFallbackNeeded({ keyFallback: true }, { maxTouchPoints: 10 })).toBe(true);
  });

  it('lets config force it off', () => {
    expect(keyFallbackNeeded({ keyFallback: false }, { maxTouchPoints: 0 })).toBe(false);
  });

  it('assumes no touch when the navigator cannot be read', () => {
    // Failing toward "give them a key" is the safe direction: a redundant key
    // path costs nothing, a missing one is a dead end.
    expect(keyFallbackNeeded(null, null)).toBe(true);
    expect(keyFallbackNeeded(null, {})).toBe(true);
  });
});
