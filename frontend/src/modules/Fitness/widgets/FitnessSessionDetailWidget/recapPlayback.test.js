import { describe, it, expect } from 'vitest';
import { shouldPlayRecap } from './recapPlayback.js';

describe('shouldPlayRecap', () => {
  it('plays when enabled and motion is allowed', () => {
    expect(shouldPlayRecap({ enabled: true, prefersReducedMotion: false })).toBe(true);
  });
  it('never plays under prefers-reduced-motion', () => {
    expect(shouldPlayRecap({ enabled: true, prefersReducedMotion: true })).toBe(false);
  });
  it('never plays when disabled', () => {
    expect(shouldPlayRecap({ enabled: false, prefersReducedMotion: false })).toBe(false);
  });
});
