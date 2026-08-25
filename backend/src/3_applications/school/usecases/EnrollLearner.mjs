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
import { materializeTiming, studyDate } from '#domains/school/timing.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { assertNotStale } from './staleSaveGuard.mjs';

export class EnrollLearner {
  #syllabi; #assignments; #curriculum; #sessions; #timingAnchors; #teacherGate; #clock; #timezone; #rng; #logger;

  constructor({ syllabi, assignments, curriculum, sessions = null, timingAnchors = null, teacherGate, clock = () => new Date(), timezone = null, rng = Math.random, logger = console } = {}) {
    if (!syllabi) throw new Error('EnrollLearner requires a syllabi store');
    if (!assignments) throw new Error('EnrollLearner requires an assignments store');
    if (!curriculum) throw new Error('EnrollLearner requires curriculum access');
    if (!teacherGate) throw new Error('EnrollLearner requires a teacherGate');
    this.#syllabi = syllabi;
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#timingAnchors = timingAnchors;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#timezone = timezone;
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
  async execute({ learnerId, syllabusId, timingAnchorId = null, enrolledBy = null, pin = null, rematerialize = false, baseUpdatedAt = undefined } = {}) {
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

    // `CurriculumAccess.getWork(id)` is keyed `'<subject>/<work>'`; `courseId`
    // here is the bare work name, so resolve it the same way every other
    // production caller does (BuildAgenda, schoolLifecycle) — via listWorks().
    const works = (await this.#curriculum.listWorks?.()) ?? [];
    const work = works.find((w) => w.work === courseId) ?? null;
    const policy = { ...(work?.progression ?? {}), ...(syllabus.policy ?? {}) };
    const nowIso = this.#clock().toISOString();
    const today = studyDate(nowIso, this.#timezone);

    const enrollment = createCourseEnrollment({
      enrollmentId: `enr-${learnerId}-${courseId}`,
      courseId,
      profile: syllabus.profile,
      units: courseUnits,
      modules: work?.modules ?? [],
      policy,
      display: work ? { title: work.title, shortTitle: work.short_title } : null,
      today,
      rng: this.#rng,
    });

    // A re-materialize overlays the newly computed fields onto whatever the
    // prior entry held — not a from-scratch object. `elective` is live
    // planner input (planner.mjs sorts required work ahead of electives), so
    // discarding it here would silently promote an elective course to
    // required on the next agenda build. `enrolledAt` is likewise preserved:
    // it names when the learner was FIRST enrolled, not when they were last
    // re-materialized. A bare-string prior entry (no object, no fields to
    // carry forward) contributes nothing here, which is correct.
    const priorEntry = indexOf !== -1 ? courses[indexOf] : null;
    const priorObj = (priorEntry && typeof priorEntry === 'object') ? priorEntry : {};
    let timing = priorObj.timing ?? null;
    if (syllabus.timingTemplate) {
      const anchorId = timingAnchorId ?? syllabus.timingTemplate.defaultAnchorId;
      if (!anchorId || !this.#timingAnchors) {
        throw new ValidationError(`${courseId} has a timing template but no timing anchor is available`);
      }
      const anchor = await this.#timingAnchors.get(anchorId);
      if (!anchor) throw new ValidationError(`unknown timing anchor: '${anchorId}'`);
      try {
        timing = materializeTiming(syllabus.timingTemplate, anchor, { today });
      } catch (error) {
        throw new ValidationError(`invalid timing for ${courseId}: ${error.message}`);
      }
    }

    const entry = {
      ...priorObj,
      courseId,
      profile: syllabus.profile ?? null,
      syllabusId: syllabus.syllabusId,
      passing: syllabus.passing,
      enrolledAt: priorObj.enrolledAt ?? nowIso,
      enrollment,
      ...(timing ? { timing } : {}),
    };
    if (indexOf === -1) courses.push(entry); else courses[indexOf] = entry;

    const record = await this.#assignments.put({
      learnerId,
      courses,
      units: current?.units ?? [],
      programs: current?.programs ?? [],
      assignedBy: enrolledBy,
      updatedAt: nowIso,
    });
    // Carries the policy-bearing fields, not just the ids: a later review of
    // "why was this worksheet at this level / graded at this bar" is answered
    // by the enrollment that was in force, and re-materializing can change
    // both without any other record of the previous values.
    this.#logger.info?.('school.enrollment.materialized', {
      learnerId, courseId, syllabusId: syllabus.syllabusId, rematerialize,
      profile: syllabus.profile ?? null,
      passing: syllabus.passing ?? null,
      modules: enrollment.moduleOrder.length,
      optionalModules: enrollment.optionalModules.length,
      lessons: Object.values(enrollment.lessonOrder ?? {}).reduce((n, l) => n + l.length, 0),
    });
    return record;
  }
}

export default EnrollLearner;
