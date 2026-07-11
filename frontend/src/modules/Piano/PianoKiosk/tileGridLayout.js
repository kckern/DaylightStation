// tileGridLayout.js
// Pure layout helper for the kiosk tile menus: choose a column count that packs
// `count` tiles into the fewest-empty rectangle, capped at `max` columns, so any
// menu (10-item home, 4-item games) centers into balanced rows instead of
// clumping left in a fixed grid. Mirrors columnsForCount in whoIsPlayingLayout.js
// (that one caps at 4; the tile wall caps at 5).
//
// "Fewest-empty rectangle": among column counts 2..max, pick the one whose grid
// (rows = ceil(count/cols)) wastes the fewest empty cells (rows*cols - count),
// breaking ties toward the widest layout (fewest rows). Column 1 is excluded so a
// prime count (e.g. 7) balances into rows instead of collapsing to a single tall
// column. Examples at max=5:
//   4 → 4×1, 5 → 5×1, 6 → 3×2, 7 → 4+3, 8 → 4×2, 9 → 3×3, 10 → 5×2.

export function balancedColumns(count, { max = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return 1;
  const cap = Math.max(1, Math.floor(max) || 1);

  let bestCols = 1;
  let bestEmpty = Infinity;
  // Ascending scan with `<=` favours the widest column count (fewest rows) on ties.
  for (let cols = 2; cols <= cap; cols++) {
    const rows = Math.ceil(n / cols);
    const empty = rows * cols - n;
    if (empty <= bestEmpty) {
      bestEmpty = empty;
      bestCols = cols;
    }
  }
  return bestCols;
}

export default balancedColumns;
