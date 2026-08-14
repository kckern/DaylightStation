import { describe, it, expect } from 'vitest';

// The rule under test, extracted so it can be asserted without booting the whole
// media stack: a remount that was paused must NOT arm autoplay.
import { shouldArmAutoplay } from './shouldArmAutoplay.js';

describe('shouldArmAutoplay', () => {
  it('arms autoplay for a normal (non-remount) load', () => {
    expect(shouldArmAutoplay(null)).toBe(true);
    expect(shouldArmAutoplay({})).toBe(true);
  });

  it('arms autoplay for a remount that was playing', () => {
    expect(shouldArmAutoplay({ wasPaused: false })).toBe(true);
  });

  it('does NOT arm autoplay for a remount that was paused', () => {
    expect(shouldArmAutoplay({ wasPaused: true })).toBe(false);
  });
});
