// __capabilities/playback/browser/player/advanceSteps.test.js
import { describe, it, expect, vi } from 'vitest';
import { advanceSteps } from './advanceSteps.js';

const fns = () => ({ advance: vi.fn(), singleAdvance: vi.fn() });

describe('advanceSteps', () => {
  it('moves a queue forward several entries in ONE move (one curtain)', () => {
    const f = fns();
    advanceSteps(3, { isQueue: true, hasOnDeck: false, queueLength: 5, ...f });
    expect(f.advance.mock.calls).toEqual([[3]]);
  });

  it('steps one at a time when the move reaches the end of the queue', () => {
    const f = fns();
    advanceSteps(3, { isQueue: true, hasOnDeck: false, queueLength: 3, ...f });
    expect(f.advance.mock.calls).toEqual([[], [], []]);
  });

  it('batches a step that lands on the last entry (step === queueLength - 1)', () => {
    const f = fns();
    advanceSteps(4, { isQueue: true, hasOnDeck: false, queueLength: 5, ...f });
    expect(f.advance.mock.calls).toEqual([[4]]);
  });

  it('steps one at a time when the move goes past the end of the queue', () => {
    const f = fns();
    advanceSteps(4, { isQueue: true, hasOnDeck: false, queueLength: 3, ...f });
    expect(f.advance.mock.calls).toEqual([[], [], [], []]);
  });

  it('reads a numeric string count', () => {
    const f = fns();
    advanceSteps('3', { isQueue: true, hasOnDeck: false, queueLength: 5, ...f });
    expect(f.advance.mock.calls).toEqual([[3]]);
  });

  it('truncates a fractional count', () => {
    const f = fns();
    advanceSteps(2.7, { isQueue: true, hasOnDeck: false, queueLength: 5, ...f });
    expect(f.advance.mock.calls).toEqual([[2]]);
  });

  it('advances a single item once for a negative count (it has no backtrack)', () => {
    const f = fns();
    advanceSteps(-2, { isQueue: false, hasOnDeck: false, ...f });
    expect(f.singleAdvance.mock.calls).toEqual([[]]);
  });

  it('steps one at a time when the queue length is unknown', () => {
    const f = fns();
    advanceSteps(2, { isQueue: true, hasOnDeck: false, ...f });
    expect(f.advance.mock.calls).toEqual([[], []]);
  });

  it('keeps single steps while an on-deck item is waiting (existing behaviour)', () => {
    const f = fns();
    advanceSteps(2, { isQueue: true, hasOnDeck: true, queueLength: 5, ...f });
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
