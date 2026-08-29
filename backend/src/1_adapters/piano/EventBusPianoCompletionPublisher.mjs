import { IPianoCompletionPublisher } from '#apps/piano/ports/IPianoCompletionPublisher.mjs';

export class EventBusPianoCompletionPublisher extends IPianoCompletionPublisher {
  #eventBus;

  constructor({ eventBus } = {}) {
    super();
    if (!eventBus) throw new Error('EventBusPianoCompletionPublisher requires eventBus');
    this.#eventBus = eventBus;
  }

  publishSchoolChallengeCompleted(event) {
    const publish = this.#eventBus.publish ?? this.#eventBus.broadcast;
    publish?.call(this.#eventBus, 'piano.school-challenge.completed', event);
  }
}

export default EventBusPianoCompletionPublisher;
