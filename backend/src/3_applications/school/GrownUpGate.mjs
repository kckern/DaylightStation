/**
 * GrownUpGate — "is the person asking for this allowed to act for a child?"
 *
 * The RULE is `#domains/school/people.mjs` and is stated exactly once. This is
 * the plumbing around it: a use case holds a gate rather than a roster and a
 * clock, so the only thing a new parent-only action has to remember is to call
 * `assert` before it writes.
 *
 * The roster is read AT CALL TIME, never captured. Household members arrive
 * after boot, and a gate holding a snapshot taken during composition would tell
 * a real parent they are not one.
 *
 * A roster that cannot be read refuses everyone. That is the only safe answer:
 * the alternative — treating an unreadable roster as "no rule applies" — turns a
 * transient failure into an open door.
 *
 * @module applications/school/GrownUpGate
 */
import { isAdult } from '#domains/school/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

export class GrownUpGate {
  #roster; #clock; #logger;

  /**
   * @param {object} deps
   * @param {(() => Array<object>)|Array<object>} deps.roster - the household
   *   roster, or a function returning it (preferred: it is re-read per call)
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ roster, clock = () => new Date(), logger = console } = {}) {
    if (!roster) throw new Error('GrownUpGate requires a roster');
    this.#roster = typeof roster === 'function' ? roster : () => roster;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {string|null} userId
   * @returns {boolean}
   */
  isAdult(userId) {
    let roster;
    try {
      roster = this.#roster();
    } catch (err) {
      this.#logger.warn?.('school.grownups.roster-unreadable', { error: err.message });
      return false;
    }
    return isAdult({ roster, userId, now: this.#clock() });
  }

  /**
   * @param {string|null} userId
   * @param {string} message - what the person is told; it reaches them verbatim
   * @param {object} [context] - logged with the refusal, never sent
   * @throws {GuestForbiddenError} when `userId` is not a grown-up
   */
  assert(userId, message, context = {}) {
    if (this.isAdult(userId)) return;
    this.#logger.warn?.('school.grownups.refused', { userId: userId ?? null, ...context });
    throw new GuestForbiddenError(message);
  }
}

export default GrownUpGate;
