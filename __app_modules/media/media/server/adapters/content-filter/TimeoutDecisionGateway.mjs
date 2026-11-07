/**
 * TimeoutDecisionGateway - bounds every IDecisionGateway request.
 *
 * The HTTP client behind the real gateway does not enforce the `timeout` it is
 * handed, and one lost request stalled an unattended refine run for 40 minutes.
 * A request that has not settled in `timeoutMs` rejects with code JEV_TIMEOUT;
 * the refiner treats that as an abstention (the cue ends unknown).
 */
export class TimeoutDecisionGateway {
  /**
   * @param {{ evaluate(state: object, questions: object, opts?: object): Promise<object> }} inner
   * @param {{ timeoutMs?: number }} [opts]
   */
  constructor(inner, { timeoutMs = 90000 } = {}) {
    this.inner = inner;
    this.timeoutMs = timeoutMs;
  }

  evaluate(state, questions, opts = {}) {
    const ms = this.timeoutMs;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`decision model gave no answer within ${ms} ms`), { code: 'JEV_TIMEOUT', timeoutMs: ms })), ms);
    });
    // A synchronous throw from the inner gateway becomes a rejection here, so the timer is always cleared.
    const answer = Promise.resolve().then(() => this.inner.evaluate(state, questions, { ...opts, timeout: ms }));
    return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
  }
}

export default TimeoutDecisionGateway;
