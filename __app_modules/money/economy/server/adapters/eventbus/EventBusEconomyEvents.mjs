import { IEconomyEvents } from "../../application/ports/IEconomyEvents.mjs";

/**
 * The economy's facts on the house event bus. `publish`, not `broadcast`: an
 * internal topic for in-process consumers. A surface that wants to hear about
 * it (the School Portal's bank strip) has its own context forward it to its
 * own WebSocket topic, so no browser subscribes to economy internals.
 */
export const COINS_CHANGED_TOPIC = 'economy.coins-changed';

export class EventBusEconomyEvents extends IEconomyEvents {
  #bus;
  constructor({ eventBus } = {}) {
    super();
    if (!eventBus) throw new Error('EventBusEconomyEvents requires eventBus');
    this.#bus = eventBus;
  }

  coinsChanged({ userId, reason = null }) {
    return (this.#bus.publish ?? this.#bus.broadcast)?.call(this.#bus, COINS_CHANGED_TOPIC, { userId, reason });
  }
}

export default EventBusEconomyEvents;
