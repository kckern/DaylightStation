/**
 * AmbientLightTracker — pure. Holds the latest lux per entity, computes the max,
 * and reports whether the max moved beyond a threshold since the last accepted
 * reading. Non-numeric states (e.g. 'unavailable') are ignored (last good kept).
 */
export class AmbientLightTracker {
  #readings = new Map();
  #lastMax = null;
  #threshold;

  constructor({ threshold = 1 } = {}) {
    this.#threshold = threshold;
  }

  update(entity, rawState) {
    const lux = Number(rawState);
    if (!Number.isFinite(lux)) return { changed: false, lux: this.max() };
    this.#readings.set(entity, lux);
    const m = this.max();
    if (this.#lastMax === null || Math.abs(m - this.#lastMax) >= this.#threshold) {
      this.#lastMax = m;
      return { changed: true, lux: m };
    }
    return { changed: false, lux: m };
  }

  max() {
    let m = null;
    for (const v of this.#readings.values()) m = m === null ? v : Math.max(m, v);
    return m;
  }

  sources() {
    return Object.fromEntries(this.#readings);
  }
}

export default AmbientLightTracker;
