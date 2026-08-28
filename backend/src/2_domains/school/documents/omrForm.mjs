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
 *
 * WHAT AN ENTRY IS. The value reported for a filled bubble is the CHOICE TEXT
 * printed under it (`mark.label`, which the renderer took from the question
 * bank), not the bubble's position letter. The bank's answer for a
 * multiple-choice item is that same text — `gradeAnswer` compares
 * `given === item.answer` — so reporting "C" instead of "5/6" scores a
 * perfectly filled sheet zero. A form map old enough to predate `label` falls
 * back to the letter, which is all it can say.
 *
 * An entry value is a STRING, except on a SET-VALUED row (`mark.selection ===
 * 'set'`), where it is an ARRAY of strings in printed left-to-right order — one
 * per filled bubble, even when only one is filled. That row is the companion
 * finish-code gate, where several marks together are the answer, so `ambiguous`
 * would misreport a row that says exactly what it means. The paper is what
 * distinguishes them: the renderer prints `selection` into the form map, and
 * nothing downstream could infer it from a mask. Consumers that assume a string
 * must therefore check — the gate row is its own item type precisely so it can
 * be routed away from the single-choice path before anything grades it.
 */

/** yPt values within this many points are the same physical response row. */
export const ROW_EPSILON_PT = 0.5;
/** The reader has twelve Hollerith channels: 12, 11, 0, 1…9. */
export const CHANNELS = 12;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Group a form map's marks into reader columns.
 *
 * @param {{marks: Array<{itemId: string, choice: string, xPt: number, yPt: number, page?: number, selection?: string}>}} formMap
 * @returns {{ rows: Array<{page: number, yPt: number, columnIndex: number,
 *             choices: Array<{itemId: string, choice: string, label: string|null,
 *                             selection: string|null, xPt: number, bit: number}>}>,
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
      .map((m, bit) => ({
        itemId: m.itemId,
        choice: m.choice,
        // What the child actually read under the bubble; see the header.
        label: typeof m.label === 'string' && m.label !== '' ? m.label : null,
        // How many bubbles this row may claim at once. Carried from the printed
        // form because the PAPER is the only thing that knows: a row that says
        // `set` was printed as a gate row, and nothing downstream of here could
        // tell that from the mask alone. Absent on every form printed before the
        // gate existed, which is exactly the single-choice reading.
        selection: typeof m.selection === 'string' && m.selection !== '' ? m.selection : null,
        xPt: m.xPt,
        bit,
      }));
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
 * @returns {{ entries: Record<string, (string|string[])>, ambiguous: string[], blank: string[], errors: string[] }}
 *   an entry is a string, or an array of strings for a set-valued row; see the header
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
      // A SET-VALUED row reports every hit. It is the finish-code gate: several
      // bubbles in one row is its correct answer, not an eraser and not a guess,
      // so `ambiguous` — which means "the paper cannot say" — would be a lie about
      // a row that says exactly what it means. This branch is also why
      // `ambiguityLeniency` never has to know about the gate item: leniency grades
      // from `entries`, and a set-valued row never reaches it as a two-mark row.
      const isSet = row.choices.some((c) => c.itemId === itemId && c.selection === 'set');
      if (hits.length === 0) blank.push(itemId);
      else if (isSet) entries[itemId] = hits.map((c) => c.label ?? c.choice);
      else if (hits.length > 1) ambiguous.push(itemId);
      else entries[itemId] = hits[0].label ?? hits[0].choice;
    });
  });

  return { entries, ambiguous, blank, errors };
}
