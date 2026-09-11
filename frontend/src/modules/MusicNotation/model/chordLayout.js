// MusicNotation model — how the noteheads and accidentals of ONE simultaneity
// are placed across the stem.
//
// Pure position math, no SVG and no glyph metrics, so both hand-rolled staves
// (`SvgStaffRenderer`, `SvgSequenceStaff`) and anything drawn later can share
// one answer. They had a copy of this each, and the copies agreed — on the
// wrong rule, in both directions at once. See `noteheadOffsets`.
//
// Positions are staff half-steps above the bottom line, the convention of
// model/pitch.js and model/stems.js: one step = 1, a third = 2, a fifth = 4.

/** Two noteheads a step apart cannot share a column. */
const SECOND = 1;

/**
 * Which noteheads sit across the stem from the rest.
 *
 * Returns one entry per input position: `0` for the main column, `+1` or `-1`
 * for a head displaced by its own width to the far side of the stem. The sign
 * is already the direction the caller should move it, so a caller multiplies by
 * a notehead width and is done.
 *
 * THE RULE, which both renderers previously had backwards:
 *
 *   stem UP   — the stem is on the RIGHT of the column, so the UPPER note of a
 *               second moves RIGHT, across the stem.
 *   stem DOWN — the stem is on the LEFT, so the LOWER note of a second moves
 *               LEFT, across the stem.
 *
 * What they did instead was displace the lower note leftward on an up-stem and
 * the upper note rightward on a down-stem: the head ends up on the side the
 * stem ISN'T, floating away from the chord with a gap where the stem should
 * have been. In a three-note chord that reads as the MIDDLE note having wandered
 * off on its own, which is exactly what it looks like on a piano-chess rim card.
 *
 * Runs of three or more seconds alternate, because a displaced head has
 * vacated the main column and the head above it can use it again.
 *
 * @param {number[]} positions staff positions, ascending
 * @param {'up'|'down'} direction the group's stem direction (model/stems.js)
 * @returns {number[]} -1 | 0 | +1 per position
 */
export function noteheadOffsets(positions, direction = 'up') {
  const list = Array.isArray(positions) ? positions : [];
  const offsets = list.map(() => 0);
  if (list.length < 2) return offsets;

  if (direction === 'up') {
    // Low to high: the stem is on the right, so seconds push the UPPER head
    // right. Walking upward means each head sees a settled neighbour below it.
    for (let i = 1; i < list.length; i += 1) {
      if (list[i] - list[i - 1] <= SECOND && offsets[i - 1] === 0) offsets[i] = 1;
    }
    return offsets;
  }

  // High to low: the stem is on the left, so seconds push the LOWER head left.
  for (let i = list.length - 2; i >= 0; i -= 1) {
    if (list[i + 1] - list[i] <= SECOND && offsets[i + 1] === 0) offsets[i] = -1;
  }
  return offsets;
}

/**
 * Which accidental goes in which column, left of the noteheads.
 *
 * Column 0 is nearest the heads and each column after it is one glyph further
 * left. An accidental only needs its own column when something already placed
 * would be drawn through it: the glyph is nearly two staff spaces tall, so two
 * accidentals a third apart overlap outright and two a fifth apart do not.
 *
 * The old rule was `index % 2` — alternate columns regardless of how far apart
 * the notes were. That pushed a perfectly clear accidental a column further
 * left for no reason, and on a narrow card the extra column is what ran the
 * glyph into the clef.
 *
 * Placed top down, which is the engraving convention and also the order that
 * keeps a chord's accidentals from looking shuffled.
 *
 * @param {{index: number, position: number}[]} accidentals notes that carry one
 * @param {number} minSeparation staff half-steps two accidentals need to share
 *   a column; callers derive it from the glyph height and their step size
 * @returns {Map<number, number>} note index -> column
 */
export function accidentalColumns(accidentals, minSeparation) {
  const byIndex = new Map();
  const ordered = [...(accidentals || [])].sort((a, b) => b.position - a.position);
  const columns = []; // columns[c] = positions already placed in column c

  for (const entry of ordered) {
    let column = 0;
    while (
      columns[column]
      && columns[column].some((placed) => Math.abs(placed - entry.position) < minSeparation)
    ) {
      column += 1;
    }
    if (!columns[column]) columns[column] = [];
    columns[column].push(entry.position);
    byIndex.set(entry.index, column);
  }

  return byIndex;
}

export default noteheadOffsets;
