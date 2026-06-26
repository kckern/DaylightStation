import { describe, it, expect } from 'vitest';
import { firesOnGap } from './whoIsPlaying.js';

describe('firesOnGap', () => {
  const THRESH = 120000; // 2 min
  it('fires when input resumes after >= threshold of inactivity', () => {
    expect(firesOnGap(1_000, 1_000 + THRESH, THRESH)).toBe(true);
    expect(firesOnGap(1_000, 1_000 + THRESH + 5, THRESH)).toBe(true);
  });
  it('does not fire within the threshold', () => {
    expect(firesOnGap(1_000, 1_000 + THRESH - 1, THRESH)).toBe(false);
  });
  it('is disabled at threshold <= 0', () => {
    expect(firesOnGap(0, 9_999_999, 0)).toBe(false);
    expect(firesOnGap(0, 9_999_999, -1)).toBe(false);
  });
});
