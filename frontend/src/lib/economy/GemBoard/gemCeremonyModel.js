/**
 * Which gems are NEW since a surface last looked — the gem ceremony's model.
 * Pure: a board (`GET /api/v1/earnings/gems`) and the snapshot the surface
 * kept from its last look, in; the awards to celebrate and the next snapshot,
 * out. Design: ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md.
 *
 * An award is a cell that now HOLDS a gem it did not before:
 *   earned / won   a gem paid this week (a count that grew is a new award)
 *   leading        a contest the child just took the lead in
 * A lead that becomes a win is celebrated again ("won"). Nothing is ever
 * celebrated for a loss: a cell that drops back is just remembered.
 *
 * A snapshot is per week. With no snapshot for this week the surface has not
 * looked yet (first load, a reload on another day, a new week): it learns the
 * board silently — a page load is not an achievement.
 */
const HELD = new Set(['earned', 'won', 'leading']);

/** `{week, cells: {learnerId: {categoryId: [state, week]}}}` — what a surface remembers. */
export function gemSnapshot(board) {
  const cells = {};
  for (const [categoryId, byLearner] of Object.entries(board?.cells ?? {})) {
    for (const [learnerId, cell] of Object.entries(byLearner ?? {})) {
      (cells[learnerId] ??= {})[categoryId] = [cell?.state ?? 'none', cell?.week ?? 0];
    }
  }
  return { week: board?.week ?? null, cells };
}

/**
 * @returns {{awards: Array<{learnerId, name, categoryId, label, color, cadence, kind: 'earned'|'won'|'leading', count}>, snapshot: object}}
 */
export function gemAwards(previous, board) {
  const snapshot = gemSnapshot(board);
  if (!board || board.mode === 'off' || !previous || previous.week !== snapshot.week) return { awards: [], snapshot };
  const names = Object.fromEntries((board.learners ?? []).map((l) => [l.learnerId, l.name ?? l.learnerId]));
  const awards = [];
  for (const category of board.categories ?? []) {
    for (const { learnerId } of board.learners ?? []) {
      const cell = board.cells?.[category.id]?.[learnerId];
      if (!cell || !HELD.has(cell.state)) continue;
      const [wasState, wasWeek] = previous.cells?.[learnerId]?.[category.id] ?? ['none', 0];
      const count = cell.week ?? 0;
      const fresh = cell.state === 'leading'
        ? wasState !== 'leading' && wasState !== 'won'
        : (!HELD.has(wasState) || wasState === 'leading' || count > wasWeek);
      if (!fresh) continue;
      awards.push({
        learnerId, name: names[learnerId] ?? learnerId,
        categoryId: category.id, label: category.label, color: category.color, cadence: category.cadence,
        kind: cell.state, count: cell.state === 'leading' ? 0 : Math.max(1, count - (HELD.has(wasState) && wasState !== 'leading' ? wasWeek : 0)),
      });
    }
  }
  return { awards, snapshot };
}
