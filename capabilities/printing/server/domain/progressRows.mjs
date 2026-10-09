/**
 * Progress-row policy: what counts as PAST, PRESENT and FUTURE on a printed
 * progress bar.
 *
 * A course bar used to carry two states — modules done, and modules not —
 * which filed the module a child is currently working through with the ones
 * they have never opened. On a result receipt that is plainly wrong: they
 * just finished a lesson inside it. "Not started" is the one thing it
 * certainly is not.
 *
 * The rule lives here rather than in `CloseSessionOutcome` because it is a
 * decision about what a child is told, not an orchestration step — and
 * because a three-line boolean buried in a private method is exactly the kind
 * of rule that gets quietly re-derived, differently, by the next surface that
 * needs it.
 *
 * Pure: no clock, no I/O, no entities.
 */

/**
 * How many segments after the completed ones are UNDERWAY. Zero or one, today:
 * a learner is in exactly one module at a time, and a bar that hatched several
 * would be claiming parallel progress nothing tracks.
 *
 * Returns 0 — no present tense at all — when:
 *   - the current module is itself complete. It is already counted in
 *     `completed`, and hatching the NEXT one would mark a module the child
 *     has not opened as though they were in it.
 *   - every module is done. A finished course is all past tense; there is no
 *     segment left to be in.
 *   - the numbers are unusable (missing, negative, or a completed count that
 *     already meets or exceeds the total).
 *
 * @param {object} args
 * @param {number} args.completed - modules finished
 * @param {number} args.total - modules required
 * @param {boolean} args.currentComplete - whether the module just worked in is finished
 * @returns {0|1}
 */
export function inProgressSegments({ completed, total, currentComplete } = {}) {
  if (!Number.isInteger(completed) || !Number.isInteger(total)) return 0;
  if (completed < 0 || total <= 0) return 0;
  if (completed >= total) return 0;
  return currentComplete === true ? 0 : 1;
}

/**
 * The compact fraction is a location marker, not a completion counter.
 * Solid segments remain completed work and hatched segments remain active
 * work, but their shared label names the learner's present position.
 */
export function activeProgressPosition({ completed, total, inProgress } = {}) {
  if (!Number.isInteger(completed) || !Number.isInteger(total)) return 0;
  if (completed < 0 || total <= 0) return 0;
  const active = Number.isInteger(inProgress) && inProgress > 0 ? inProgress : 0;
  return Math.min(total, completed + active);
}

/**
 * Rows worth drawing at all.
 *
 * A bar needs a positive integer total, or it is a divide by zero wearing a
 * label — that much was already enforced, separately, by each renderer.
 *
 * A ONE-UNIT COURSE HAS NO COURSE BAR. Its course row can only ever read
 * "0 of 1" or "1 of 1": a full-width track that restates the unit bar directly
 * beneath it in different words, or an empty one that says the child has not
 * finished the only thing on the card. Neither tells them anything the rest of
 * the card does not, and both cost a row on paper a child reads at a glance.
 * Printed live (Reading Music, one unit): a solid COURSE 1 of 1 sitting above
 * READING MUSIC 29 of 53, where only the second is a journey.
 *
 * Keyed on `scope`, not on the total alone, because a one-lesson UNIT bar is a
 * different statement — "0 of 1" there is a real not-yet — and a producer that
 * omits `scope` keeps its bar rather than losing one to a rule it never opted
 * into.
 *
 * @param {Array|object|null} rows
 * @returns {Array}
 */
export function informativeProgressRows(rows) {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  return list.filter((row) => {
    if (!row || !Number.isInteger(row.total) || row.total <= 0) return false;
    return !(row.scope === 'course' && row.total === 1);
  });
}

export default inProgressSegments;
