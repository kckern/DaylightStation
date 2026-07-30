/**
 * PortalDispatch — the one place that knows how to hand a learner off to a
 * program or a bank session. Everything upstream (a launcher, a scan action)
 * only needs to describe a `target`; this is the sole thing that turns that
 * description into a signal a screen actually receives.
 *
 * It does not know what a "bank" or a "program" IS beyond the shape of the
 * target it is given — that keeps it reusable across every `IProgramLauncher`
 * and every kind of session dispatch, rather than growing a branch per
 * program the way the media dispatch used to.
 *
 * No event bus wired means no household screen is listening for `school.*`
 * events yet (an unconfigured deployment, a test harness) — that is not an
 * error, so `launch()` reports `dispatched: false` instead of throwing.
 */
export class PortalDispatch {
  #eventBus; #logger;

  /**
   * @param {object} deps
   * @param {{broadcast: Function}} [deps.eventBus] - optional; absent means no target is listening
   * @param {object} [deps.logger]
   */
  constructor({ eventBus = null, logger = console } = {}) {
    this.#eventBus = eventBus;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {{kind: 'bank', bankId: string, unitId: string, sessionId: string}
   *       | {kind: 'program', program: string}} args.target
   * @returns {{dispatched: boolean}}
   */
  launch({ learnerId, target }) {
    if (!this.#eventBus) {
      this.#logger.warn?.('school.portal.no-bus', { learnerId, target });
      return { dispatched: false };
    }
    this.#eventBus.broadcast('school', { type: 'school.launch', learnerId, target });
    this.#logger.info?.('school.portal.launch', { learnerId, target });
    return { dispatched: true };
  }
}

export default PortalDispatch;
