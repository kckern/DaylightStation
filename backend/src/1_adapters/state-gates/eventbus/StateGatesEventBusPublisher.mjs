import { IStateGatesEventPublisher } from '#apps/state-gates/ports/IStateGatesEventPublisher.mjs';

export class StateGatesEventBusPublisher extends IStateGatesEventPublisher {
  #eventBus;
  constructor({ eventBus }) {
    super();
    if (!eventBus?.publish) throw new Error('StateGatesEventBusPublisher requires an event bus');
    this.#eventBus = eventBus;
  }
  async publish(envelopes) {
    for (const envelope of envelopes) {
      await this.#eventBus.publish('state-gates', { schema: 'daylight.state-gates-event/v1', ...envelope });
    }
  }
}
export default StateGatesEventBusPublisher;
