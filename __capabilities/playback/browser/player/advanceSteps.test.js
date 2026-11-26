// __capabilities/playback/browser/player/advanceSteps.test.js
import { describe, it, expect, vi } from 'vitest';
import { advanceSteps } from './advanceSteps.js';

const fns = () => ({ advance: vi.fn(), singleAdvance: vi.fn() });

describe('advanceSteps', () => {
  it('moves a queue forward several entries in ONE move (one curtain)', () => {
    const f = fns();
    advanceSteps(3, { isQueue: true, hasOnDeck: false, ...f });
    expect(f.advance.mock.calls).toEqual([[3]]);
  });

  it('steps one at a time while an on-deck item is waiting (it takes the first step)', () => {
    const f = fns();
    advanceSteps(2, { isQueue: true, hasOnDeck: true, ...f });
    expect(f.advance.mock.calls).toEqual([[], []]);
  });

  it('keeps a single step and backtracking as they were', () => {
    const f = fns();
    advanceSteps(1, { isQueue: true, hasOnDeck: false, ...f });
    advanceSteps(-2, { isQueue: true, hasOnDeck: false, ...f });
    expect(f.advance.mock.calls).toEqual([[], [-2]]);
  });

  it('treats a missing or zero count as one step', () => {
    const f = fns();
    advanceSteps(undefined, { isQueue: true, hasOnDeck: false, ...f });
    advanceSteps(0, { isQueue: true, hasOnDeck: false, ...f });
    expect(f.advance).toHaveBeenCalledTimes(2);
  });

  it('advances a single item with its own advance, count times', () => {
    const f = fns();
    advanceSteps(2, { isQueue: false, hasOnDeck: false, ...f });
    expect(f.singleAdvance).toHaveBeenCalledTimes(2);
    expect(f.advance).not.toHaveBeenCalled();
  });

  it('does nothing when the advance it needs is missing', () => {
    expect(() => advanceSteps(2, { isQueue: true, hasOnDeck: false, advance: null })).not.toThrow();
  });
});
