import { IEconomyEvents } from "../../application/ports/IEconomyEvents.mjs";

/**
 * The economy's facts on the house event bus, through `publish` ONLY: an
 * internal topic for in-process consumers. `broadcast` would also reach
 * WebSocket clients, and no browser should subscribe to economy internals; a
 * surface that wants to hear about it (the School Portal's bank strip) has its
 * own context forward it to its own topic. A bus with no `publish` gets
 * nothing, and that is logged once.
 */
export const COINS_CHANGED_TOPIC = 'economy.coins-changed';

export class EventBusEconomyEvents extends IEconomyEvents {
  #bus; #logger; #warned = false;
  constructor({ eventBus, logger = console } = {}) {
    super();
    if (!eventBus) throw new Error('EventBusEconomyEvents requires eventBus');
    this.#bus = eventBus;
    this.#logger = logger;
  }

  coinsChanged({ userId, reason = null }) {
    if (typeof this.#bus.publish !== 'function') {
      if (!this.#warned) {
        this.#warned = true;
        this.#logger.warn?.('economy.coins-changed.no-publish', { topic: COINS_CHANGED_TOPIC });
      }
      return undefined;
    }
    return this.#bus.publish(COINS_CHANGED_TOPIC, { userId, reason });
  }
}

export default EventBusEconomyEvents;
