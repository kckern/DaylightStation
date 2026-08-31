/**
 * UnenrollLearner — drop a course entry from a learner's assignment record.
 *
 * Carries the same open-session refusal as re-materializing (EnrollLearner):
 * removing the entry while a session on that course is open leaves the session
 * open forever and off the agenda, which is the ghost-session failure this
 * codebase has been bitten by before.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { StateConflictError } from '#apps/common/errors/SemanticErrors.mjs';
import { assertNotStale } from './staleSaveGuard.mjs';

export class UnenrollLearner {
  #assignments; #curriculum; #sessions; #teacherGate; #realtime; #clock; #logger;

  /**
   * @param {object} args
   * @param {object} args.assignments - store with get(learnerId) and put(record) methods
   * @param {object} args.curriculum - curriculum access with listUnits() method
   * @param {object} [args.sessions] - session store with listOpenForLearner(learnerId) method
   * @param {object} args.teacherGate - authorization gate (required); has assert(action, context) method
   * @param {Function} [args.clock] - function returning current Date
   * @param {object} [args.logger] - logger with info/warn methods
   */
  constructor({ assignments, curriculum, sessions = null, teacherGate, realtime = null, clock = () => new Date(), logger = console } = {}) {
    if (!assignments) throw new Error('UnenrollLearner requires an assignments store');
    if (!curriculum) throw new Error('UnenrollLearner requires curriculum access');
    if (!teacherGate) throw new Error('UnenrollLearner requires a teacherGate');
    this.#assignments = assignments;
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#realtime = realtime;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * Remove a course entry from a learner's assignment record.
   *
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.courseId
   * @param {string} [args.removedBy] - a roster id that must pass TeacherGate
   * @param {string|null} [args.pin]
   * @param {string|null} [args.baseUpdatedAt] - the assignment updatedAt the caller loaded;
   *   a mismatch is refused rather than silently clobbered
   * @returns {Promise<object>} the stored assignment record
   * @throws {ValidationError} if not enrolled, on stale save, or on open sessions
   */
  async execute({ learnerId, courseId, removedBy = null, pin = null, baseUpdatedAt = undefined } = {}) {
    this.#teacherGate.assert({ userId: removedBy, pin, action: 'enrollment.delete', context: { learnerId, courseId } });

    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (typeof courseId !== 'string' || !courseId.trim()) throw new ValidationError('courseId is required');

    const current = await this.#assignments.get(learnerId);
    assertNotStale(current, baseUpdatedAt);

    const courses = [...(current?.courses ?? [])];
    const indexOf = courses.findIndex((entry) => (typeof entry === 'string' ? entry : entry?.courseId) === courseId);
    if (indexOf === -1) throw new ValidationError(`${learnerId} is not enrolled in ${courseId}`);

    if (this.#sessions) {
      const inCourse = new Set(((await this.#curriculum.listUnits()) ?? [])
        .filter((u) => u?.courseId === courseId).map((u) => u.unitId));
      const open = ((await this.#sessions.listOpenForLearner(learnerId)) ?? [])
        .filter((row) => row?.unitId && inCourse.has(row.unitId));
      if (open.length) {
        throw new StateConflictError(
          `${learnerId} has ${open.length} open session${open.length === 1 ? '' : 's'} on ${courseId} — close or abandon them before unenrolling`,
          {
            code: 'OPEN_SESSIONS',
            details: { sessions: open.map((r) => ({ sessionId: r.sessionId, unitId: r.unitId, state: r.state })) },
          },
        );
      }
    }

    courses.splice(indexOf, 1);
    const record = await this.#assignments.put({
      learnerId,
      courses,
      units: current?.units ?? [],
      programs: current?.programs ?? [],
      assignedBy: removedBy,
      updatedAt: this.#clock().toISOString(),
    });
    this.#logger.info?.('school.enrollment.removed', { learnerId, courseId, removedBy });
    try { this.#realtime?.assignmentsChanged?.({ learnerId, at: record.updatedAt }); }
    catch (error) { this.#logger.warn?.('school.enrollment.broadcast-failed', { learnerId, error: error?.message }); }
    return record;
  }
}

export default UnenrollLearner;
