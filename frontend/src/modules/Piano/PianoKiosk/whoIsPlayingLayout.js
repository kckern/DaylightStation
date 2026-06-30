// whoIsPlayingLayout.js
// Pure layout helpers for the "Who's playing?" picker: balance a page of faces
// into even-ish rows and split a large roster into pages. No React here so the
// rules are unit-testable in isolation.

export const PICKER_PAGE_SIZE = 9;

/**
 * Column count for one page of `n` faces so rows stay balanced:
 *   ≤4 → single row (n columns); 5–9 → ceil(n/2) columns.
 * So 6 → 3 (3+3), 7 → 4 (4+3), 8 → 4 (4+4), 9 → 5 (5+4).
 */
export function columnsForCount(n) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (count <= 4) return Math.max(1, count);
  return Math.ceil(count / 2);
}

/** Split users into pages of at most `perPage` (default 9), preserving order. */
export function paginatePlayers(users = [], perPage = PICKER_PAGE_SIZE) {
  const size = Math.max(1, Math.floor(perPage) || PICKER_PAGE_SIZE);
  if (!Array.isArray(users) || users.length === 0) return [];
  const pages = [];
  for (let i = 0; i < users.length; i += size) pages.push(users.slice(i, i + size));
  return pages;
}
