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
