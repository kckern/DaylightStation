// backend/src/domains/content/ports/IContentSource.mjs

/**
 * @typedef {Object} PrefixMapping
 * @property {string} prefix - The prefix string (e.g., "plex", "hymn")
 * @property {function(string): string} [idTransform] - Optional transform function
 */

/**
 * @typedef {Object} IContentSource
 * @property {string} source - Unique source identifier
 * @property {PrefixMapping[]} prefixes - Registered prefix mappings
 * @property {function(string): Promise<import('../entities/Item.mjs').Item|null>} getItem
 * @property {function(string): Promise<import('../capabilities/Listable.mjs').ListableItem[]>} getList
 * @property {function(string): Promise<import('../capabilities/Playable.mjs').PlayableItem[]>} resolvePlayables
 * @property {function(string): Promise<string>} [getStoragePath] - Optional storage path for watch state
 */

/**
 * Validates that an object implements the IContentSource interface.
 * @param {any} adapter
 * @throws {Error} If validation fails
 */
export function validateAdapter(adapter) {
  if (!adapter.source || typeof adapter.source !== 'string') {
    throw new Error('Adapter must have source property (string)');
  }

  if (!Array.isArray(adapter.prefixes)) {
    throw new Error('Adapter must have prefixes array');
  }

  if (typeof adapter.getItem !== 'function') {
    throw new Error('Adapter must implement getItem(id): Promise<Item|null>');
  }

  if (typeof adapter.getList !== 'function') {
    throw new Error('Adapter must implement getList(id): Promise<Listable[]>');
  }

  if (typeof adapter.resolvePlayables !== 'function') {
    throw new Error('Adapter must implement resolvePlayables(id): Promise<Playable[]>');
  }
}

/**
 * Base class for content source adapters.
 * Extend this to implement concrete adapters.
 */
export class ContentSourceBase {
  constructor() {
    if (this.constructor === ContentSourceBase) {
      throw new Error('ContentSourceBase is abstract');
    }
  }

  /** @type {string} */
  get source() {
    throw new Error('source must be implemented');
  }

  /** @type {PrefixMapping[]} */
  get prefixes() {
    throw new Error('prefixes must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../entities/Item.mjs').Item|null>}
   */
  async getItem(id) {
    throw new Error('getItem must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../capabilities/Listable.mjs').ListableItem[]>}
   */
  async getList(id) {
    throw new Error('getList must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../capabilities/Playable.mjs').PlayableItem[]>}
   */
  async resolvePlayables(id) {
    throw new Error('resolvePlayables must be implemented');
  }
}
