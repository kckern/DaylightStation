/**
 * CostCategory Value Object - Represents a hierarchical cost category
 * @module domains/cost/value-objects/CostCategory
 *
 * Immutable value object for categorizing costs in a hierarchy.
 * Categories are represented as a path of segments (e.g., ['ai', 'openai', 'gpt-4o']).
 *
 * @example
 * const cat = CostCategory.fromString('ai/openai/gpt-4o');
 * cat.path // ['ai', 'openai', 'gpt-4o']
 * cat.getRoot() // 'ai'
 * cat.getParent().path // ['ai', 'openai']
 * cat.toString() // 'ai/openai/gpt-4o'
 *
 * const parent = new CostCategory(['ai', 'openai']);
 * parent.includes(cat) // true
 * cat.includes(parent) // false
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * CostCategory value object
 * Immutable representation of a hierarchical cost category
 *
 * @class CostCategory
 */
export class CostCategory {
  /** @type {string[]} */
  #path;

  /**
   * Create a CostCategory instance
   *
   * @param {string[]} path - Array of category segments (must be non-empty)
   * @throws {ValidationError} If path is empty
   */
  constructor(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new ValidationError('Path cannot be empty', {
        code: 'EMPTY_PATH',
        field: 'path',
        value: path
      });
    }

    // Create frozen copy of path array
    this.#path = Object.freeze([...path]);

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the category path
   * @returns {string[]} Frozen array of path segments
   */
  get path() {
    return this.#path;
  }

  /**
   * Get the root category segment
   *
   * @returns {string} First segment of the path
   */
  getRoot() {
    return this.#path[0];
  }

  /**
   * Get the parent category
   *
   * @returns {CostCategory|null} Parent CostCategory or null if this is root
   */
  getParent() {
    if (this.#path.length <= 1) {
      return null;
    }
    return new CostCategory(this.#path.slice(0, -1));
  }

  /**
   * Check if this category is an ancestor of another
   * (this is a strict ancestor - does not include self)
   *
   * @param {CostCategory} other - Category to check
   * @returns {boolean} True if this is an ancestor of other
   */
  includes(other) {
    if (!(other instanceof CostCategory)) {
      return false;
    }

    // This must be shorter than other to be an ancestor
    if (this.#path.length >= other.path.length) {
      return false;
    }

    // Check if all segments of this match the prefix of other
    return this.#path.every((segment, index) => segment === other.path[index]);
  }

  /**
   * Check if this category matches another (equals or includes)
   *
   * @param {CostCategory} other - Category to check
   * @returns {boolean} True if this equals or includes other
   */
  matches(other) {
    return this.equals(other) || this.includes(other);
  }

  /**
   * Check equality with another CostCategory
   *
   * @param {CostCategory|null|undefined} other - Category to compare
   * @returns {boolean} True if paths match exactly
   */
  equals(other) {
    if (!(other instanceof CostCategory)) {
      return false;
    }

    if (this.#path.length !== other.path.length) {
      return false;
    }

    return this.#path.every((segment, index) => segment === other.path[index]);
  }

  /**
   * Convert to string representation
   *
   * @returns {string} Slash-separated path (e.g., "ai/openai/gpt-4o")
   */
  toString() {
    return this.#path.join('/');
  }

  /**
   * Convert to JSON-serializable value
   * Returns string (same as toString)
   *
   * @returns {string}
   */
  toJSON() {
    return this.toString();
  }

  /**
   * Create a CostCategory from a slash-separated string
   *
   * @param {string} str - Slash-separated path (e.g., "ai/openai/gpt-4o")
   * @returns {CostCategory}
   * @throws {ValidationError} If string is empty or results in empty path
   */
  static fromString(str) {
    if (typeof str !== 'string') {
      throw new ValidationError('Invalid CostCategory string: must be a string', {
        code: 'INVALID_CATEGORY_STRING',
        value: str
      });
    }

    // Split and filter out empty segments (handles leading/trailing slashes)
    const path = str.split('/').filter(segment => segment.length > 0);

    return new CostCategory(path);
  }

  /**
   * Create a CostCategory from JSON data
   * Handles both string and array formats
   *
   * @param {string|string[]} data - String path or array of segments
   * @returns {CostCategory}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (typeof data === 'string') {
      return CostCategory.fromString(data);
    }

    if (Array.isArray(data)) {
      return new CostCategory(data);
    }

    throw new ValidationError('Invalid CostCategory JSON: must be string or array', {
      code: 'INVALID_CATEGORY_JSON',
      value: data
    });
  }
}

export default CostCategory;
