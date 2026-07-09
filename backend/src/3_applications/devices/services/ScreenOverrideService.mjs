/**
 * ScreenOverrideService — the single source of "is there a live manual screen
 * intent for this device, and what is it?". A Map<deviceId,{state,until}> with an
 * injected clock. Knows nothing about pianos, FKB, or Home Assistant.
 *
 * Read by PianoScreenAuthorityService (poll early-return + reconcile enforce),
 * PianoMidiWakeService (note-on suppression), the device router (toggle/override
 * routes), and — over HTTP — the browser screensaver.
 *
 * @module 3_applications/devices/services/ScreenOverrideService
 */
export class ScreenOverrideService {
  #map;
  #clock;

  constructor({ clock = Date } = {}) {
    this.#map = new Map();
    this.#clock = clock;
  }

  /** @returns {{state:'on'|'off', until:number}} */
  set(deviceId, state, minutes) {
    if (state !== 'on' && state !== 'off') {
      throw new Error(`ScreenOverrideService: invalid state '${state}' (expected 'on'|'off')`);
    }
    const mins = Math.max(0, Number(minutes) || 0);
    const entry = { state, until: this.#clock.now() + mins * 60_000 };
    this.#map.set(deviceId, entry);
    return entry;
  }

  /** @returns {{state:'on'|'off', until:number}|null} — null once expired (and drops it). */
  get(deviceId) {
    const entry = this.#map.get(deviceId);
    if (!entry) return null;
    if (this.#clock.now() >= entry.until) {
      this.#map.delete(deviceId);
      return null;
    }
    return entry;
  }

  clear(deviceId) {
    this.#map.delete(deviceId);
  }
}

export default ScreenOverrideService;
