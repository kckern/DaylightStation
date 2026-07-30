// tileGridLayout.js
// Pure layout helper for the kiosk tile menus: choose a column count so a menu
// (10-item home, 4-item games) fills the FEWEST rows that fit within `max`
// columns, then widens to spread those rows evenly and centre. A kiosk tile
// menu sits above the keyboard, so minimising rows (staying above the fold)
// matters more than a perfectly square grid. Mirrors columnsForCount in
// lib/identity/profilePickerLayout.js (that one caps at 4; the tile wall caps at 5).
//
// rows = ceil(count / max); cols = min(max, ceil(count / rows)). This stays
// wide and short for ANY count instead of collapsing large counts into narrow,
// tall grids (a pure fewest-empty scan gives 13 → 2×7, which clumps vertically
// — worse than the horizontal clumping this helper exists to fix). Examples at
// max=5: 4 → 4×1, 5 → 5×1, 6 → 3+3, 7 → 4+3, 8 → 4×2, 9 → 5+4, 10 → 5×2,
// 13 → 5+5+3.

export function balancedColumns(count, { max = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return 1;
  const cap = Math.max(1, Math.floor(max) || 1);
  const rows = Math.ceil(n / cap);
  return Math.min(cap, Math.ceil(n / rows));
}

// balancedGrid — like balancedColumns, but for a wall that must fit ONE
// viewport with NO vertical scroll (the course grid at /piano/videos), instead
// of a fixed-max tile menu whose few rows already fit above the fold. Unlike
// balancedColumns, this ALSO guarantees balance: with plain CSS grid
// auto-placement (`repeat(cols, 1fr)`, items filling row-major), a `rows ×
// cols` split lays out as (rows-1) full rows of `cols` plus one final row of
// `n - (rows-1)*cols` — so "no row differs from another by more than 1" is
// exactly the condition `rows*cols - n <= 1` ("waste" — the empty slots in
// that last row). balancedColumns' cap-then-ceil heuristic does NOT guarantee
// this (e.g. count=30 gives 4 rows × 8 cols = 32 slots, waste 2 → rows of
// 8/8/8/6); only a subset of counts happen to land on waste ≤ 1.
//
// A `rows × cols` split (cols = ceil(n / rows)) is balanced iff
// `n % rows === 0` (waste 0) or `n % rows === rows - 1` (waste 1) — every
// other `rows` value wastes 2+ slots in the last row. Balanced splits exist
// for EVERY n (rows = 1 and rows = n both trivially qualify), so the picker
// searches for one instead of computing cols directly:
//
//   1. Start from `rows0`, the row count balancedColumns' cap heuristic would
//      pick (cap scales with count — see below — so a big library prefers
//      more/narrower columns over an ever-taller stack).
//   2. Search outward from `rows0` (rows0, rows0∓1, rows0∓2, ...) for the
//      NEAREST `rows` that balances, checking the fewer-rows candidate first
//      at each distance (bigger tiles win a tie).
//
// The cap grows with count (min 5, ~sqrt(count)) so a bigger course library
// adds both rows and columns rather than stacking an ever-taller 5-wide
// column (cheap to add: a kiosk's landscape viewport has more horizontal
// room than vertical, and CSS shrinks tile width for free — rows are
// expensive, each eating into the fixed viewport height).
//
// Examples: 1-3 → 1×n (single row). 10 → 2×5 (waste 0). 11 → 3 rows, 4×4×3
// (waste 1, not a ragged 5+5+1). 13 → rows0=3 isn't balanced (13%3=1≠2); the
// nearest balanced neighbour is rows=2, cols=7 (waste 1). 30 → rows0=4 isn't
// balanced (30%4=2); nearest is rows=3, cols=10 (waste 0, 10/10/10).
export function balancedGrid(count, { minCols = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return { rows: 1, cols: Math.max(1, n) };
  const floor = Math.max(1, Math.floor(minCols) || 1);
  const cap = Math.max(floor, Math.round(Math.sqrt(n * 2.5)));
  const rows0 = Math.max(1, Math.ceil(n / cap));

  const isBalanced = (rows) => {
    const rem = n % rows;
    return rem === 0 || rem === rows - 1;
  };

  // rows = n is always balanced (rem === 0), so this loop always terminates
  // at or before delta = n - rows0 — it never falls through to the return
  // below (kept only as a defensive, unreachable fallback).
  for (let delta = 0; delta < n; delta++) {
    const below = rows0 - delta;
    if (below >= 1 && isBalanced(below)) return { rows: below, cols: Math.ceil(n / below) };
    const above = rows0 + delta;
    if (delta > 0 && above <= n && isBalanced(above)) return { rows: above, cols: Math.ceil(n / above) };
  }
  /* istanbul ignore next -- unreachable, see loop comment above */
  return { rows: n, cols: 1 };
}

export default balancedColumns;
