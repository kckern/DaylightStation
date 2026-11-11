import { describe, it, expect } from 'vitest';
import { CELLS, cellPools, nextFrame, cellForTick, isFlatLuma } from './episodeStillsGrid.js';
import { stillCount, stillOffsets, MAX_STILLS } from './useEpisodeStills.js';

// The thumbnail is always a 3×3 grid of stills from inside the episode. Each
// cell draws from its own slice of the runtime, in order; one cell changes
// per tick, in reading order.

const urls = (n) => Array.from({ length: n }, (_, i) => `s${i}`);

describe('stillCount / stillOffsets', () => {
  it('asks for up to 81 stills, never closer together than 5 s', () => {
    expect(MAX_STILLS).toBe(81);
    expect(stillCount(30 * 60 * 1000)).toBe(81);
    expect(stillCount(3 * 60 * 1000)).toBe(32); // 162 s of usable runtime / 5 s
    expect(stillCount(20 * 1000)).toBe(3);
    expect(stillCount(1000)).toBe(1);
    expect(stillCount(0)).toBe(0);
  });

  it('spreads them in order through 5 %…95 % of the runtime (no title card, no credits)', () => {
    const offsets = stillOffsets(1800000);
    expect(offsets).toHaveLength(81);
    expect(offsets[0]).toBe(100000);
    expect(offsets[80]).toBe(1700000);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe('cellPools', () => {
  it('gives each of the nine cells its own consecutive slice of nine', () => {
    const pools = cellPools(urls(81));
    expect(CELLS).toBe(9);
    expect(pools).toHaveLength(9);
    expect(pools[0]).toEqual(urls(9));
    expect(pools[4][0]).toBe('s36');
    expect(pools[8].at(-1)).toBe('s80');
    expect(pools.flat()).toEqual(urls(81));
  });

  it('spreads fewer stills across the cells, every still used once, in order', () => {
    const pools = cellPools(urls(32));
    expect(pools.flat()).toEqual(urls(32));
    expect(pools.map((p) => p.length)).toEqual([3, 4, 3, 4, 3, 4, 3, 4, 4]);
  });

  it('with fewer than nine, every cell still has one, spread through the runtime', () => {
    const pools = cellPools(urls(3));
    expect(pools.every((p) => p.length === 1)).toBe(true);
    expect(pools.map((p) => p[0])).toEqual(['s0', 's0', 's0', 's1', 's1', 's1', 's2', 's2', 's2']);
  });

  it('is empty without stills', () => {
    expect(cellPools([])).toEqual([]);
    expect(cellPools(null)).toEqual([]);
  });
});

describe('cellForTick', () => {
  it('walks the cells in reading order and starts again at the top-left', () => {
    expect(Array.from({ length: 11 }, (_, t) => cellForTick(t))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1]);
  });
});

describe('nextFrame', () => {
  it('is the next still in the cell, wrapping round', () => {
    expect(nextFrame(['a', 'b', 'c'], 0, {})).toBe(1);
    expect(nextFrame(['a', 'b', 'c'], 2, {})).toBe(0);
  });
  it('steps over stills that failed to load', () => {
    expect(nextFrame(['a', 'b', 'c'], 0, { b: 'failed' })).toBe(2);
  });
  it('is null when there is nothing else to show', () => {
    expect(nextFrame(['a'], 0, {})).toBeNull();
    expect(nextFrame(['a', 'b'], 0, { b: 'failed' })).toBeNull();
  });
});

describe('isFlatLuma', () => {
  // A fade to black or white, a blank loading screen: one colour edge to edge
  // reads as an empty cell, so it is never shown.
  it('is true for a frame of one colour', () => {
    expect(isFlatLuma(Array(144).fill(1))).toBe(true);
    expect(isFlatLuma(Array.from({ length: 144 }, (_, i) => 230 + (i % 3) * 3))).toBe(true);
  });
  it('is false for a picture', () => {
    expect(isFlatLuma(Array.from({ length: 144 }, (_, i) => (i * 37) % 255))).toBe(false);
    expect(isFlatLuma(Array.from({ length: 144 }, (_, i) => (i < 72 ? 40 : 90)))).toBe(false);
  });
  it('is false when nothing could be measured', () => {
    expect(isFlatLuma([])).toBe(false);
    expect(isFlatLuma(null)).toBe(false);
  });
});
