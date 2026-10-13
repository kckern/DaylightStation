/**
 * Detect a worksheet whose marked answers would score meaningfully better
 * under a small row shift than they do literally — the "I put answers in
 * the wrong number ranges" failure mode. Compares against the worksheet's
 * OWN answer key, never a prior scan (that is `omrAlignment.mjs`'s job, a
 * different failure mode: a scanner misreading a card it read correctly
 * before). Never reaches outside this worksheet's own rows.
 *
 * PASSING_FLOOR is a real, separate guard — NOT implied by MARGIN. A shift
 * can gain at most `itemCount - |offset|` matches, which is not bounded
 * tightly enough by MARGIN alone to rule out flagging an already-passing
 * sheet on a large-enough worksheet (verified by a failing proof caught in
 * review; see the "already-passing sheet" test).
 */
const OFFSETS = [-2, -1, 1, 2];

export const MIN_ITEMS = 5;
export const MARGIN = 2;
export const PASSING_FLOOR = 0.7;

export function omrKeyAlignmentSuspect(rows, {
  minItems = MIN_ITEMS, margin = MARGIN, passingFloor = PASSING_FLOOR,
} = {}) {
  if (!Array.isArray(rows) || rows.length < minItems) return null;

  const byRow = new Map(rows.map((row) => [row.row, row]));
  const rowNumbers = rows.map((row) => row.row);
  const minRow = Math.min(...rowNumbers);
  const maxRow = Math.max(...rowNumbers);
  const itemCount = rows.length;
  const literalMatches = rows.filter((row) => row.given === row.correctLetter).length;
  if (literalMatches / itemCount >= passingFloor) return null;

  let best = null;
  for (const offset of OFFSETS) {
    let shiftedMatches = 0;
    for (const row of rows) {
      const shiftedRow = row.row + offset;
      if (shiftedRow < minRow || shiftedRow > maxRow) continue;
      const target = byRow.get(shiftedRow);
      if (target && row.given === target.correctLetter) shiftedMatches += 1;
    }
    if (shiftedMatches - literalMatches >= margin && (!best || shiftedMatches > best.shiftedMatches)) {
      best = { offset, literalMatches, shiftedMatches, itemCount };
    }
  }
  return best;
}

export default omrKeyAlignmentSuspect;
