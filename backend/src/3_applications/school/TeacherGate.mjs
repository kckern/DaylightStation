/**
 * TeacherGate — the teacher console's one write predicate (spec §1, settled
 * at the M1 review): a mutation is allowed only for (a) a grown-up on the
 * live roster, who is (b) a configured teacher when the `teachers:` key
 * exists (role IS authority; absent key falls back to any-adult, preserving
 * pre-console installs), presenting (c) the distinct console PIN when one is
 * configured (`school.yml` → `teacher.pin` — deliberately NOT
 * `print.teacherPin`: a child who shoulder-surfs a worksheet answer key must
 * not thereby be able to close a semester).
 *
 * Config accessors are read PER CALL, never snapshotted at composition — the
 * GrownUpGate discipline. An unreadable roster refuses everyone. Refusals
 * never echo any pin, and every refusal logs `{action, userId, reason}`.
 */
import { isAdult } from '#domains/school/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

export class TeacherGate {
  #teachers; #pin; #roster; #clock; #logger; #capabilitySessions = null;

  /**
   * @param {object} deps
   * @param {() => (Array<string>|undefined)} deps.teachers - configured ids; undefined = key absent
   * @param {() => (string|null)} deps.pin - the console pin; null/empty = no pin gate
   * @param {() => Array<object>} deps.roster - live household roster
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ teachers, pin, roster, clock = () => new Date(), logger = console } = {}) {
    if (typeof teachers !== 'function') throw new Error('TeacherGate requires a teachers accessor');
    if (typeof pin !== 'function') throw new Error('TeacherGate requires a pin accessor');
    if (typeof roster !== 'function') throw new Error('TeacherGate requires a roster accessor');
    this.#teachers = teachers;
    this.#pin = pin;
    this.#roster = roster;
    this.#clock = clock;
    this.#logger = logger;
  }

  bindCapabilitySessions(capabilitySessions) {
    if (!capabilitySessions || typeof capabilitySessions.authorize !== 'function') {
      throw new Error('TeacherGate capability sessions must expose authorize()');
    }
    this.#capabilitySessions = capabilitySessions;
  }

  #refuse(reason, { userId, action, message, context }) {
    // Context rides the refusal log (which period, which item) — never any pin.
    this.#logger.warn?.('school.teacher-gate.refused', {
      action, userId: userId ?? null, reason, ...(context ?? {}),
    });
    throw new GuestForbiddenError(message);
  }

  /**
   * @param {object} args
   * @param {string|null} args.userId - the acting teacher's stamp
   * @param {string|null} [args.pin] - the presented console pin
   * @param {string} args.action - what is being attempted (for the log)
   */
  assert({ userId = null, pin = null, action = 'write', context = null } = {}) {
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
    const requiredPin = this.#pin();
    const capabilityAuthorized = pin && typeof pin === 'object' && this.#capabilitySessions?.authorize({
      capabilityToken: pin.capabilityToken,
      stepUpToken: pin.stepUpToken,
      userId,
      action,
      context: context ?? {},
    });
    if (typeof requiredPin === 'string' && requiredPin.length > 0 && pin !== requiredPin && !capabilityAuthorized) {
      this.#refuse('bad-pin', { userId, action, context, message: 'The teacher PIN is missing or wrong.' });
    }
  }
}

/**
 * The one place the config-accessor text exists (F4, M2 review): both
 * composition sites (schoolLifecycle module + app.mjs for SchoolService)
 * build their gate through this factory, so a school.yml key rename cannot
 * drift between them.
 */
export function makeTeacherGate({ loadTeachers, loadTeacherPin, userService, householdId = null, clock, logger }) {
  return new TeacherGate({
    teachers: loadTeachers,
    pin: loadTeacherPin,
    roster: () => userService?.getHouseholdRoster?.(householdId) ?? [],
    ...(clock ? { clock } : {}),
    logger,
  });
}

export default TeacherGate;
