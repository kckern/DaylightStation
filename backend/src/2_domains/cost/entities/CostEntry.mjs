/**
 * CostEntry Entity - Main cost event entity
 * @module domains/cost/entities/CostEntry
 *
 * Represents a single cost event in the system. This is the primary entity
 * for tracking costs, whether from usage, subscriptions, purchases, or
 * financial transactions.
 *
 * @example
 * const entry = new CostEntry({
 *   id: '20260115103000-abc123',
 *   occurredAt: new Date(),
 *   amount: new Money(42.50),
 *   category: CostCategory.fromString('ai/openai/gpt-4o'),
 *   entryType: EntryType.USAGE,
 *   attribution: new Attribution({ householdId: 'default' }),
 *   usage: new Usage(150, 'tokens'),
 *   description: 'GPT-4o API call'
 * });
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from '../value-objects/Money.mjs';
import { Usage } from '../value-objects/Usage.mjs';
import { CostCategory } from '../value-objects/CostCategory.mjs';
import { Attribution } from '../value-objects/Attribution.mjs';
import { SpreadSource } from '../value-objects/SpreadSource.mjs';
import { isCountedInSpend } from '../value-objects/EntryType.mjs';

/**
 * CostEntry entity
 * Represents a single cost event
 *
 * @class CostEntry
 */
export class CostEntry {
  /** @type {string} */
  #id;

  /** @type {Date} */
  #occurredAt;

  /** @type {Money} */
  #amount;

  /** @type {CostCategory} */
  #category;

  /** @type {Usage|null} */
  #usage;

  /** @type {string} */
  #entryType;

  /** @type {Attribution} */
  #attribution;

  /** @type {string|null} */
  #description;

  /** @type {Object} */
  #metadata;

  /** @type {SpreadSource|null} */
  #spreadSource;

  /** @type {boolean} */
  #reconcilesUsage;

  /** @type {Money|null} */
  #variance;

  /**
   * Create a CostEntry instance
   *
   * @param {Object} config - CostEntry configuration
   * @param {string} config.id - Unique identifier (required)
   * @param {Date} config.occurredAt - When the cost occurred (required)
   * @param {Money} config.amount - Cost amount (required)
   * @param {CostCategory} config.category - Cost category (required)
   * @param {string} config.entryType - Entry type from EntryType enum (required)
   * @param {Attribution} config.attribution - Attribution metadata (required)
   * @param {Usage} [config.usage=null] - Usage data if applicable
   * @param {string} [config.description=null] - Human-readable description
   * @param {Object} [config.metadata={}] - Additional metadata
   * @param {SpreadSource} [config.spreadSource=null] - Spread source if this is a spread entry
   * @param {boolean} [config.reconcilesUsage=false] - Whether this reconciles usage
   * @param {Money} [config.variance=null] - Variance amount if applicable
   * @throws {ValidationError} If required fields are missing
   */
  constructor({
    id,
    occurredAt,
    amount,
    category,
    entryType,
    attribution,
    usage = null,
    description = null,
    metadata = {},
    spreadSource = null,
    reconcilesUsage = false,
    variance = null
  }) {
    // Validate required fields
    if (!id) {
      throw new ValidationError('id is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'id'
      });
    }

    if (!amount) {
      throw new ValidationError('amount is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'amount'
      });
    }

    if (!category) {
      throw new ValidationError('category is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'category'
      });
    }

    if (!entryType) {
      throw new ValidationError('entryType is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'entryType'
      });
    }

    if (!attribution) {
      throw new ValidationError('attribution is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'attribution'
      });
    }

    this.#id = id;
    this.#occurredAt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
    this.#amount = amount;
    this.#category = category;
    this.#entryType = entryType;
    this.#attribution = attribution;
    this.#usage = usage ?? null;
    this.#description = description ?? null;
    this.#metadata = metadata || {};
    this.#spreadSource = spreadSource ?? null;
    this.#reconcilesUsage = reconcilesUsage ?? false;
    this.#variance = variance ?? null;
  }

  /**
   * Get the entry ID
   * @returns {string}
   */
  get id() {
    return this.#id;
  }

  /**
   * Get when the cost occurred
   * @returns {Date}
   */
  get occurredAt() {
    return this.#occurredAt;
  }

  /**
   * Get the cost amount
   * @returns {Money}
   */
  get amount() {
    return this.#amount;
  }

  /**
   * Get the cost category
   * @returns {CostCategory}
   */
  get category() {
    return this.#category;
  }

  /**
   * Get the usage data
   * @returns {Usage|null}
   */
  get usage() {
    return this.#usage;
  }

  /**
   * Get the entry type
   * @returns {string}
   */
  get entryType() {
    return this.#entryType;
  }

  /**
   * Get the attribution metadata
   * @returns {Attribution}
   */
  get attribution() {
    return this.#attribution;
  }

  /**
   * Get the description
   * @returns {string|null}
   */
  get description() {
    return this.#description;
  }

  /**
   * Get the metadata
   * @returns {Object}
   */
  get metadata() {
    return this.#metadata;
  }

  /**
   * Get the spread source
   * @returns {SpreadSource|null}
   */
  get spreadSource() {
    return this.#spreadSource;
  }

  /**
   * Get whether this entry reconciles usage
   * @returns {boolean}
   */
  get reconcilesUsage() {
    return this.#reconcilesUsage;
  }

  /**
   * Get the variance amount
   * @returns {Money|null}
   */
  get variance() {
    return this.#variance;
  }

  /**
   * Check if this entry counts toward spend calculations
   *
   * Returns false if reconcilesUsage is true (to avoid double counting),
   * otherwise delegates to isCountedInSpend for the entry type.
   *
   * @returns {boolean} True if this entry counts toward spend
   */
  countsInSpend() {
    if (this.#reconcilesUsage) {
      return false;
    }
    return isCountedInSpend(this.#entryType);
  }

  /**
   * Generate a unique ID for a cost entry
   *
   * Format: YYYYMMDDHHmmss-xxxxxx where xxxxxx is a random 6-char suffix
   *
   * @param {Date|string|number} timestamp - Timestamp to use for the prefix
   * @returns {string} Generated ID
   */
  static generateId(timestamp, random) {
    if (timestamp === undefined || timestamp === null) {
      throw new ValidationError('timestamp is required for generateId', {
        code: 'MISSING_TIMESTAMP',
        field: 'timestamp'
      });
    }
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (typeof random !== 'function') throw new ValidationError('random is required for generateId');

    // Format: YYYYMMDDHHmmss
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    const timestampPart = `${year}${month}${day}${hours}${minutes}${seconds}`;

    // Generate random 6-character alphanumeric suffix
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars.charAt(Math.floor(random() * chars.length));
    }

    return `${timestampPart}-${suffix}`;
  }
}

export default CostEntry;
