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
// of a fixed-max tile menu whose few rows already fit above the fold.
//
// Reuses the exact same "fewest rows within a cap, then widen to balance"
// algorithm — rows = ceil(count / cap); cols = min(cap, ceil(count / rows)) —
// but the cap ISN'T fixed at 5. It scales up with count (min 5, growing
// ~sqrt(count)), so a big course library adds BOTH more rows and more columns
// rather than stacking an ever-taller 5-wide column (which is what would force
// scrolling). Columns are cheap to add (a kiosk's landscape viewport has more
// horizontal room than vertical, and CSS shrinks tile width for free); rows
// are expensive (each one eats into the fixed viewport height), so the cap
// grows faster than a 1:1 rows:cols trade would.
//
// Examples: 1-3 → 1×n (single row). 10 → cap 5 → 2×5. 11 → cap 5 → 3 rows,
// 4×4×3 (not a ragged 5+5+1). 30 → cap 9 → 4 rows, 8×8×8×6 (≥6 cols, so the
// wall widens instead of stacking a 6th row of 5).
export function balancedGrid(count, { minCols = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return { rows: 1, cols: Math.max(1, n) };
  const floor = Math.max(1, Math.floor(minCols) || 1);
  const cap = Math.max(floor, Math.round(Math.sqrt(n * 2.5)));
  const rows = Math.ceil(n / cap);
  const cols = Math.min(cap, Math.ceil(n / rows));
  return { rows, cols };
}

export default balancedColumns;
