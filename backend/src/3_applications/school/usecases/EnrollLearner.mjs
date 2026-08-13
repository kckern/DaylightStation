/**
 * EnrollLearner — materialize a syllabus onto a learner (see
 * docs/reference/school/enrollment.md §4).
 *
 * `createCourseEnrollment` already existed, was tested, and was called by
 * nothing: every enrollment in production was hand-typed YAML. This is its
 * caller. The record it returns is written onto the learner's assignment
 * entry, which is exactly where `planner.mjs` already reads it — so nothing
 * about the runtime changes.
 *
 * Materialization is a SNAPSHOT. `lessonOrder` is persisted precisely so a
 * `shuffle_once` order cannot move under a learner mid-course, which means a
 * later syllabus edit does not reach existing enrollments; re-materializing is
 * an explicit act, and it is refused while any session on that course is open
 * (a session on a lesson leaving the enrollment would strand).
 */
import { createCourseEnrollment } from '#domains/school/curriculum/enrollment.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { assertNotStale } from './staleSaveGuard.mjs';

export class EnrollLearner {
  #syllabi; #assignments; #curriculum; #sessions; #teacherGate; #clock; #rng; #logger;

  constructor({ syllabi, assignments, curriculum, sessions = null, teacherGate, clock = () => new Date(), rng = Math.random, logger = console } = {}) {
    if (!syllabi) throw new Error('EnrollLearner requires a syllabi store');
    if (!assignments) throw new Error('EnrollLearner requires an assignments store');
    if (!curriculum) throw new Error('EnrollLearner requires curriculum access');
    if (!teacherGate) throw new Error('EnrollLearner requires a teacherGate');
    this.#syllabi = syllabi;
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#rng = rng;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.syllabusId
   * @param {string} args.enrolledBy - a roster id that must pass TeacherGate
   *   (the gate is a required constructor dependency and is always asserted)
   * @param {string|null} [args.pin]
   * @param {boolean} [args.rematerialize] - re-run the materializer over an
   *   existing entry, re-shuffling any `shuffle_once` ordering
   * @param {string|null} [args.baseUpdatedAt] - the assignment `updatedAt` the
   *   caller loaded; a mismatch is a 409 rather than a silent clobber
   * @returns {Promise<object>} the stored assignment record
   */
  async execute({ learnerId, syllabusId, enrolledBy = null, pin = null, rematerialize = false, baseUpdatedAt = undefined } = {}) {
    this.#teacherGate.assert({ userId: enrolledBy, pin, action: 'enrollment.put', context: { learnerId, syllabusId } });

    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');

    const syllabus = await this.#syllabi.get(syllabusId);
    if (!syllabus || syllabus.archivedAt) throw new ValidationError(`unknown syllabus: '${syllabusId}'`);
    const { courseId } = syllabus;

    const current = await this.#assignments.get(learnerId);
    assertNotStale(current, baseUpdatedAt);

    const courses = [...(current?.courses ?? [])];
    const indexOf = courses.findIndex((entry) => (typeof entry === 'string' ? entry : entry?.courseId) === courseId);
    if (indexOf !== -1 && !rematerialize) {
      throw new ValidationError(`${learnerId} is already enrolled in ${courseId} — re-materialize instead`);
    }

    const allUnits = (await this.#curriculum.listUnits()) ?? [];
    const courseUnits = allUnits.filter((u) => u?.courseId === courseId);
    if (!courseUnits.length) throw new ValidationError(`${courseId} publishes no units`);

    // Re-shuffling under a learner who is mid-worksheet would change the order
    // of work they are holding. Refuse, naming the sessions; the teacher can
    // close or abandon them and try again.
    if (rematerialize && this.#sessions) {
      const inCourse = new Set(courseUnits.map((u) => u.unitId));
      const open = ((await this.#sessions.listOpenForLearner(learnerId)) ?? [])
        .filter((row) => row?.unitId && inCourse.has(row.unitId));
      if (open.length) {
        const err = new ValidationError(
          `${learnerId} has ${open.length} open session${open.length === 1 ? '' : 's'} on ${courseId} — close or abandon them before re-materializing`,
        );
        err.code = 'OPEN_SESSIONS';
        err.status = 409;
        err.details = { sessions: open.map((r) => ({ sessionId: r.sessionId, unitId: r.unitId, state: r.state })) };
        throw err;
      }
    }

    const work = await this.#curriculum.getWork?.(courseId);
    const policy = { ...(work?.progression ?? {}), ...(syllabus.policy ?? {}) };
    const nowIso = this.#clock().toISOString();

    const enrollment = createCourseEnrollment({
      enrollmentId: `enr-${learnerId}-${courseId}`,
      courseId,
      profile: syllabus.profile,
      units: courseUnits,
      policy,
      rng: this.#rng,
    });

    const entry = {
      courseId,
      ...(syllabus.profile ? { profile: syllabus.profile } : {}),
      syllabusId: syllabus.syllabusId,
      ...(syllabus.passing !== null ? { passing: syllabus.passing } : {}),
      enrolledAt: nowIso,
      enrollment,
    };
    if (indexOf === -1) courses.push(entry); else courses[indexOf] = entry;

    const record = await this.#assignments.put({
      learnerId,
      courses,
      units: current?.units ?? [],
      assignedBy: enrolledBy,
      updatedAt: nowIso,
    });
    this.#logger.info?.('school.enrollment.materialized', {
      learnerId, courseId, syllabusId: syllabus.syllabusId, rematerialize,
      modules: enrollment.moduleOrder.length,
    });
    return record;
  }
}

export default EnrollLearner;
