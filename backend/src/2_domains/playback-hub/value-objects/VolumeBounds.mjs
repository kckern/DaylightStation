/**
 * VolumeBounds Value Object
 * @module domains/playback-hub/value-objects/VolumeBounds
 *
 * Volume policy: { default, min, max } with invariant 0 <= min <= default <= max <= 100.
 * Defaults: default=60, min=0, max=100.
 *
 * IMPORTANT: toYaml() is sparse-preserving — it returns ONLY the keys the user
 * explicitly supplied at construction. This is critical so saving the config
 * back to YAML doesn't synthesize default fields the user never wrote.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const KEYS = Object.freeze(['default', 'min', 'max']);
const DEFAULTS = Object.freeze({ default: 60, min: 0, max: 100 });

/**
 * VolumeBounds value object.
 */
export class VolumeBounds {
  /** @type {number} */ #default;
  /** @type {number} */ #min;
  /** @type {number} */ #max;
  /** @type {ReadonlySet<string>} */ #userKeys;

  /**
   * @param {{default?: number, min?: number, max?: number}} [partial]
   */
  constructor(partial = {}) {
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new ValidationError('VolumeBounds must be an object', {
        code: 'INVALID_VOLUME_BOUNDS',
        value: partial
      });
    }
    const userKeys = new Set();
    for (const k of KEYS) {
      if (Object.prototype.hasOwnProperty.call(partial, k) && partial[k] !== undefined && partial[k] !== null) {
        userKeys.add(k);
      }
    }
    const resolved = {};
    for (const k of KEYS) {
      const raw = partial[k];
      const v = raw === undefined || raw === null ? DEFAULTS[k] : raw;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
        throw new ValidationError(`VolumeBounds.${k} must be a number 0-100`, {
          code: 'INVALID_VOLUME_BOUNDS',
          field: k,
          value: v
        });
      }
      resolved[k] = v;
    }
    if (!(resolved.min <= resolved.default && resolved.default <= resolved.max)) {
      throw new DomainInvariantError(
        `VolumeBounds invariant violated: min(${resolved.min}) <= default(${resolved.default}) <= max(${resolved.max})`,
        { code: 'VOLUME_BOUNDS_INVARIANT', details: resolved }
      );
    }
    this.#default = resolved.default;
    this.#min = resolved.min;
    this.#max = resolved.max;
    this.#userKeys = Object.freeze(userKeys);
    Object.freeze(this);
  }

  /** @returns {number} */
  get default() {
    return this.#default;
  }

  /** @returns {number} */
  get min() {
    return this.#min;
  }

  /** @returns {number} */
  get max() {
    return this.#max;
  }

  /**
   * Clamp a value into [min, max].
   * @param {number} v
   * @returns {number}
   */
  clamp(v) {
    if (v < this.#min) return this.#min;
    if (v > this.#max) return this.#max;
    return v;
  }

  /**
   * Sparse-preserving YAML serialization. Returns ONLY the keys explicitly
   * supplied at construction (never synthesizes defaults).
   * @returns {{default?: number, min?: number, max?: number}}
   */
  toYaml() {
    const out = {};
    for (const k of KEYS) {
      if (this.#userKeys.has(k)) {
        out[k] = this[k];
      }
    }
    return out;
  }

  /**
   * Value equality (all three resolved values).
   * @param {VolumeBounds} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof VolumeBounds
      && other.default === this.#default
      && other.min === this.#min
      && other.max === this.#max;
  }
}

export default VolumeBounds;
