/**
 * Where a learner IS in a language corpus, said in the teacher's own words.
 *
 * A corpus is a flat run of numbered sentences — glossika-korean is 4143 of
 * them with nothing between `id` and `sentences`. The material a corpus is
 * built from usually does have divisions (three Glossika Fluency volumes of
 * 1000, whose numbering maps onto `seq` exactly), but where a course divides
 * for a given child is a decision about that child, not a property of the
 * text: the same corpus can be cut into volumes for one learner and into
 * months for another. So units are declared on the ENROLLMENT, beside
 * `lessonSize` and `rungs`, which already partition the same corpus.
 *
 * NOT `bands`, which are a different job on a different owner. A band belongs
 * to the corpus and SELECTS material — `scope` names band ids to decide which
 * sentences a learner studies at all. A unit belongs to the enrollment and
 * NAMES a position — it changes what a card says and nothing about what is
 * asked. A sentence can be in no unit and still be studied; it can be in a
 * unit and be out of scope. Merging them would make renaming a chapter change
 * which sentences a child sees.
 *
 * BOUNDARIES, NOT RANGES. Each unit is a starting `seq` and a label; it runs
 * until the next one starts, and the last runs to the end of the corpus. With
 * `from`/`to` pairs a typo of `to: 999` silently drops a sentence into no unit
 * at all, and an overlap silently files one sentence under two names. Neither
 * is representable here.
 *
 * Pure: no clock, no I/O, no entities.
 */

/**
 * Enrollment `units` in the order they run, ignoring entries that cannot name
 * a position. Sorted rather than trusted: YAML is hand-authored, and a list
 * written out of order should still read correctly instead of silently
 * mislabelling every sentence after the misplaced line.
 *
 * @param {Array<{from: number, label: string}>|null} raw
 * @returns {Array<{from: number, label: string}>}
 */
export function normalizeUnits(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((unit) => Number.isInteger(unit?.from) && unit.from >= 1
      && typeof unit.label === 'string' && unit.label.trim())
    .map((unit) => ({ from: unit.from, label: unit.label.trim() }))
    .sort((a, b) => a.from - b.from);
}

/**
 * The unit a sentence sits in, or null when the enrollment declares none.
 *
 * Null is the honest answer for an unpartitioned course, and callers print
 * nothing rather than a placeholder — the reading shelf's own rule, arrived at
 * after a card printed the literal word "Unit" where a name belonged.
 *
 * A sentence before the first declared boundary is also null: a unit list that
 * starts at 1001 says nothing about sentence 4, and inventing a "Unit 0" to
 * hold it would be this function making up curriculum.
 *
 * @param {{units?: Array, seq?: number}} args
 * @returns {{from: number, label: string}|null}
 */
export function unitFor({ units, seq } = {}) {
  if (!Number.isInteger(seq) || seq < 1) return null;
  const ordered = normalizeUnits(units);
  let found = null;
  for (const unit of ordered) {
    if (unit.from > seq) break;
    found = unit;
  }
  return found;
}

/**
 * How far through its own unit a sentence sits, for a progress bar.
 *
 * `total` needs the corpus size to close the LAST unit, which has no successor
 * to end it. Without one the final unit has no denominator and the row is
 * dropped rather than guessed at — `informativeProgressRows` refuses a bar
 * with no positive total anyway.
 *
 * @param {{units?: Array, seq?: number, corpusSize?: number}} args
 * @returns {{label: string, completed: number, total: number}|null}
 */
export function unitProgress({ units, seq, corpusSize } = {}) {
  const unit = unitFor({ units, seq });
  if (!unit) return null;
  const ordered = normalizeUnits(units);
  const next = ordered.find((candidate) => candidate.from > unit.from);
  const end = next ? next.from - 1 : corpusSize;
  if (!Number.isInteger(end) || end < unit.from) return null;
  return {
    label: unit.label,
    completed: Math.min(seq, end) - unit.from + 1,
    total: end - unit.from + 1,
  };
}

export default unitFor;
