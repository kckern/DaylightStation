/**
 * Attribution Value Object - Represents cost attribution metadata
 * @module domains/cost/value-objects/Attribution
 *
 * Immutable value object for attributing costs to households, users,
 * features, and resources. Supports flexible tagging for additional
 * categorization.
 *
 * @example
 * const attr = new Attribution({
 *   householdId: 'default',
 *   userId: 'teen',
 *   feature: 'assistant',
 *   resource: 'office_plug',
 *   tags: { room: 'office', device_type: 'computer' }
 * });
 * attr.householdId // 'default'
 * attr.tags.get('room') // 'office'
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Attribution value object
 * Immutable representation of cost attribution metadata
 *
 * @class Attribution
 */
export class Attribution {
  /** @type {string} */
  #householdId;

  /** @type {string|null} */
  #userId;

  /** @type {string|null} */
  #feature;

  /** @type {string|null} */
  #resource;

  /** @type {Map<string, string>} */
  #tags;

  /**
   * Create an Attribution instance
   *
   * @param {Object} config - Attribution configuration
   * @param {string} config.householdId - Household identifier (required)
   * @param {string} [config.userId=null] - User identifier
   * @param {string} [config.feature=null] - Feature identifier
   * @param {string} [config.resource=null] - Resource identifier
   * @param {Object|Map} [config.tags={}] - Additional attribution tags
   * @throws {ValidationError} If householdId is missing
   */
  constructor({ householdId, userId = null, feature = null, resource = null, tags = {} }) {
    if (!householdId) {
      throw new ValidationError('householdId is required', {
        code: 'MISSING_HOUSEHOLD_ID',
        field: 'householdId'
      });
    }

    this.#householdId = householdId;
    this.#userId = userId ?? null;
    this.#feature = feature ?? null;
    this.#resource = resource ?? null;

    // Convert tags to Map if needed, then freeze it
    if (tags instanceof Map) {
      this.#tags = new Map(tags);
    } else {
      this.#tags = new Map(Object.entries(tags || {}));
    }

    // Freeze the tags Map to prevent mutations
    // We need to override set/delete/clear to throw
    const frozenTags = this.#tags;
    frozenTags.set = () => {
      throw new TypeError('Cannot modify frozen Map');
    };
    frozenTags.delete = () => {
      throw new TypeError('Cannot modify frozen Map');
    };
    frozenTags.clear = () => {
      throw new TypeError('Cannot modify frozen Map');
    };

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the household identifier
   * @returns {string}
   */
  get householdId() {
    return this.#householdId;
  }

  /**
   * Get the user identifier
   * @returns {string|null}
   */
  get userId() {
    return this.#userId;
  }

  /**
   * Get the feature identifier
   * @returns {string|null}
   */
  get feature() {
    return this.#feature;
  }

  /**
   * Get the resource identifier
   * @returns {string|null}
   */
  get resource() {
    return this.#resource;
  }

  /**
   * Get the attribution tags
   * @returns {Map<string, string>}
   */
  get tags() {
    return this.#tags;
  }

  /**
   * Convert to JSON-serializable object
   *
   * Only includes non-null optional fields and non-empty tags.
   *
   * @returns {Object} JSON-serializable object
   */
  toJSON() {
    const result = {
      householdId: this.#householdId
    };

    if (this.#userId !== null) {
      result.userId = this.#userId;
    }

    if (this.#feature !== null) {
      result.feature = this.#feature;
    }

    if (this.#resource !== null) {
      result.resource = this.#resource;
    }

    if (this.#tags.size > 0) {
      result.tags = Object.fromEntries(this.#tags);
    }

    return result;
  }

  /**
   * Create an Attribution from a JSON object
   *
   * @param {Object} data - JSON object with attribution data
   * @param {string} data.householdId - Household identifier (required)
   * @param {string} [data.userId] - User identifier
   * @param {string} [data.feature] - Feature identifier
   * @param {string} [data.resource] - Resource identifier
   * @param {Object} [data.tags] - Additional attribution tags as plain object
   * @returns {Attribution}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new ValidationError('Invalid Attribution JSON: data is required', {
        code: 'INVALID_ATTRIBUTION_JSON',
        value: data
      });
    }

    return new Attribution({
      householdId: data.householdId,
      userId: data.userId ?? null,
      feature: data.feature ?? null,
      resource: data.resource ?? null,
      tags: data.tags || {}
    });
  }
}

export default Attribution;
