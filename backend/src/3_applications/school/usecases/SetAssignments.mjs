/**
 * SetAssignments — a grown-up changes what a learner is expected to work
 * through (spec §7.2).
 *
 * Assignments are planner input, never catalog content, so this write cannot
 * touch curriculum. What it CAN do is decide a child's day — which is why it had
 * no business being an unauthenticated `PUT`. Before this use case existed the
 * router called `IAssignmentStore.put` directly with no author of any kind: a
 * child could hand themselves the shortest unit in the house.
 *
 * The record now carries `assignedBy` as well, so a reassignment is traceable to
 * a person rather than appearing out of the air.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export class SetAssignments {
  #assignments; #grownUps; #teacherGate; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ assignments, grownUps, teacherGate = null, clock = () => new Date(), logger = console } = {}) {
    if (!assignments) throw new Error('SetAssignments requires an assignments store');
    if (!grownUps) throw new Error('SetAssignments requires grownUps (a GrownUpGate)');
    this.#assignments = assignments;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {Array<string|object>} [args.courses]
   * @param {Array<string|object>} [args.units]
   * @param {string} args.assignedBy - a roster id that must be a grown-up's
   * @returns {Promise<object>} the stored assignment record
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {ValidationError} the record is not a shape the store can hold
   */
  async execute({ learnerId, courses = [], units = [], assignedBy = null, pin = null } = {}) {
    if (this.#teacherGate) this.#teacherGate.assert({ userId: assignedBy, pin, action: 'assignments.put', context: { learnerId } });
    else this.#grownUps.assert(assignedBy, 'Only a grown-up can change what a child is assigned', {
      action: 'assignments.put', learnerId,
    });

    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new ValidationError('learnerId is required');
    }
    if (!Array.isArray(courses) || !Array.isArray(units)) {
      throw new ValidationError('courses and units must be arrays');
    }

    const record = await this.#assignments.put({
      learnerId, courses, units, assignedBy, updatedAt: this.#clock().toISOString(),
    });
    this.#logger.info?.('school.assignments.updated', {
      learnerId, assignedBy, courses: courses.length, units: units.length,
    });
    return record;
  }
}

export default SetAssignments;
