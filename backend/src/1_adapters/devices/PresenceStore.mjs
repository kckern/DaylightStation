/**
 * Last-known Bluetooth presence per device, in memory.
 *
 * In memory ON PURPOSE, matching School's "sessions are in memory by design".
 * A backend restart loses presence, which the gate resolves to `hindered` —
 * the safe direction — and the next APK heartbeat (≤ 60s) restores it. Writing
 * it to disk would buy nothing except a stale value surviving a crash, which is
 * the one outcome the failure policy exists to prevent.
 */
const MAX_DEVICES = 32;
const HISTORY = 50;

export class PresenceStore {
  #byDevice = new Map();
  #history = new Map();
  #logger; #now; #allow;

  /**
   * @param {object} [opts]
   * @param {string[]|null} [opts.allowDeviceIds] - whitelist. Without it any
   *        LAN caller can mint unbounded entries by posting new deviceIds.
   */
  constructor({ logger = console, now = () => Date.now(), allowDeviceIds = null } = {}) {
    this.#logger = logger;
    this.#now = now;
    this.#allow = allowDeviceIds ? new Set(allowDeviceIds) : null;
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
    if (this.#allow && !this.#allow.has(id)) return null;

    const previous = this.#byDevice.get(id);
    // Out-of-order delivery is real: a `connected:true` delayed behind a WiFi
    // restore must not overwrite a newer `connected:false`. The APK supplies a
    // monotonic sequence; a regression is dropped rather than applied.
    const seq = Number(report?.seq);
    if (Number.isFinite(seq) && Number.isFinite(previous?.seq) && seq <= previous.seq) {
      this.#logger.warn?.('device.presence.out-of-order', {
        deviceId: id, seq, lastSeq: previous.seq,
      });
      return previous;
    }

    const devices = (report?.devices || [])
      .filter((d) => d && d.mac)
      .map((d) => ({
        mac: String(d.mac).toUpperCase(),
        role: d.role ? String(d.role) : null,
        connected: d.connected === true,
      }))
      .slice(0, MAX_DEVICES);

    const receivedAt = this.#now();
    const entry = {
      // The backend stamps arrival; freshness is judged on THIS, never on the
      // client's `at`, which is kept only so clock skew is visible.
      receivedAt,
      at: report?.at ?? null,
      skewMs: report?.at && Number.isFinite(Date.parse(report.at))
        ? receivedAt - Date.parse(report.at) : null,
      seq: Number.isFinite(seq) ? seq : null,
      uptimeMs: Number.isFinite(Number(report?.uptimeMs)) ? Number(report.uptimeMs) : null,
      version: report?.version ? String(report.version) : null,
      heartbeatMs: Number.isFinite(Number(report?.heartbeatMs)) ? Number(report.heartbeatMs) : null,
      devices,
    };
    this.#byDevice.set(id, entry);

    // Transitions are recorded, not merely logged to stdout: "it locked and I
    // do not know why" needs an answer that outlives a log rotation. A device
    // appearing for the FIRST time counts as a transition too — the previous
    // version only noticed MACs present in both consecutive reports, so a
    // first sighting and a vanished device both went unrecorded.
    const was = new Map((previous?.devices || []).map((d) => [d.mac, d.connected]));
    const seen = new Set(devices.map((d) => d.mac));
    const transitions = [];
    for (const d of devices) {
      if (was.get(d.mac) !== d.connected) {
        transitions.push({ at: receivedAt, mac: d.mac, role: d.role, connected: d.connected });
      }
    }
    for (const [mac, wasConnected] of was) {
      if (!seen.has(mac) && wasConnected) {
        transitions.push({ at: receivedAt, mac, role: null, connected: false, reason: 'dropped-from-report' });
      }
    }
    if (transitions.length) {
      const log = this.#history.get(id) ?? [];
      log.push(...transitions);
      this.#history.set(id, log.slice(-HISTORY));
      for (const t of transitions) {
        this.#logger.info?.('device.presence.changed', { deviceId: id, ...t });
      }
    }
    return entry;
  }

  get(deviceId) {
    return this.#byDevice.get(String(deviceId || 'unknown')) ?? null;
  }

  /** Recent transitions, for the "why did it lock" question. */
  history(deviceId) {
    return this.#history.get(String(deviceId || 'unknown')) ?? [];
  }

  all() {
    return Object.fromEntries(this.#byDevice);
  }
}

export default PresenceStore;
