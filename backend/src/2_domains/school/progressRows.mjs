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

export default inProgressSegments;
