/**
 * ItemId Value Object - Composite identifier for content items
 * @module domains/content/value-objects/ItemId
 *
 * Format: "source:localId" (e.g., "plex:12345", "youtube:abc123")
 * - source: The content source/adapter name
 * - localId: Source-specific unique identifier
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * ItemId value object
 * Immutable composite identifier for content items across sources
 */
export class ItemId {
  /** @type {string} */
  #source;

  /** @type {string} */
  #localId;

  /**
   * @param {string} source - Content source name (e.g., 'plex', 'youtube')
   * @param {string} localId - Source-specific identifier
   */
  constructor(source, localId) {
    if (!source || typeof source !== 'string') {
      throw new ValidationError('source is required and must be a string', {
        code: 'INVALID_SOURCE',
        source
      });
    }
    if (!localId || typeof localId !== 'string') {
      throw new ValidationError('localId is required and must be a string', {
        code: 'INVALID_LOCAL_ID',
        localId
      });
    }

    this.#source = source;
    this.#localId = localId;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the source name
   * @returns {string}
   */
  get source() {
    return this.#source;
  }

  /**
   * Get the local ID
   * @returns {string}
   */
  get localId() {
    return this.#localId;
  }

  /**
   * Convert to string representation
   * @returns {string} Format: "source:localId"
   */
  toString() {
    return `${this.#source}:${this.#localId}`;
  }

  /**
   * Convert to JSON-serializable value (returns string format)
   * @returns {string}
   */
  toJSON() {
    return this.toString();
  }

  /**
   * Check equality with another ItemId or string
   * @param {ItemId|string} other
   * @returns {boolean}
   */
  equals(other) {
    if (other instanceof ItemId) {
      return this.#source === other.source && this.#localId === other.localId;
    }
    if (typeof other === 'string') {
      const parsed = ItemId.tryParse(other);
      if (!parsed) return false;
      return this.#source === parsed.source && this.#localId === parsed.localId;
    }
    return false;
  }

  /**
   * Parse an ItemId from string representation
   * @param {string} str - String in format "source:localId"
   * @returns {ItemId}
   * @throws {ValidationError}
   */
  static parse(str) {
    if (!str || typeof str !== 'string') {
      throw new ValidationError('ItemId string is required', {
        code: 'INVALID_ITEM_ID',
        value: str
      });
    }

    const colonIndex = str.indexOf(':');
    if (colonIndex === -1) {
      throw new ValidationError('Invalid ItemId format. Expected "source:localId"', {
        code: 'INVALID_FORMAT',
        value: str
      });
    }

    const source = str.substring(0, colonIndex);
    const localId = str.substring(colonIndex + 1);

    if (!source || !localId) {
      throw new ValidationError('Invalid ItemId format. Both source and localId required', {
        code: 'INVALID_FORMAT',
        value: str
      });
    }

    return new ItemId(source, localId);
  }

  /**
   * Try to parse an ItemId from string, returning null on failure
   * @param {string} str - String in format "source:localId"
   * @returns {ItemId|null}
   */
  static tryParse(str) {
    try {
      return ItemId.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * Create an ItemId from source and localId
   * @param {string} source - Content source name
   * @param {string} localId - Source-specific identifier
   * @returns {ItemId}
   */
  static from(source, localId) {
    return new ItemId(source, localId);
  }
}

export default ItemId;
