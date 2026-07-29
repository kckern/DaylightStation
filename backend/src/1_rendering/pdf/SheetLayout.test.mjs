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

describe('layout — underfull and stacking', () => {
  it('an underfull block ends after its last item and reports capacity', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'containers', cols: 5, rows: 5, count: 4, gapPt: 8 }],
    });
    expect(result.cells).toHaveLength(4);
    expect(result.cells.every((c) => c.page === 0)).toBe(true);
    expect(result.underfull).toEqual([{ block: 'containers', capacity: 25, items: 4 }]);
  });

  it('stacks a second block below the first, not overlapping it', () => {
    const result = layout({
      page: PAGE,
      blocks: [
        { id: 'a', cols: 3, rows: 3, count: 9, gapPt: 8 },
        { id: 'b', cols: 5, rows: 5, count: 5, gapPt: 8 },
      ],
    });
    const aBottom = Math.max(...result.cells.filter((c) => c.block === 'a').map((c) => c.y + c.h));
    const bTop = Math.min(...result.cells.filter((c) => c.block === 'b').map((c) => c.y));
    expect(bTop).toBeGreaterThanOrEqual(aBottom);
  });
});

describe('layout — pagination', () => {
  it('overflows past rows-per-page onto a new page and repeats the title as continued', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'containers', title: 'Containers', cols: 5, rows: 5, count: 30, gapPt: 8, titleHeightPt: 24 }],
    });

    expect(result.pages).toBe(2);
    expect(result.cells.filter((c) => c.page === 0)).toHaveLength(25);
    expect(result.cells.filter((c) => c.page === 1)).toHaveLength(5);
    expect(result.cells.find((c) => c.page === 1).index).toBe(25);

    expect(result.titles).toHaveLength(2);
    expect(result.titles[0]).toMatchObject({ page: 0, continued: false });
    expect(result.titles[1]).toMatchObject({ page: 1, continued: true });

    expect(result.underfull).toEqual([]);
  });

  it('starts a block on a new page when it cannot fit under the previous one', () => {
    const result = layout({
      page: PAGE,
      blocks: [
        { id: 'a', cols: 2, rows: 4, count: 8, gapPt: 8 },
        { id: 'b', cols: 2, rows: 4, count: 8, gapPt: 8 },
      ],
    });
    expect(result.pages).toBeGreaterThan(1);
    const bPages = new Set(result.cells.filter((c) => c.block === 'b').map((c) => c.page));
    const aPages = new Set(result.cells.filter((c) => c.block === 'a').map((c) => c.page));
    for (const c of result.cells.filter((x) => x.block === 'b')) {
      expect(c.y + c.h).toBeLessThanOrEqual(PAGE.heightPt - PAGE.marginPt + 0.01);
    }
    expect([...bPages].some((p) => !aPages.has(p))).toBe(true);
  });

  // A cell taller than the printable area can never fit, so the "advance to a new page
  // and re-measure" path must not keep advancing forever. Verified by removing the
  // guard: the run hangs outright (vitest cannot preempt a synchronous loop, so this
  // regression surfaces as a wedged suite, not a red assertion).
  it('terminates when a cell is taller than the page can ever hold', () => {
    const result = layout({
      page: { widthPt: 612, heightPt: 200, marginPt: 36 },
      blocks: [{ id: 'oversize', cols: 1, rows: 3, count: 3, gapPt: 8 }],
    });
    expect(result.cells).toHaveLength(3);
    expect(new Set(result.cells.map((c) => c.page)).size).toBe(3);
  });
});

describe('layout — cell aspect', () => {
  it('defaults to square cells', () => {
    const r = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8 }] });
    expect(r.cells[0].h).toBeCloseTo(r.cells[0].w, 5);
  });

  it('honours a block aspect ratio (w/h) so a mark taller than it is wide gets a taller cell', () => {
    // The QR mark is ~0.73 w/h: frame + label chrome make it taller than wide, and
    // the ratio even shifts with size because that chrome is absolute. Square cells
    // would letterbox every mark, so the block declares the shape it needs.
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8, aspect: 0.73 }],
    });
    const c = r.cells[0];
    expect(c.h).toBeCloseTo(c.w / 0.73, 5);
    expect(c.h).toBeGreaterThan(c.w);
  });

  it('a taller cell means fewer rows fit, so pagination accounts for aspect', () => {
    const square = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 9, count: 27, gapPt: 8 }] });
    const tall = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 9, count: 27, gapPt: 8, aspect: 0.5 }] });
    expect(tall.pages).toBeGreaterThan(square.pages);
  });
});

describe('layout — max cell width', () => {
  it('caps cell width so a 3-column block need not span the page', () => {
    const wide = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8 }] });
    const capped = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8, maxCellWPt: 120 }],
    });
    expect(wide.cells[0].w).toBeGreaterThan(120);
    expect(capped.cells[0].w).toBe(120);
    // still left-aligned at the margin, still one row
    expect(capped.cells[0].x).toBeCloseTo(PAGE.marginPt, 5);
    expect(capped.cells[2].x).toBeCloseTo(PAGE.marginPt + 2 * (120 + 8), 5);
  });

  it('a capped cell is shorter too, so more rows fit per page', () => {
    const wide = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 9, count: 27, gapPt: 8, aspect: 0.835 }] });
    const capped = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 9, count: 27, gapPt: 8, aspect: 0.835, maxCellWPt: 60 }] });
    expect(wide.pages).toBe(3);
    expect(capped.pages).toBe(1);
  });
});

describe('layout — alignment', () => {
  it('left-aligns by default', () => {
    const r = layout({ page: PAGE, blocks: [{ id: 'a', cols: 3, rows: 1, count: 3, gapPt: 8, maxCellWPt: 100 }] });
    expect(r.cells[0].x).toBeCloseTo(PAGE.marginPt, 5);
  });

  it('centres a block whose cells do not span the page', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 1, count: 3, gapPt: 8, maxCellWPt: 100, align: 'center' }],
    });
    const used = 3 * 100 + 2 * 8;
    const contentW = PAGE.widthPt - 2 * PAGE.marginPt;
    expect(r.cells[0].x).toBeCloseTo(PAGE.marginPt + (contentW - used) / 2, 5);
    // and the block is symmetric: left inset equals right inset
    const rightEdge = r.cells[2].x + r.cells[2].w;
    expect(r.cells[0].x - PAGE.marginPt).toBeCloseTo(PAGE.widthPt - PAGE.marginPt - rightEdge, 5);
  });

  it('centres on the FULL row width, so a short last row stays column-aligned', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 5, rows: 2, count: 7, gapPt: 8, maxCellWPt: 90, align: 'center' }],
    });
    const firstRow = r.cells.slice(0, 5);
    const lastRow = r.cells.slice(5);
    expect(lastRow[0].x).toBeCloseTo(firstRow[0].x, 5);
  });
});

describe('layout — justify', () => {
  const contentW = PAGE.widthPt - 2 * PAGE.marginPt;

  it('spreads a row across the full content width, turning slack into gap', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 1, count: 3, gapPt: 8, maxCellWPt: 135, align: 'justify' }],
    });
    const [c0, c1, c2] = r.cells;
    expect(c0.w).toBe(135);
    // first cell at the margin, last cell flush to the right margin
    expect(c0.x).toBeCloseTo(PAGE.marginPt, 5);
    expect(c2.x + c2.w).toBeCloseTo(PAGE.widthPt - PAGE.marginPt, 5);
    // gaps equal, and far wider than the configured 8pt — that is the point
    const g1 = c1.x - (c0.x + c0.w);
    const g2 = c2.x - (c1.x + c1.w);
    expect(g1).toBeCloseTo(g2, 5);
    expect(g1).toBeGreaterThan(60);
  });

  it('keeps the VERTICAL gap at gapPt — justify only redistributes horizontally', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 2, count: 6, gapPt: 26, maxCellWPt: 135, align: 'justify' }],
    });
    const rowGap = r.cells[3].y - (r.cells[0].y + r.cells[0].h);
    expect(rowGap).toBeCloseTo(26, 5);
  });

  it('does not stretch a single-column block', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 1, rows: 1, count: 1, gapPt: 8, maxCellWPt: 135, align: 'justify' }],
    });
    expect(r.cells[0].w).toBe(135);
    expect(r.cells[0].x).toBeCloseTo(PAGE.marginPt, 5);
  });
});

describe('layout — section dividers', () => {
  const contentW = PAGE.widthPt - 2 * PAGE.marginPt;

  it('emits no rules unless a block asks for one', () => {
    const r = layout({ page: PAGE, blocks: [{ id: 'a', title: 'A', cols: 3, rows: 1, count: 3, gapPt: 8 }] });
    expect(r.rules).toEqual([]);
  });

  it('emits a full-width rule above a divided block, and pushes its title below it', () => {
    const plain = layout({
      page: PAGE,
      blocks: [{ id: 'a', title: 'A', cols: 3, rows: 1, count: 3, gapPt: 8, titleHeightPt: 20 }],
    });
    const ruled = layout({
      page: PAGE,
      blocks: [{ id: 'a', title: 'A', cols: 3, rows: 1, count: 3, gapPt: 8, titleHeightPt: 20, divider: true, dividerGapPt: 9 }],
    });

    expect(ruled.rules).toHaveLength(1);
    expect(ruled.rules[0]).toMatchObject({ page: 0, x: PAGE.marginPt, w: contentW });
    // the rule sits where the title used to start; the title moves down past it
    expect(ruled.rules[0].y).toBeCloseTo(plain.titles[0].y, 5);
    expect(ruled.titles[0].y - plain.titles[0].y).toBeCloseTo(9, 5);
  });

  it('repeats the rule on every page a divided block continues onto', () => {
    const r = layout({
      page: PAGE,
      blocks: [{ id: 'a', title: 'A', cols: 5, rows: 5, count: 30, gapPt: 8, titleHeightPt: 20, divider: true }],
    });
    expect(r.pages).toBe(2);
    expect(r.rules.map((x) => x.page)).toEqual([0, 1]);
  });
});
