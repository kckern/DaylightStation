export class DevicePresenceService {
  #store; #readGate;
  constructor({ store = null, readGate = null } = {}) { this.#store = store; this.#readGate = readGate; }
  configured() { return !!this.#store; }
  record(deviceId, report) {
    const entry = this.#store.record(deviceId, report);
    return entry ? { ok: true, receivedAt: entry.receivedAt, seq: entry.seq, count: entry.devices.length } : null;
  }
  get(deviceId) {
    return { presence: this.#store.get(deviceId) ?? { receivedAt: null, devices: [] },
      transitions: this.#store.history(deviceId), gate: this.#readGate ? this.#readGate() : null };
  }
}
