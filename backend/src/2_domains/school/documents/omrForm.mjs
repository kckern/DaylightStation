/**
 * Turning a scanned bubble sheet back into answers (spec §3.3, §7.1). Pure: no
 * I/O, no clock.
 *
 * The renderer emits a FORM MAP alongside every OMR document — the exact
 * coordinates of every bubble it printed — and the reader emits one 12-bit mask
 * per column. This module is the join: form map + mask array → `itemId → choice`.
 *
 * PROJECTION (must stay in step with `#adapters/hardware/omr/VirtualOmrReader`,
 * which encodes the same mapping in the other direction):
 *   - a response ROW is a set of marks sharing a page and a y within
 *     `ROW_EPSILON_PT`; rows sort by page then y, and their index IS the reader
 *     column index;
 *   - within a row, bubbles sort left to right by x, and their index IS the bit.
 * Both are ORDINAL, not physical: no off-the-shelf card fits this reader yet, so
 * there is no pitch to project onto. When a real card geometry lands, both sides
 * change together and this module's OUTPUT shape does not.
 *
 * Grading policy is emphatically NOT here. This module reports what the paper
 * says, including that it cannot tell — `ambiguous` (two marks in a row) and
 * `blank` (none) are first-class results, because the one thing worse than an
 * unreadable answer is a guessed one scored as fact.
 */

/** yPt values within this many points are the same physical response row. */
export const ROW_EPSILON_PT = 0.5;
/** The reader has twelve Hollerith channels: 12, 11, 0, 1…9. */
export const CHANNELS = 12;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Group a form map's marks into reader columns.
 *
 * @param {{marks: Array<{itemId: string, choice: string, xPt: number, yPt: number, page?: number}>}} formMap
 * @returns {{ rows: Array<{page: number, yPt: number, columnIndex: number,
 *             choices: Array<{itemId: string, choice: string, xPt: number, bit: number}>}>,
 *            errors: string[] }}
 */
export function projectFormMap(formMap) {
  const errors = [];
  const marks = Array.isArray(formMap?.marks) ? formMap.marks : [];
  if (!marks.length) return { rows: [], errors: ['formMap.marks must be a non-empty array'] };

  const rows = [];
  marks.forEach((mark, i) => {
    if (!mark || typeof mark.itemId !== 'string' || typeof mark.choice !== 'string'
      || !isFiniteNumber(mark.xPt) || !isFiniteNumber(mark.yPt)) {
      errors.push(`marks[${i}]: needs itemId, choice, xPt, yPt`);
      return;
    }
    const page = Number.isInteger(mark.page) ? mark.page : 1;
    const row = rows.find((r) => r.page === page && Math.abs(r.yPt - mark.yPt) <= ROW_EPSILON_PT);
    if (row) row.marks.push(mark);
    else rows.push({ page, yPt: mark.yPt, marks: [mark] });
  });

  rows.sort((a, b) => (a.page - b.page) || (a.yPt - b.yPt));

  const projected = rows.map((row, columnIndex) => {
    if (row.marks.length > CHANNELS) {
      errors.push(`page ${row.page} y=${row.yPt}: ${row.marks.length} bubbles in one row; the reader has ${CHANNELS} channels`);
    }
    const choices = [...row.marks]
      .sort((a, b) => a.xPt - b.xPt)
      .map((m, bit) => ({ itemId: m.itemId, choice: m.choice, xPt: m.xPt, bit }));
    return { page: row.page, yPt: row.yPt, columnIndex, choices };
  });

  return { rows: projected, errors };
}

/**
 * Read a scanned sheet against the form map that produced the paper.
 *
 * @param {object} args
 * @param {object} args.formMap - the renderer's artifact for this exact sheet
 * @param {{marks: number[]}} args.sheet - the reader's normalised event
 * @returns {{ entries: Record<string, string>, ambiguous: string[], blank: string[], errors: string[] }}
 */
export function decodeOmrSheet({ formMap, sheet } = {}) {
  const { rows, errors: projectionErrors } = projectFormMap(formMap);
  const errors = [...projectionErrors];
  const masks = Array.isArray(sheet?.marks) ? sheet.marks : null;
  if (!masks) {
    return { entries: {}, ambiguous: [], blank: [], errors: [...errors, 'sheet.marks must be an array'] };
  }
  // A sheet with a different column count than the form printed is a different
  // sheet — feeding it through would score one child's answers against another
  // child's paper, so it is refused rather than partially decoded.
  if (masks.length !== rows.length) {
    errors.push(`sheet has ${masks.length} columns but this form printed ${rows.length}`);
    return { entries: {}, ambiguous: [], blank: [], errors };
  }

  const entries = {};
  const ambiguous = [];
  const blank = [];

  rows.forEach((row) => {
    const mask = Number(masks[row.columnIndex]) || 0;
    const items = [...new Set(row.choices.map((c) => c.itemId))];
    items.forEach((itemId) => {
      const hits = row.choices.filter((c) => c.itemId === itemId && (mask & (1 << c.bit)) !== 0);
      if (hits.length === 0) blank.push(itemId);
      else if (hits.length > 1) ambiguous.push(itemId);
      else entries[itemId] = hits[0].choice;
    });
  });

  return { entries, ambiguous, blank, errors };
}
