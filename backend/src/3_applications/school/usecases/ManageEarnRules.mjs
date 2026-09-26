/**
 * The teacher console's way to change what school work pays: one learner's
 * rates (a preschooler earns more for simpler tasks) or the household rules.
 *
 * The rules themselves belong to the economy (EarnRulesService, injected);
 * this use case only decides WHO may change them from the school surface —
 * a listed grown-up teacher, through the TeacherGate (PIN or capability
 * session) — and stamps the change with that teacher's id. Other surfaces
 * (admin, CLI) gate their own calls to the same service.
 */
export class ManageEarnRules {
  #gate;
  #earnRules;
  #logger;

  /**
   * @param {object} deps
   * @param {{assert: (args: object) => void}} deps.teacherGate
   * @param {{setUserOverride: Function, replace: Function}} deps.earnRules
   */
  constructor({ teacherGate, earnRules, logger = console }) {
    if (!teacherGate?.assert) throw new Error('ManageEarnRules requires teacherGate');
    if (!earnRules?.setUserOverride || !earnRules?.replace) throw new Error('ManageEarnRules requires earnRules');
    this.#gate = teacherGate;
    this.#earnRules = earnRules;
    this.#logger = logger;
  }

  /** Set or clear one learner's multiplier and per-rule rates. */
  async setLearnerRates({ learnerId, patch, actorId, pin = null }) {
    this.#gate.assert({ userId: actorId, pin, action: 'economy.earn-rates', context: { learnerId } });
    const out = await this.#earnRules.setUserOverride({ learnerId, patch, actorId });
    this.#logger.info?.('school.earn-rates.set', { learnerId, actorId, revision: out?.revision ?? null });
    return out;
  }

  /** Replace the household earn rules (learner overrides are kept). */
  async setHouseholdRules({ doc, actorId, pin = null }) {
    this.#gate.assert({ userId: actorId, pin, action: 'economy.earn-rules', context: {} });
    const out = await this.#earnRules.replace({ doc, actorId });
    this.#logger.info?.('school.earn-rules.set', { actorId, revision: out?.revision ?? null });
    return out;
  }
}

export default ManageEarnRules;
