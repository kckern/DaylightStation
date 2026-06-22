import { describe, it, expect } from 'vitest';
import { nextPlaybackRate, PLAYBACK_RATES } from './playbackRateCycle.js';

describe('nextPlaybackRate', () => {
  it('cycles 1 → 1.5 → 2 → 1', () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
  });
  it('treats null/undefined/unknown as 1 (so the first press goes to 1.5)', () => {
    expect(nextPlaybackRate(null)).toBe(1.5);
    expect(nextPlaybackRate(undefined)).toBe(1.5);
    expect(nextPlaybackRate(0.75)).toBe(1.5);
  });
  it('exports the rate list', () => {
    expect(PLAYBACK_RATES).toEqual([1, 1.5, 2]);
  });
});
