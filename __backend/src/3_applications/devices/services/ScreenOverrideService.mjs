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
  #store;
  #decided = new Set();

  constructor({ clock = Date, store = null } = {}) {
    this.#map = new Map();
    this.#clock = clock;
    this.#store = store;
    const saved = store?.load();
    if (saved && saved.deviceId === store.deviceId) {
      this.#decided.add(saved.deviceId);
      const { state, until } = saved;
      if ((state === 'on' || state === 'off') && Number.isSafeInteger(until)
          && until > clock.now() && until <= clock.now() + 86400000 + 1000) {
        this.#map.set(saved.deviceId, { state, until });
      }
    }
  }

  hasDecision(deviceId) { return this.#decided.has(deviceId); }

  #remember(deviceId, entry) {
    if (this.#store?.deviceId === deviceId) this.#store.save({ deviceId, ...entry });
    this.#decided.add(deviceId);
  }

  /** @returns {{state:'on'|'off', until:number}} */
  set(deviceId, state, minutes) {
    if (state !== 'on' && state !== 'off') {
      throw new Error(`ScreenOverrideService: invalid state '${state}' (expected 'on'|'off')`);
    }
    const mins = Math.max(0, Number(minutes) || 0);
    const entry = { state, until: this.#clock.now() + mins * 60_000 };
    this.#remember(deviceId, entry);
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
    this.#remember(deviceId, { state: null, until: 0 });
    this.#map.delete(deviceId);
  }
}

export default ScreenOverrideService;
