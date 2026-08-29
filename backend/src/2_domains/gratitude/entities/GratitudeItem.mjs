/**
 * GratitudeItem Entity
 *
 * Represents a gratitude or hopes item that can be selected by users.
 *
 * @module domains/gratitude/entities
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * @typedef {Object} GratitudeItemData
 * @property {string} id - Unique identifier
 * @property {string} text - Item text content
 */

export class GratitudeItem {
  #id;
  #text;

  /**
   * @param {GratitudeItemData} data
   */
  constructor(data) {
    if (!data.id) throw new ValidationError('id is required');
    this.#id = data.id;
    this.#text = data.text;
  }

  /** @returns {string} */
  get id() {
    return this.#id;
  }

  /** @returns {string} */
  get text() {
    return this.#text;
  }

  /**
   * Update item text
   * @param {string} text
   */
  updateText(text) {
    this.#text = text;
  }

}

export default GratitudeItem;
