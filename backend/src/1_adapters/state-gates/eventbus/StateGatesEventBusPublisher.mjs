import { IStateGatesEventPublisher } from '#apps/state-gates/ports/IStateGatesEventPublisher.mjs';

export class StateGatesEventBusPublisher extends IStateGatesEventPublisher {
  #eventBus;
  constructor({ eventBus }) {
    super();
    if (!eventBus?.publish && !eventBus?.broadcast) throw new Error('StateGatesEventBusPublisher requires an event bus');
    this.#eventBus = eventBus;
  }
  async publish(envelopes) {
    // WebSocketEventBus.broadcast also publishes internally. Prefer it so
    // browser consumers receive the documented live `state-gates` topic;
    // simple in-memory/test buses may expose publish only.
    const deliver = this.#eventBus.broadcast ?? this.#eventBus.publish;
    for (const envelope of envelopes) {
      await deliver.call(this.#eventBus, 'state-gates', { schema: 'daylight.state-gates-event/v1', ...envelope });
    }
  }
}
export default StateGatesEventBusPublisher;
