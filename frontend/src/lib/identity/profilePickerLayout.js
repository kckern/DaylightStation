// profilePickerLayout.js
// Pure layout helpers for the "Who's playing?" picker: balance a page of faces
// into even-ish rows and split a large roster into pages. No React here so the
// rules are unit-testable in isolation.

// A full page is a 3×2 grid (6 faces); larger rosters paginate.
export const PICKER_PAGE_SIZE = 6;

/**
 * Column count for one page of `n` faces, balanced into the fewest-empty
 * rectangle: keep up to 4 in a single row, then add rows (rows = ceil(n/4)) and
 * spread evenly (cols = ceil(n/rows)). This favours tidy grids over a ragged
 * trailing row — 6 → 3×2, 8 → 4×2, 9 → 3×3 (no empty cell), 5 → 3+2, 7 → 4+3.
 */
export function columnsForCount(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (count <= 1) return 1;
  const rows = Math.ceil(count / 4);
  return Math.ceil(count / rows);
}

/** Split users into pages of at most `perPage` (default 6), preserving order. */
export function paginatePlayers(users = [], perPage = PICKER_PAGE_SIZE) {
  const size = Math.max(1, Math.floor(perPage) || PICKER_PAGE_SIZE);
  if (!Array.isArray(users) || users.length === 0) return [];
  const pages = [];
  for (let i = 0; i < users.length; i += size) pages.push(users.slice(i, i + size));
  return pages;
}
