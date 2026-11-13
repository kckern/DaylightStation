/**
 * TeacherGate — the teacher console's one write predicate (spec §1, settled
 * at the M1 review): a mutation is allowed only for (a) a grown-up on the
 * live roster, who is (b) a configured teacher when the `teachers:` key
 * exists (role IS authority; absent key falls back to any-adult, preserving
 * pre-console installs).
 *
 * Config accessors are read PER CALL, never snapshotted at composition — the
 * GrownUpGate discipline. An unreadable roster refuses everyone, and every
 * refusal logs `{action, userId, reason}`.
 */
import { isAdult } from "../domain/index.mjs";
import { GuestForbiddenError } from "../domain/errors.mjs";

export class TeacherGate {
  #teachers; #roster; #clock; #logger;

  /**
   * @param {object} deps
   * @param {() => (Array<string>|undefined)} deps.teachers - configured ids; undefined = key absent
   * @param {() => Array<object>} deps.roster - live household roster
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ teachers, roster, clock = () => new Date(), logger = console } = {}) {
    if (typeof teachers !== 'function') throw new Error('TeacherGate requires a teachers accessor');
    if (typeof roster !== 'function') throw new Error('TeacherGate requires a roster accessor');
    this.#teachers = teachers;
    this.#roster = roster;
    this.#clock = clock;
    this.#logger = logger;
  }

  #refuse(reason, { userId, action, message, context }) {
    // Context rides the refusal log (which period, which item).
    this.#logger.warn?.('school.teacher-gate.refused', {
      action, userId: userId ?? null, reason, ...(context ?? {}),
    });
    throw new GuestForbiddenError(message);
  }

  /**
   * @param {object} args
   * @param {string|null} args.userId - the acting teacher's stamp
   * @param {string} args.action - what is being attempted (for the log)
   */
  assert({ userId = null, action = 'write', context = null } = {}) {
    let roster;
    try {
      roster = this.#roster();
    } catch (err) {
      this.#logger.warn?.('school.teacher-gate.roster-unreadable', { error: err.message });
      this.#refuse('roster-unreadable', { userId, action, context, message: 'Cannot verify who is asking — try again.' });
    }
    if (!isAdult({ roster, userId, now: this.#clock() })) {
      this.#refuse('not-a-grown-up', { userId, action, context, message: 'Only a grown-up can do this.' });
    }
    const teachers = this.#teachers();
    if (teachers !== undefined && teachers !== null && !(Array.isArray(teachers) && teachers.includes(userId))) {
      this.#refuse('not-a-teacher', { userId, action, context, message: 'Only a listed teacher can do this.' });
    }
  }
}

/**
 * The one place the config-accessor text exists (F4, M2 review): both
 * composition sites (schoolLifecycle module + app.mjs for SchoolService)
 * build their gate through this factory, so a school.yml key rename cannot
 * drift between them.
 */
export function makeTeacherGate({ loadTeachers, userService, householdId = null, clock, logger }) {
  return new TeacherGate({
    teachers: loadTeachers,
    roster: () => userService?.getHouseholdRoster?.(householdId) ?? [],
    ...(clock ? { clock } : {}),
    logger,
  });
}

export default TeacherGate;
