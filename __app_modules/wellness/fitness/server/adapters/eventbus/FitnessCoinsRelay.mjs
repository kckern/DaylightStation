export const COINS_CHANGED_TOPIC = 'economy.coins-changed';

/**
 * Forwards the economy's internal `economy.coins-changed {userId}` to the
 * fitness display as `{ event: 'coins-changed', userId }` on the `fitness`
 * WebSocket topic, so the ceremony can re-read the wallet the moment a payout
 * lands instead of polling.
 */
export class FitnessCoinsRelay {
  #bus; #logger; #off = null;
  constructor({ eventBus, logger = console } = {}) { this.#bus = eventBus; this.#logger = logger; }

  start() {
    if (this.#off || !this.#bus?.subscribe) return this;
    this.#off = this.#bus.subscribe(COINS_CHANGED_TOPIC, (payload) => {
      const userId = typeof payload?.userId === 'string' ? payload.userId : '';
      if (!userId) return;
      try {
        this.#bus.broadcast('fitness', { event: 'coins-changed', userId });
        this.#logger.debug?.('fitness.coins-changed.relayed', { userId });
      } catch (error) {
        this.#logger.warn?.('fitness.coins-changed.relay-failed', { userId, error: error?.message });
      }
    }) ?? (() => {});
    return this;
  }

  stop() { if (typeof this.#off === 'function') this.#off(); this.#off = null; }
}

export default FitnessCoinsRelay;
