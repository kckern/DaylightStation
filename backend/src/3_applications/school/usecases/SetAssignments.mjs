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
import { assertNotStale } from './staleSaveGuard.mjs';

export class SetAssignments {
  #assignments; #grownUps; #teacherGate; #curriculum; #roster; #programValidators; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps
   * @param {{listUnits: Function}|null} [deps.curriculum] - optional; when
   *   present, course ids are validated against the published catalog
   *   (admin advocacy A4: an assignment naming a course that does not exist
   *   silently deletes a subject from the child's day — refuse it by name).
   * @param {(() => Array<{id: string}>)|null} [deps.roster] - optional; when
   *   present, learnerId must be on the household roster.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ assignments, grownUps, teacherGate = null, curriculum = null, roster = null, programValidators = new Map(), clock = () => new Date(), logger = console } = {}) {
    if (!assignments) throw new Error('SetAssignments requires an assignments store');
    if (!grownUps) throw new Error('SetAssignments requires grownUps (a GrownUpGate)');
    this.#assignments = assignments;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#curriculum = curriculum;
    this.#roster = typeof roster === 'function' ? roster : null;
    this.#programValidators = programValidators instanceof Map ? programValidators : new Map();
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {Array<string|object>} [args.courses]
   * @param {Array<string|object>} [args.units]
   * @param {Array<object>} [args.programs]
   * @param {string} args.assignedBy - a roster id that must be a grown-up's
   * @returns {Promise<object>} the stored assignment record
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {ValidationError} the record is not a shape the store can hold
   */
  async execute({ learnerId, courses = [], units = [], programs = [], assignedBy = null, pin = null, baseUpdatedAt = undefined } = {}) {
    if (this.#teacherGate) this.#teacherGate.assert({ userId: assignedBy, pin, action: 'assignments.put', context: { learnerId } });
    else this.#grownUps.assert(assignedBy, 'Only a grown-up can change what a child is assigned', {
      action: 'assignments.put', learnerId,
    });

    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new ValidationError('learnerId is required');
    }
    if (!Array.isArray(courses) || !Array.isArray(units) || !Array.isArray(programs)) {
      throw new ValidationError('courses, units, and programs must be arrays');
    }
    const normalizedPrograms = [];
    const programKeys = new Set();
    for (const raw of programs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ValidationError('program assignments must be mappings');
      }
      const requestedId = raw.programId === 'language' ? 'sentence-ladder' : raw.programId;
      const validator = this.#programValidators.get(requestedId);
      if (!validator) throw new ValidationError(`unknown program: ${requestedId ?? '(missing)'}`);
      const result = await validator({ ...raw, programId: requestedId });
      if (result?.errors?.length || !result?.enrollment) {
        throw new ValidationError(`invalid ${requestedId} policy: ${(result?.errors ?? ['validation failed']).join('; ')}`);
      }
      const key = `${requestedId}\0${result.enrollment.corpusId ?? ''}`;
      if (programKeys.has(key)) throw new ValidationError(`duplicate program assignment: ${requestedId}/${result.enrollment.corpusId}`);
      programKeys.add(key);
      normalizedPrograms.push(result.enrollment);
    }
    // Referential honesty (admin advocacy A4). Both checks are advisory in
    // posture — they DEGRADE to accepting when the reference source itself
    // is unavailable (a broken catalog must not lock assignment edits shut)
    // — but a resolvable source that does not know the id is a refusal that
    // NAMES the ghost, not a warn log nobody reads.
    if (this.#roster) {
      const ids = new Set((this.#roster() ?? []).map((u) => u.id));
      if (ids.size && !ids.has(learnerId)) {
        throw new ValidationError(`unknown learner: '${learnerId}' is not on the household roster`);
      }
    }
    if (this.#curriculum) {
      let known = null;
      try {
        known = new Set((await this.#curriculum.listUnits() ?? [])
          .map((u) => u.courseId).filter(Boolean));
      } catch (err) {
        this.#logger.warn?.('school.assignments.course-check-skipped', { learnerId, error: err?.message });
      }
      if (known && known.size) {
        const asked = courses.map((c) => (typeof c === 'string' ? c : c?.courseId)).filter(Boolean);
        const ghosts = asked.filter((id) => !known.has(id));
        if (ghosts.length) {
          throw new ValidationError(`unknown course${ghosts.length > 1 ? 's' : ''}: ${ghosts.join(', ')} — not in the published catalog`);
        }
      }
    }
    if (baseUpdatedAt !== undefined) {
      assertNotStale(await this.#assignments.get(learnerId), baseUpdatedAt);
    }

    const record = await this.#assignments.put({
      learnerId, courses, units, programs: normalizedPrograms, assignedBy, updatedAt: this.#clock().toISOString(),
    });
    this.#logger.info?.('school.assignments.updated', {
      learnerId, assignedBy, courses: courses.length, units: units.length,
    });
    return record;
  }
}

export default SetAssignments;
