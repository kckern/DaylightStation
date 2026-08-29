/**
 * Selection Entity
 *
 * Represents a user's selection of a gratitude/hopes item.
 * Tracks the user who selected it, when it was selected, and print history.
 *
 * @module domains/gratitude/entities
 */

import { GratitudeItem } from './GratitudeItem.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * @typedef {Object} SelectionData
 * @property {string} id - Selection entry ID
 * @property {string} userId - Username of the selector
 * @property {Object} item - The selected item
 * @property {string} item.id - Item ID
 * @property {string} item.text - Item text
 * @property {string} datetime - ISO 8601 timestamp
 * @property {string[]} [printed] - Array of print timestamps
 */

export class Selection {
  #id;
  #userId;
  #item;
  #datetime;
  #printed;

  /**
   * @param {SelectionData} data
   */
  constructor(data) {
    if (!data.id) throw new ValidationError('id is required');
    this.#id = data.id;
    this.#userId = data.userId;
    this.#item = data.item instanceof GratitudeItem
      ? data.item
      : new GratitudeItem(data.item);
    this.#datetime = data.datetime;
    this.#printed = Array.isArray(data.printed) ? [...data.printed] : [];
  }

  /** @returns {string} */
  get id() {
    return this.#id;
  }

  /** @returns {string} */
  get userId() {
    return this.#userId;
  }

  /** @returns {GratitudeItem} */
  get item() {
    return this.#item;
  }

  /** @returns {string} */
  get datetime() {
    return this.#datetime;
  }

  /** @returns {string[]} */
  get printed() {
    return [...this.#printed];
  }

  /** @returns {number} */
  get printCount() {
    return this.#printed.length;
  }

  /**
   * Mark this selection as printed
   * @param {string} timestamp - Print timestamp (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  markAsPrinted(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for markAsPrinted');
    }
    this.#printed.push(timestamp);
  }

  /**
   * Check if this selection has been printed
   * @returns {boolean}
   */
  hasBeenPrinted() {
    return this.#printed.length > 0;
  }

  /**
   * Create a new selection
   * @param {string} userId
   * @param {Object} item
   * @param {string} timestamp - ISO 8601 timestamp (required)
   * @returns {Selection}
   * @throws {ValidationError} If timestamp is not provided
   */
  static create(userId, item, timestamp, id) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for Selection.create');
    }

    return new Selection({
      id,
      userId,
      item,
      datetime: timestamp
    });
  }
}

export default Selection;
