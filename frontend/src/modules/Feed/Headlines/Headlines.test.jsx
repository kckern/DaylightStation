import { describe, expect, test } from 'vitest';
import { buildHeadlineGrid } from './buildHeadlineGrid.js';

describe('buildHeadlineGrid', () => {
  test('uses explicit zero-based placement independently of row and column labels', () => {
    const grid = buildHeadlineGrid({
      first: { label: 'First', row: 0, col: 1 },
      second: { label: 'Second', row: 1, col: 0 },
    }, ['lead', 'briefs'], ['left', 'right']);

    expect(grid[0][1]).toMatchObject({ id: 'first', gridRow: 'lead', gridCol: 'right' });
    expect(grid[1][0]).toMatchObject({ id: 'second', gridRow: 'briefs', gridCol: 'left' });
    expect(grid[0][0]).toBeNull();
  });
});
