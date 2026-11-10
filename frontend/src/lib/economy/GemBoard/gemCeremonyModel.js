/**
 * Which gems are NEW since a surface last looked — the gem ceremony's model.
 * Pure: a board (`GET /api/v1/earnings/gems`) and the snapshot the surface
 * kept from its last look, in; the awards to celebrate and the next snapshot,
 * out. Design: ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md.
 *
 * The unit is the RULE, not the board row. A row may fold several rules
 * (Reading = story time + a finished book; Racing = the weekly race + a
 * personal best), and its cell shows only the best of them, so a gem can land
 * in a row whose cell does not move. Each cell lists its rules as `parts`
 * (`ruleId`, `state`, `week`, `label`, `cadence`, `color`); a cell with no
 * parts counts as one part under the row's own id.
 *
 * An award is a rule that now HOLDS a gem it did not before:
 *   earned / won   a gem paid this week (a count that grew is a new award)
 * A contest LEAD is never an award (not a gem yet); a later win is. Nothing is ever
 * celebrated for a loss: a rule that drops back is just remembered. An award
 * is announced as its rule (label, cadence, colour), not as its row.
 *
 * A snapshot is per week and keyed by rule id, so renaming or regrouping a
 * row cannot replay a gem. With no snapshot for this week the surface has not
 * looked yet (first load, a reload on another day, a new week): it learns the
 * board without celebrating — a page load is not an achievement. The same
 * goes for a snapshot in the older per-row shape (no `v: 2`): its keys were
 * row ids, which cannot be compared with rules.
 *
 * A rule whose evidence could not be read this look (`unknown`) is not news
 * either way: the snapshot keeps what it knew of that rule, so a gem that
 * comes back readable on the next look is the same gem, not a new one.
 */
const HELD = new Set(['earned', 'won']);
const VERSION = 2;

/** A cell's rules; a cell that lists none is one part under the row's id. */
const partsOf = (categoryId, cell) => (Array.isArray(cell?.parts) && cell.parts.length
  ? cell.parts
  : [{ ruleId: categoryId, state: cell?.state, week: cell?.week }]);

/**
 * `{week, v: 2, parts: {learnerId: {ruleId: [state, week]}}}` — what a surface remembers.
 * @param {object} board
 * @param {object|null} [previous] - the last look; where this board cannot read
 *   a rule (`unknown`), a same-week `previous` entry for it is carried over
 */
export function gemSnapshot(board, previous = null) {
  const week = board?.week ?? null;
  const known = previous?.v === VERSION && previous.week === week ? previous.parts ?? {} : {};
  const parts = {};
  for (const [categoryId, byLearner] of Object.entries(board?.cells ?? {})) {
    for (const [learnerId, cell] of Object.entries(byLearner ?? {})) {
      const mine = (parts[learnerId] ??= {});
      for (const part of partsOf(categoryId, cell)) {
        const was = part.state === 'unknown' ? known[learnerId]?.[part.ruleId] : null;
        mine[part.ruleId] = was ?? [part.state ?? 'none', part.week ?? 0];
      }
    }
  }
  return { week, v: VERSION, parts };
}

/**
 * @returns {{awards: Array<{learnerId, name, categoryId, ruleId, label, color, cadence, kind: 'earned'|'won', count}>, snapshot: object}}
 *   awards in row order, then roster order, then the row's rule order
 */
export function gemAwards(previous, board) {
  const snapshot = gemSnapshot(board, previous);
  if (!board || board.mode === 'off' || !previous || previous.v !== VERSION || previous.week !== snapshot.week) return { awards: [], snapshot };
  const names = Object.fromEntries((board.learners ?? []).map((l) => [l.learnerId, l.name ?? l.learnerId]));
  const awards = [];
  for (const category of board.categories ?? []) {
    for (const { learnerId } of board.learners ?? []) {
      const cell = board.cells?.[category.id]?.[learnerId];
      if (!cell) continue;
      for (const part of partsOf(category.id, cell)) {
        if (!HELD.has(part.state)) continue;
        const [wasState, wasWeek] = previous.parts?.[learnerId]?.[part.ruleId] ?? ['none', 0];
        const count = part.week ?? 0;
        const fresh = !HELD.has(wasState) || count > wasWeek;
        if (!fresh) continue;
        awards.push({
          learnerId, name: names[learnerId] ?? learnerId,
          categoryId: category.id, ruleId: part.ruleId,
          label: part.label ?? category.label, color: part.color ?? category.color, cadence: part.cadence ?? category.cadence,
          kind: part.state, count: Math.max(1, count - (HELD.has(wasState) ? wasWeek : 0)),
        });
      }
    }
  }
  return { awards, snapshot };
}
