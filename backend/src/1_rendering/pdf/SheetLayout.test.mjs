// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { layout } from './SheetLayout.mjs';

const PAGE = { widthPt: 612, heightPt: 792, marginPt: 36 };

describe('layout — single block', () => {
  it('places a 3x3 block of 9 items on one page, left-to-right then down', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'density', title: 'Caloric density', cols: 3, rows: 3, count: 9, gapPt: 8 }],
    });

    expect(result.pages).toBe(1);
    expect(result.cells).toHaveLength(9);

    const [c0, c1, c3] = [result.cells[0], result.cells[1], result.cells[3]];
    expect(c0).toMatchObject({ page: 0, block: 'density', index: 0 });
    expect(c1.y).toBeCloseTo(c0.y, 5);
    expect(c1.x).toBeGreaterThan(c0.x);
    expect(c3.x).toBeCloseTo(c0.x, 5);
    expect(c3.y).toBeGreaterThan(c0.y);
    for (const c of result.cells) {
      expect(c.w).toBeCloseTo(c0.w, 5);
      expect(c.h).toBeCloseTo(c0.h, 5);
      expect(c.x).toBeGreaterThanOrEqual(PAGE.marginPt);
      expect(c.x + c.w).toBeLessThanOrEqual(PAGE.widthPt - PAGE.marginPt + 0.01);
    }
  });
});

describe('layout — titles', () => {
  it('emits a title placement per block and pushes cells below it', () => {
    const noTitle = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8 }],
    });
    const withTitle = layout({
      page: PAGE,
      blocks: [{ id: 'a', title: 'Caloric density', cols: 3, rows: 3, count: 3, gapPt: 8, titleHeightPt: 24 }],
    });

    expect(noTitle.titles).toHaveLength(0);
    expect(withTitle.titles).toHaveLength(1);
    expect(withTitle.titles[0]).toMatchObject({
      page: 0, block: 'a', text: 'Caloric density', continued: false,
    });
    expect(withTitle.cells[0].y - noTitle.cells[0].y).toBeCloseTo(24, 5);
  });
});
