import { IEventInputSource } from '#apps/scan/ports/IEventInputSource.mjs';

/** Subscribes a semantic input observer to configured event-bus topics. */
export class EventBusEventInputSource extends IEventInputSource {
  #eventBus;
  #topics;

  constructor({ eventBus, topics } = {}) {
    super();
    if (!eventBus?.subscribe) throw new Error('EventBusEventInputSource requires eventBus');
    this.#eventBus = eventBus;
    this.#topics = [...new Set(topics || [])];
  }

  observe(handler) {
    const unsubscribers = this.#topics.map((topic) => this.#eventBus.subscribe(topic, handler));
    return () => {
      for (const unsubscribe of unsubscribers) {
        try { unsubscribe?.(); } catch { /* already gone */ }
      }
    };
  }
}

export function resolveOmrInputTopics(config = {}) {
  const readers = config?.scanners || {};
  return [...new Set(['omr', ...Object.values(readers).map((reader) => reader?.topic).filter(Boolean)])];
}

export default EventBusEventInputSource;
