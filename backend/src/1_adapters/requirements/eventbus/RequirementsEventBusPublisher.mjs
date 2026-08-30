import { IRequirementsEventPublisher } from '#apps/requirements/ports/IRequirementsEventPublisher.mjs';

export class RequirementsEventBusPublisher extends IRequirementsEventPublisher {
  #eventBus;
  constructor({ eventBus }) {
    super();
    if (!eventBus?.publish) throw new Error('RequirementsEventBusPublisher requires an event bus');
    this.#eventBus = eventBus;
  }
  async publish(envelopes) {
    for (const envelope of envelopes) {
      await this.#eventBus.publish('requirements', { schema: 'daylight.requirements-event/v1', ...envelope });
    }
  }
}
export default RequirementsEventBusPublisher;
