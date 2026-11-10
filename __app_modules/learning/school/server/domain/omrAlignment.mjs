const canonical = (value) => (Array.isArray(value) ? [...value].sort().join('') : value ?? '');

/** Compare measured marks only, never an answer key. Blank/new rows provide no evidence.
 * Require six matching old answers, three distinct patterns, at least 80% agreement
 * under a shift and four more matches than at their printed positions. A handful
 * of ordinary revisions therefore cannot on its own trigger an alignment refusal.
 */
export function omrAlignmentError(previous = {}, current = {}) {
  for (const base of [1, 26]) {
    for (const offset of [-2, -1, 1, 2]) {
      for (let start = base; start <= base + 19; start++) {
        let compared = 0, aligned = 0, shifted = 0;
        const patterns = new Set();
        for (let end = start; end < base + 25; end++) {
          if (end + offset < base || end + offset >= base + 25) continue;
          const prior = canonical(previous[end]);
          if (!prior) continue;
          compared++;
          if (prior === canonical(current[end])) aligned++;
          if (prior === canonical(current[end + offset])) { shifted++; patterns.add(prior); }
          if (shifted >= 6 && shifted / compared >= 0.8
              && shifted - aligned >= 4 && patterns.size >= 3) {
            return { code: 'OMR_ALIGNMENT', offset, startRow: start, endRow: end,
              compared, alignedMatches: aligned, shiftedMatches: shifted };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Whether two reads of a card carry the same marks on every row. A reader slip
 * (card skewed or misfed) does not reproduce byte-for-byte across separate
 * feeds; a child's real marks do. So a refused read that comes back identical
 * on the next feed is the card's true state, not a slip. 2026-11-03: a child
 * bubbled a worksheet one row high, scanned, saw the result, and re-bubbled it
 * correctly one row lower; the corrected card read identically four times and
 * was refused every time, because the guard took his correction for a slip.
 */
export function sameOmrRead(a = {}, b = {}) {
  const rows = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const row of rows) if (canonical(a?.[row]) !== canonical(b?.[row])) return false;
  return true;
}

/** How long a refused read stays eligible to be confirmed by feeding the card again. */
export const OMR_REFEED_CONFIRM_MS = 24 * 60 * 60 * 1000;

/**
 * Refused reads in a row, none confirmed by a refeed, after which the card is
 * the problem rather than the reader: it is retired and its unfinished work is
 * reprinted on a fresh one (`ReplaceUnreadableCard`). A slip does not repeat,
 * and a child's real marks repeat exactly, so three different reads inside the
 * refeed window mean the paper itself cannot be read the same way twice.
 */
export const UNSALVABLE_REFUSALS = 3;
