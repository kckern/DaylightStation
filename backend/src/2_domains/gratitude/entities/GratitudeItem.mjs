/**
 * GratitudeItem Entity
 *
 * Represents a gratitude or hopes item that can be selected by users.
 *
 * @module domains/gratitude/entities
 */

import { v4 as uuidv4 } from 'uuid';

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
    this.#id = data.id || uuidv4();
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

  /**
   * Convert to plain object
   * @returns {GratitudeItemData}
   */
  toJSON() {
    return {
      id: this.#id,
      text: this.#text
    };
  }

  /**
   * Create from plain object
   * @param {GratitudeItemData} data
   * @returns {GratitudeItem}
   */
  static fromJSON(data) {
    return new GratitudeItem(data);
  }
}

export default GratitudeItem;
