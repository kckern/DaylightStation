const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';

/** Owns raw websocket topics and transport message filtering for identity flow. */
export class FitnessIdentityChannel {
  #bus;#verifyScan;
  constructor({ eventBus,verifyScan=()=>true } = {}) { this.#bus = eventBus;this.#verifyScan=verifyScan; }
  identityDetected(payload) { return this.#bus.broadcast(IDENTITY_TOPIC, payload); }
  emergencyCeremony(payload) { return this.#bus.broadcast(CEREMONY_TOPIC, payload); }
  onScan(handler) {
    return this.#bus.onClientMessage((_clientId, message) => {
      if (message?.topic === SCAN_TOPIC && this.#verifyScan(message)) handler(message);
    });
  }
}
export default FitnessIdentityChannel;
