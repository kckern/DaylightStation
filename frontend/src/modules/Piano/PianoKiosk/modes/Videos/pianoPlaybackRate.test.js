// pianoPlaybackRate.test.js
import { describe, it, expect } from 'vitest';
import { PIANO_PLAYBACK_RATES, nextPianoRate } from './pianoPlaybackRate.js';

describe('nextPianoRate', () => {
  it('exposes the full ladder', () => {
    expect(PIANO_PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });
  it('steps through the ladder and wraps at the end', () => {
    expect(nextPianoRate(0.5)).toBe(0.75);
    expect(nextPianoRate(1)).toBe(1.25);
    expect(nextPianoRate(2)).toBe(0.5);
  });
  it('treats an unknown/absent rate as the 1x slot', () => {
    expect(nextPianoRate(undefined)).toBe(1.25);
    expect(nextPianoRate(3)).toBe(1.25);
  });
});
