/**
 * School's view of the economy's prices for paper: what a worksheet is worth
 * (`rewardFor`, the SAME port the Portal's "print my next sheet" and the
 * agenda tape's `Next: Math +2` read, so paper and screen agree), what
 * finishing the day would add (`ifDone`), and the week before/after a grade
 * (`quote`).
 *
 * Late-bound (the economy's earnings runtime is composed after School's
 * lifecycle) and bounded: a quote that fails or takes longer than `timeoutMs`
 * answers null, and the paper prints no coin line rather than a wrong one or a
 * late one. While the catalog is not `live` (`isLive`), nothing is priced:
 * dry-run coins are not real, so paper never shows them. Never throws.
 */
const TIMED_OUT = Symbol('timed-out');

export class EarningsQuoteClient {
  #getService; #rewardFor; #isLive; #logger; #timeoutMs; #setTimer; #clearTimer;

  /**
   * @param {object} deps
   * @param {() => ({quote: Function, ifDone: Function}|null)} [deps.getService]
   *   the economy's earnings preview, or null until it exists
   * @param {((args: {learnerId: string, unit: object}) => Promise<object|null>)|null} [deps.rewardFor]
   *   the economy's sheet-reward port (`economyApi.rewardFor`)
   * @param {() => boolean} [deps.isLive] true while coins are live (default: always)
   * @param {number} [deps.timeoutMs=2000]
   */
  constructor({
    getService, rewardFor = null, isLive = () => true, logger = console, timeoutMs = 2000,
    setTimer = setTimeout, clearTimer = clearTimeout,
  } = {}) {
    this.#getService = typeof getService === 'function' ? getService : () => null;
    this.#rewardFor = typeof rewardFor === 'function' ? rewardFor : null;
    this.#isLive = typeof isLive === 'function' ? isLive : () => true;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  quote(learnerId) {
    return this.#call('quote', learnerId, () => {
      const service = this.#service('quote');
      return service ? service.quote({ learnerId }) : null;
    });
  }

  ifDone({ learnerId, subject, unitId = null, courseId = null, finishesDay = false } = {}) {
    return this.#call('ifDone', learnerId, () => {
      const service = this.#service('ifDone');
      return service ? service.ifDone({ learnerId, subject, unitId, courseId, finishesDay }) : null;
    });
  }

  /** What printing and passing this sheet adds: `{silver, gems}` or null. */
  rewardFor({ learnerId, unit } = {}) {
    return this.#call('rewardFor', learnerId, () => (this.#rewardFor ? this.#rewardFor({ learnerId, unit }) : null));
  }

  #service(op) {
    const service = this.#getService();
    return service && typeof service[op] === 'function' ? service : null;
  }

  async #call(op, learnerId, run) {
    let timer;
    try {
      if (!this.#isLive()) return null;
      const timeout = new Promise((resolve) => { timer = this.#setTimer(() => resolve(TIMED_OUT), this.#timeoutMs); });
      const out = await Promise.race([Promise.resolve().then(run), timeout]);
      if (out === TIMED_OUT) {
        this.#logger.warn?.('school.earnings-quote.failed', { op, learnerId, timeout: true });
        return null;
      }
      return out ?? null;
    } catch (err) {
      this.#logger.warn?.('school.earnings-quote.failed', { op, learnerId, error: err?.message ?? String(err) });
      return null;
    } finally {
      if (timer !== undefined) this.#clearTimer(timer);
    }
  }
}

export default EarningsQuoteClient;
