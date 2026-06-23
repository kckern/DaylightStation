import { describe, it, expect } from 'vitest';
import { buildOrder, nextPos, prevPos } from './musicQueue.js';

describe('buildOrder', () => {
  it('is the identity order when not shuffled', () => {
    expect(buildOrder(4, false)).toEqual([0, 1, 2, 3]);
  });
  it('is a permutation of 0..len-1 when shuffled', () => {
    const o = buildOrder(5, true);
    expect([...o].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
  it('is empty for non-positive length', () => {
    expect(buildOrder(0, false)).toEqual([]);
    expect(buildOrder(-2, true)).toEqual([]);
  });
});

describe('nextPos', () => {
  it('advances within the order', () => expect(nextPos([0, 1, 2], 0, false)).toBe(1));
  it('stops (-1) at the end without repeat', () => expect(nextPos([0, 1, 2], 2, false)).toBe(-1));
  it('wraps to 0 with repeat', () => expect(nextPos([0, 1, 2], 2, true)).toBe(0));
  it('is -1 for an empty order', () => expect(nextPos([], 0, true)).toBe(-1));
});

describe('prevPos', () => {
  it('goes back within the order', () => expect(prevPos([0, 1, 2], 2, false)).toBe(1));
  it('clamps at 0 without repeat', () => expect(prevPos([0, 1, 2], 0, false)).toBe(0));
  it('wraps to the end with repeat', () => expect(prevPos([0, 1, 2], 0, true)).toBe(2));
});
