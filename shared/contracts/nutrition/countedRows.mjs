/**
 * Which day-log rows count — the ONE predicate.
 * @module shared/contracts/nutrition/countedRows
 *
 * The calorie equation, the day's macro sums, the per-meal `P · C · F`
 * subtotals and the Today footer all fold the same rows, so they all fold them
 * the same way. A second, subtly different fold is how the kcal number and the
 * macro bars end up disagreeing on one screen, which is worse than not showing
 * the bars at all — and the disagreement would be invisible until the day a
 * `pending` row exists, because today every live row is `accepted`.
 *
 * Shared deliberately: `BudgetService` (server, authoritative) and the Today
 * components (client, display) import this same file rather than each spelling
 * the status list out.
 */

/**
 * Statuses that keep a row OUT of every total.
 *
 * `pending` — a capture nobody has committed (the kitchen-scale composition
 * flow still mints these). `rejected` / `deleted` — resolved away.
 *
 * `settled` is NOT here and never will be: it is an orthogonal review axis, and
 * an unsettled row counts the moment it is captured.
 */
export const UNCOUNTED_STATUSES = Object.freeze(['pending', 'rejected', 'deleted']);

/** True when this row belongs in the day's totals. A row with no status counts. */
export function isCountedRow(row) {
  return !UNCOUNTED_STATUSES.includes(row?.status);
}

/**
 * Sum one numeric field over the counted rows.
 *
 * Group rows carry ZERO nutrition by design (their children hold the real
 * values as siblings in the same flat list), so summing every counted row
 * counts each food exactly once — no group special-casing, here or in any
 * caller.
 */
export function sumCounted(rows, key) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce((sum, row) => {
    if (!isCountedRow(row)) return sum;
    const value = Number(row?.[key]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}
