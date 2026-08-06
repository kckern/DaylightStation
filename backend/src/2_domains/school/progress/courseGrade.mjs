/**
 * Course-grade projection: best-of-per-unit, then mean across attempted
 * units. A retake must IMPROVE the grade, never dilute it into a mean over
 * every attempt — so each unit contributes its single best graded session,
 * and only units with at least one graded session enter the course mean.
 *
 * Pure: no I/O, no clock, no imports outside this file.
 */

export const COURSE_GRADE_POLICY = 'best-of-unit-mean-v1';

function isInWindow(updatedAt, window) {
  if (!window) return true;
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  if (window.startsAt && t < Date.parse(window.startsAt)) return false;
  if (window.endsAt && t > Date.parse(window.endsAt)) return false;
  return true;
}

function isGraded(session) {
  return session.gradedPercent !== null && session.gradedPercent !== undefined;
}

/**
 * @param {object} args
 * @param {Array<{sessionId:string, learnerId:string, unitId:string|null, state:*, result:string|null, gradedPercent:number|null, updatedAt:string|null}>} args.sessions
 * @param {string} args.courseId
 * @param {string[]} args.unitIds
 * @param {{startsAt?:string, endsAt?:string}|null} [args.window]
 */
export function courseGradeFromSessions({ sessions, courseId, unitIds, window = null }) {
  const unitGrades = unitIds.map((unitId) => {
    const inWindowSessions = sessions.filter(
      (session) => session.unitId === unitId && isInWindow(session.updatedAt, window)
    );
    const gradedSessions = inWindowSessions.filter(isGraded);
    const bestPercent = gradedSessions.length
      ? Math.max(...gradedSessions.map((session) => session.gradedPercent))
      : null;
    const passed = inWindowSessions.some((session) => session.result === 'passed');
    const attempts = gradedSessions.length;
    return { unitId, bestPercent, passed, attempts };
  });

  const gradedUnits = unitGrades.filter((unit) => unit.bestPercent !== null);
  const coursePercent = gradedUnits.length
    ? Math.round(
        (gradedUnits.reduce((sum, unit) => sum + unit.bestPercent, 0) / gradedUnits.length) * 100
      ) / 100
    : null;

  return { courseId, policy: COURSE_GRADE_POLICY, coursePercent, unitGrades };
}
