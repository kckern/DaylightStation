/**
 * The pass bar in force for one learner on one lesson.
 *
 * 1. A per-lesson override (`YamlPassOverrideStore`) — a grown-up's explicit
 *    call about this lesson, for everyone.
 * 2. The learner's enrollment for the lesson's course — `EnrollLearner` copies
 *    the syllabus's `passing` onto it. It was written and shown in the console
 *    for months and read by nothing; the user decided 2026-10-21 that grading
 *    honors it.
 * 3. The lesson's own authored `passing.percent`.
 *
 * A failed enrollment read falls through to (3): a storage hiccup must never
 * block a grade, and the unit's bar is what grading used before (2) existed.
 */
export async function resolvePassingPercent({ passOverrides = null, assignments = null, learnerId = null, unit = null } = {}) {
  const override = passOverrides?.percentFor?.(unit?.unitId);
  if (Number.isInteger(override)) return override;
  if (assignments && learnerId && unit?.unitId) {
    try {
      const record = await assignments.get(learnerId);
      const courses = (record?.courses ?? []).filter((entry) => entry && typeof entry === 'object');
      // The course this lesson belongs to, matched the way `IssueDocument` and
      // `IssueComposedWorksheet` match it: by course id, else by the lesson
      // appearing in the enrollment's lesson order. An exact id wins.
      const course = courses.find((entry) => unit.courseId && entry.courseId === unit.courseId)
        ?? courses.find((entry) => Object.values(entry.enrollment?.lessonOrder ?? {}).flat().includes(unit.unitId));
      if (Number.isInteger(course?.passing)) return course.passing;
    } catch { /* fall through to the unit's own bar */ }
  }
  return unit?.passing?.percent;
}

/**
 * The bar that decides one SESSION — every look after grading reads this, so
 * the bar never moves under a child already graded (advocacy A4).
 *
 * 1. A stamp: `graded` (screen and hand-marked grading stamp one) or, for a
 *    card scan whose `graded` carries none, the `outcome_recorded` its first
 *    close wrote (both fold into `gradedPassingPercent`).
 * 2. Settled with no stamp anywhere — a session closed before the close
 *    stamped its bar. What decided it then was the pre-Task-16 order,
 *    override ?? the unit's own bar, so that is what a re-close or a grade
 *    correction reads. Reading today's enrollment would re-decide it.
 * 3. Not settled yet: the live bar, in grading's order (`resolvePassingPercent`).
 */
export async function sessionPassingPercent({ state = null, passOverrides = null, assignments = null, unit = null } = {}) {
  if (typeof state?.gradedPassingPercent === 'number') return state.gradedPassingPercent;
  if (state?.outcome) {
    const override = passOverrides?.percentFor?.(unit?.unitId);
    return Number.isInteger(override) ? override : unit?.passing?.percent;
  }
  return resolvePassingPercent({ passOverrides, assignments, learnerId: state?.learnerId ?? null, unit });
}
