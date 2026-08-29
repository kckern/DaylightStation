export class EventBusAmbientLightPublications {
  constructor({ eventBus, channel }) {
    this.eventBus = eventBus;
    this.channel = channel;
  }

  report({ lux, sources }) {
    this.eventBus.broadcast(this.channel, { topic: this.channel, lux, sources });
  }
}

export default EventBusAmbientLightPublications;
