/**
 * Last-known Bluetooth presence per device, in memory.
 *
 * In memory ON PURPOSE, matching School's "sessions are in memory by design".
 * A backend restart loses presence, which the gate resolves to `hindered` —
 * the safe direction — and the next APK heartbeat (≤ 60s) restores it. Writing
 * it to disk would buy nothing except a stale value surviving a crash, which is
 * the one outcome the failure policy exists to prevent.
 */
export class PresenceStore {
  #byDevice = new Map();
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  /**
   * Record a report. Transitions are logged because a parent asking "why did
   * the panel close" deserves an answer, and because a flapping device is a
   * hardware fault worth seeing.
   *
   * @param {string} deviceId
   * @param {{at: string, devices: Array<{mac,role,connected}>}} report
   */
  record(deviceId, report) {
    const id = String(deviceId || 'unknown');
    const devices = (report?.devices || [])
      .filter((d) => d && d.mac)
      .map((d) => ({
        mac: String(d.mac).toUpperCase(),
        role: d.role ? String(d.role) : null,
        connected: d.connected === true,
      }));

    const previous = this.#byDevice.get(id);
    const entry = { at: report?.at || new Date().toISOString(), devices };
    this.#byDevice.set(id, entry);

    const was = new Map((previous?.devices || []).map((d) => [d.mac, d.connected]));
    for (const d of devices) {
      if (was.has(d.mac) && was.get(d.mac) !== d.connected) {
        this.#logger.info?.('device.presence.changed', {
          deviceId: id, mac: d.mac, role: d.role, connected: d.connected,
        });
      }
    }
    return entry;
  }

  get(deviceId) {
    return this.#byDevice.get(String(deviceId || 'unknown')) ?? null;
  }

  all() {
    return Object.fromEntries(this.#byDevice);
  }
}

export default PresenceStore;
