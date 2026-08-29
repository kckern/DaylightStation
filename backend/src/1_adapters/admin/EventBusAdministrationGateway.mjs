/** Translates semantic realtime-administration operations to the concrete event bus. */
export class EventBusAdministrationGateway {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  restart() { return this.eventBus.restart(); }
  broadcastAdmin(message) { return this.eventBus.broadcast('admin', message); }
  status() {
    return {
      running: !!this.eventBus.isRunning?.(),
      metrics: this.eventBus.getMetrics?.() || {},
    };
  }
}

export default EventBusAdministrationGateway;
