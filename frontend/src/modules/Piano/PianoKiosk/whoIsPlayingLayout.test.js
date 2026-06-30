import { describe, it, expect } from 'vitest';
import { columnsForCount, paginatePlayers, PICKER_PAGE_SIZE } from './whoIsPlayingLayout.js';

describe('columnsForCount — balanced rows', () => {
  it('keeps ≤4 faces in a single row', () => {
    expect(columnsForCount(1)).toBe(1);
    expect(columnsForCount(3)).toBe(3);
    expect(columnsForCount(4)).toBe(4);
  });
  it('splits 5–9 into even-ish rows via ceil(n/2)', () => {
    expect(columnsForCount(5)).toBe(3); // 3 + 2
    expect(columnsForCount(6)).toBe(3); // 3 + 3
    expect(columnsForCount(7)).toBe(4); // 4 + 3 (orphan centers)
    expect(columnsForCount(8)).toBe(4); // 4 + 4
    expect(columnsForCount(9)).toBe(5); // 5 + 4
  });
  it('never returns less than one column', () => {
    expect(columnsForCount(0)).toBe(1);
  });
});

describe('paginatePlayers', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
  it('returns a single page when within the page size', () => {
    expect(paginatePlayers(make(9))).toHaveLength(1);
    expect(paginatePlayers(make(9))[0]).toHaveLength(9);
  });
  it('splits into pages of PICKER_PAGE_SIZE, preserving order', () => {
    const pages = paginatePlayers(make(10));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(PICKER_PAGE_SIZE);
    expect(pages[1]).toHaveLength(1);
    expect(pages[1][0].id).toBe('u9');
  });
  it('returns no pages for an empty roster', () => {
    expect(paginatePlayers([])).toEqual([]);
  });
});
