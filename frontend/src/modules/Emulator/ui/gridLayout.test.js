import { describe, it, expect } from 'vitest';
import { computeGridLayout, MIN_TILE, MAX_TILE, GAP } from './gridLayout.js';

// The real arcade panel at 1920x1080.
const PANEL = { width: 1300, height: 638 };

describe('computeGridLayout', () => {
  it('makes one game a poster instead of a stamp', () => {
    const { tile, columns, rows } = computeGridLayout({ ...PANEL, count: 1 });
    expect(columns).toBe(1);
    expect(rows).toBe(1);
    // The old fixed size was 160px in this same panel — 3% of it.
    expect(tile).toBeGreaterThan(160 * 2);
    expect(tile).toBeLessThanOrEqual(MAX_TILE);
  });

  it('keeps a small shelf on one row', () => {
    for (const count of [2, 3, 4]) {
      const { rows, tile } = computeGridLayout({ ...PANEL, count });
      expect(rows).toBe(1);
      expect(tile).toBeGreaterThan(160);
    }
  });

  it('takes a second row only when it actually buys size', () => {
    // Seven across is 161px a tile; four-by-two is roughly double that.
    const one = computeGridLayout({ ...PANEL, count: 7, aspect: 1 });
    expect(one.rows).toBe(2);
    expect(one.columns).toBe(4);
    expect(one.tile).toBeGreaterThan(250);
  });

  it('respects the tile shape when solving', () => {
    // A tall Genesis cover (0.635) fits more across than a square one.
    const square = computeGridLayout({ ...PANEL, count: 4, aspect: 1 });
    const tall = computeGridLayout({ ...PANEL, count: 4, aspect: 0.635 });
    expect(tall.tile).toBeGreaterThan(square.tile);
    expect(tall.rows).toBe(1);
  });

  it('never exceeds the panel it was given', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 12, 30]) {
      for (const aspect of [1, 0.635, 1.5]) {
        const { tile, columns, rows, gap } = computeGridLayout({ ...PANEL, count, aspect });
        const usedW = columns * tile * aspect + gap * (columns - 1);
        const usedH = rows * tile + gap * (rows - 1);
        // MIN_TILE is a floor that may overflow deliberately (the wrap scrolls).
        if (tile > MIN_TILE) {
          expect(usedW).toBeLessThanOrEqual(PANEL.width + 1);
          expect(usedH).toBeLessThanOrEqual(PANEL.height + 1);
        }
        expect(columns * rows).toBeGreaterThanOrEqual(count);
      }
    }
  });

  it('floors at MIN_TILE rather than shrinking to nothing', () => {
    const { tile } = computeGridLayout({ width: 300, height: 200, count: 40 });
    expect(tile).toBe(MIN_TILE);
  });

  it('degrades safely on a container that has not been measured yet', () => {
    expect(computeGridLayout({ width: 0, height: 0, count: 3 }).tile).toBe(MIN_TILE);
    expect(computeGridLayout({ ...PANEL, count: 0 }).rows).toBe(0);
    expect(computeGridLayout({ ...PANEL, count: 4, aspect: 0 }).tile).toBeGreaterThan(0);
  });

  it('uses one gutter on both axes', () => {
    expect(computeGridLayout({ ...PANEL, count: 6 }).gap).toBe(GAP);
  });
});
