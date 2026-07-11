// tileGridLayout.js
// Pure layout helper for the kiosk tile menus: choose a column count so a menu
// (10-item home, 4-item games) fills the FEWEST rows that fit within `max`
// columns, then widens to spread those rows evenly and centre. A kiosk tile
// menu sits above the keyboard, so minimising rows (staying above the fold)
// matters more than a perfectly square grid. Mirrors columnsForCount in
// whoIsPlayingLayout.js (that one caps at 4; the tile wall caps at 5).
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

export default balancedColumns;
