/** Application-facing realtime administration operations over a semantic gateway. */
export class EventBusAdministration {
  constructor({ realtime = null } = {}) { this.realtime = realtime; }
  get available() { return !!this.realtime; }
  restart() { return this.realtime.restart(); }
  broadcastAdmin(message) { return this.realtime.broadcastAdmin(message); }
  status() { return this.realtime.status(); }
}

export default EventBusAdministration;
