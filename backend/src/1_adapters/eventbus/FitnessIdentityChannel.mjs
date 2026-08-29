const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';

/** Owns raw websocket topics and transport message filtering for identity flow. */
export class FitnessIdentityChannel {
  #bus;
  constructor({ eventBus } = {}) { this.#bus = eventBus; }
  identityDetected(payload) { return this.#bus.broadcast(IDENTITY_TOPIC, payload); }
  emergencyCeremony(payload) { return this.#bus.broadcast(CEREMONY_TOPIC, payload); }
  onScan(handler) {
    return this.#bus.onClientMessage((_clientId, message) => {
      if (message?.topic === SCAN_TOPIC) handler(message);
    });
  }
}
export default FitnessIdentityChannel;
