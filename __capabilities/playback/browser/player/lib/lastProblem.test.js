import { describe, it, expect } from 'vitest';
import { problemClearedByPlaying, PROBLEM_CLEAR_GRACE_MS } from './lastProblem.js';

describe('problemClearedByPlaying', () => {
  it('keeps a fresh problem so the sender can read it, then retires it on the next playing', () => {
    const now = 1_000_000;
    expect(problemClearedByPlaying({ at: now - 1000 }, now)).toBe(false);
    expect(problemClearedByPlaying({ at: now - PROBLEM_CLEAR_GRACE_MS }, now)).toBe(true);
  });
  it('has nothing to clear when there is no problem, and clears a malformed one', () => {
    expect(problemClearedByPlaying(null)).toBe(false);
    expect(problemClearedByPlaying({ at: 'x' })).toBe(true);
  });
});
