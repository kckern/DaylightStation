/**
 * VolumeBoostService — the single source of "is there a live override letting
 * this device exceed its normal volume cap, and how high?".
 *
 * A Map<deviceId,{ceiling,until}> with an injected clock, deliberately the same
 * shape as ScreenOverrideService: the household already has one time-boxed
 * override primitive and a second one that behaved differently would be a trap.
 *
 * It knows nothing about Fully Kiosk, streams, or where the cap comes from. The
 * cap is device configuration; this is only the temporary permission to go above
 * it, and the deadline that permission expires on.
 *
 * @module 3_applications/devices/services/VolumeBoostService
 */
export class VolumeBoostService {
  #map;
  #clock;

  constructor({ clock = Date } = {}) {
    this.#map = new Map();
    this.#clock = clock;
  }

  /**
   * Open (or replace) a boost window.
   * @param {string} deviceId
   * @param {number} ceiling - 0..100, already clamped to the device's boost_max by the caller
   * @param {number} minutes - window length; 0 expires immediately
   * @returns {{ceiling:number, until:number}}
   */
  set(deviceId, ceiling, minutes) {
    if (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > 100) {
      throw new Error(`VolumeBoostService: invalid ceiling '${ceiling}' (expected integer 0..100)`);
    }
    const mins = Math.max(0, Number(minutes) || 0);
    const entry = { ceiling, until: this.#clock.now() + mins * 60_000 };
    this.#map.set(deviceId, entry);
    return entry;
  }

  /** @returns {{ceiling:number, until:number}|null} — null once expired (and drops it). */
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

export default VolumeBoostService;
