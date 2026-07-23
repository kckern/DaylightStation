/**
 * School grade ladder (spec: 6-tier level future-proofing). A material carries
 * at most one `grade:<tier>` Plex label naming the MINIMUM rung at which it is
 * appropriate; the household config carries a visible ceiling. A material shows
 * only when its min-grade rank ≤ the ceiling rank, so advanced content
 * (`high`, `ap`) is authored now but stays dormant until the household grows
 * into it.
 *
 * Two deliberate asymmetries:
 *   - ABSENCE of a grade label = open to all (rank 0), never hidden — matching
 *     the framework's "a restriction only narrows, never hides" rule.
 *   - A PRESENT-but-unknown grade, or an invalid ceiling, FAILS CLOSED (hidden)
 *     rather than exposing content above the intended level.
 *
 * Pure: no I/O, no clock.
 */

export const GRADES = ['early', 'lower', 'upper', 'middle', 'high', 'ap'];

/** Ascending ladder index, or -1 if the tier is not a known grade. */
export function gradeRank(grade) {
  return GRADES.indexOf(String(grade ?? '').toLowerCase());
}

/**
 * The `grade:` tier from a list of Plex label tags (case-insensitive; Plex
 * title-cases stored tags). Returns the lowercased tier, or null if no grade
 * label is present.
 */
export function gradeFromLabels(labels) {
  for (const raw of labels ?? []) {
    const m = /^grade:(.+)$/i.exec(String(raw));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Whether a material with `minGrade` is visible under a household `ceiling`.
 *
 * @param {?string} minGrade - the material's `grade:` tier, or null if unlabelled
 * @param {?string} ceiling  - the household's visible-grade ceiling, or null for no ceiling
 */
export function isVisibleAtCeiling(minGrade, ceiling) {
  if (minGrade == null) return true;            // absence = open to all
  if (ceiling == null) return true;             // no ceiling = show everything
  const min = gradeRank(minGrade);
  if (min === -1) return false;                 // present-but-unknown grade → fail closed
  const cap = gradeRank(ceiling);
  if (cap === -1) return min === 0;             // invalid ceiling → only the lowest rung
  return min <= cap;
}
