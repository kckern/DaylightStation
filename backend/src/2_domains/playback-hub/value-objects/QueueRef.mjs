/**
 * QueueRef Value Object
 * @module domains/playback-hub/value-objects/QueueRef
 *
 * Source-agnostic queue identifier — { source, id }. Currently the only source
 * in use is 'plex', but the VO is source-neutral so future adapters can plug in
 * without changing the domain.
 *
 * String form: "source:id" (e.g. "plex:670208"). The hub-wire JSON shape is
 * always the { source, id } object — strings exist for UI convenience only.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

const DEFAULT_SOURCE = 'plex';

/**
 * QueueRef value object.
 */
export class QueueRef {
  /** @type {string} */ #source;
  /** @type {string} */ #id;

  /**
   * @param {{source: string, id: string}} args
   */
  constructor({ source, id } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError('QueueRef.id must be a non-empty string', {
        code: 'INVALID_QUEUE_REF',
        field: 'id',
        value: id
      });
    }
    if (typeof source !== 'string' || source.length === 0) {
      throw new ValidationError('QueueRef.source must be a non-empty string', {
        code: 'INVALID_QUEUE_REF',
        field: 'source',
        value: source
      });
    }
    this.#source = source;
    this.#id = id;
    Object.freeze(this);
  }

  /** @returns {string} */
  get source() {
    return this.#source;
  }

  /** @returns {string} */
  get id() {
    return this.#id;
  }

  /** @returns {string} "source:id" */
  toString() {
    return `${this.#source}:${this.#id}`;
  }

  /** @returns {{source: string, id: string}} */
  toJSON() {
    return { source: this.#source, id: this.#id };
  }

  /**
   * Value equality (source AND id).
   * @param {QueueRef} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof QueueRef
      && other.source === this.#source
      && other.id === this.#id;
  }

  /**
   * Parse a "source:id" string. A bare "id" (no colon) defaults source='plex'.
   * @param {string} value
   * @returns {QueueRef}
   */
  static parse(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('QueueRef.parse expects non-empty string', {
        code: 'INVALID_QUEUE_REF',
        value
      });
    }
    const idx = value.indexOf(':');
    if (idx < 0) {
      return new QueueRef({ source: DEFAULT_SOURCE, id: value });
    }
    const source = value.slice(0, idx);
    const id = value.slice(idx + 1);
    return new QueueRef({ source, id });
  }
}

export default QueueRef;
