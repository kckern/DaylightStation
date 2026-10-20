/**
 * School's view of the economy's earnings preview: what a sheet is worth and
 * what grading added. Late-bound (the economy's earnings service is composed
 * after School's lifecycle) and bounded — a quote that fails or takes longer
 * than `timeoutMs` answers null, and the paper prints no coin line rather than
 * a wrong one or a late one. Never throws.
 */
const TIMED_OUT = Symbol('timed-out');

export class EarningsQuoteClient {
  #getService; #logger; #timeoutMs; #setTimer; #clearTimer;

  constructor({ getService, logger = console, timeoutMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.#getService = typeof getService === 'function' ? getService : () => null;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  quote(learnerId) {
    return this.#call('quote', learnerId, (s) => s.quote({ learnerId }));
  }

  ifDone({ learnerId, subject, unitId = null, courseId = null, finishesDay = false } = {}) {
    return this.#call('ifDone', learnerId, (s) => s.ifDone({ learnerId, subject, unitId, courseId, finishesDay }));
  }

  async #call(op, learnerId, run) {
    let timer;
    try {
      const service = this.#getService();
      if (!service || typeof service[op] !== 'function') return null;
      const timeout = new Promise((resolve) => { timer = this.#setTimer(() => resolve(TIMED_OUT), this.#timeoutMs); });
      const out = await Promise.race([Promise.resolve().then(() => run(service)), timeout]);
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
