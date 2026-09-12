import { assessEligibility } from '#domains/gaming/services/playEligibility.mjs';

/**
 * Answers whether play may begin, by gathering what the rules need and handing
 * it to a pure evaluation.
 *
 * Eligibility is NOT a wallet check. Affordability is one input among time of
 * day, finished schoolwork, which title it is, and how many controllers are
 * actually present — which is why this asks a policy and a set of assertions
 * rather than a balance.
 *
 * Every input is optional and every absence is permissive. A household that has
 * configured no rules can still play; a state-gate source that is unreachable
 * does not lock the arcade. The one thing that DOES refuse is a device the meter
 * has lost sight of, because granting new play we cannot measure is the hole the
 * whole blind-spot design exists to close.
 */
export class CheckPlayEligibility {
  #policyFor; #assertionsFor; #isBlocked; #controllersFor; #now; #logger;

  constructor({
    policyFor = null, assertionsFor = null, isBlocked = null, controllersFor = null,
    now = () => new Date(), logger = console,
  }) {
    this.#policyFor = policyFor;
    this.#assertionsFor = assertionsFor;
    this.#isBlocked = isBlocked;
    this.#controllersFor = controllersFor;
    this.#now = now;
    this.#logger = logger;
  }

  /**
   * @returns {Promise<{allowed: boolean, reasons: string[]}>}
   */
  async execute({ userId = null, deviceId = null, contentId = null }) {
    const policy = await this.#safely('policy', () => this.#policyFor?.(), {});
    const satisfied = await this.#safely('assertions', () => this.#assertionsFor?.(userId), []);
    const controllers = await this.#safely('controllers', () => this.#controllersFor?.(deviceId), null);

    let deviceBlocked = false;
    try {
      deviceBlocked = deviceId ? this.#isBlocked?.(deviceId) === true : false;
    } catch { deviceBlocked = false; }

    const result = assessEligibility({
      at: this.#now(),
      policy: policy || {},
      contentId,
      satisfied: satisfied || [],
      deviceBlocked,
      controllers: Number.isFinite(controllers) ? controllers : null,
    });

    if (!result.allowed) {
      this.#logger.info?.('play.eligibility.refused', { userId, deviceId, contentId, reasons: result.reasons });
    }
    return result;
  }

  /** An input we cannot gather must not become a refusal. */
  async #safely(what, fn, fallback) {
    try {
      const value = await fn?.();
      return value === undefined ? fallback : value;
    } catch (error) {
      this.#logger.warn?.('play.eligibility.input_failed', { input: what, error: error.message });
      return fallback;
    }
  }
}

export default CheckPlayEligibility;
