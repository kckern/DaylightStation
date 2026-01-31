/**
 * CostBudget Entity - Budget definition for cost tracking
 * @module domains/cost/entities/CostBudget
 *
 * Represents a spending limit for a category over a time period.
 * Supports global budgets (null category) or category-specific budgets.
 * Includes threshold checks for warning and critical alert levels.
 *
 * @example
 * const budget = new CostBudget({
 *   id: 'budget-001',
 *   name: 'AI Services Budget',
 *   category: CostCategory.fromString('ai/openai'),
 *   period: new BudgetPeriod('monthly'),
 *   amount: new Money(500),
 *   thresholds: new Thresholds({ warning: 0.8, critical: 0.95 }),
 *   householdId: 'default'
 * });
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { Money } from '../value-objects/Money.mjs';
import { CostCategory } from '../value-objects/CostCategory.mjs';
import { BudgetPeriod } from '../value-objects/BudgetPeriod.mjs';
import { Thresholds } from '../value-objects/Thresholds.mjs';

/**
 * CostBudget entity
 * Represents a spending limit for a category over a time period
 *
 * @class CostBudget
 */
export class CostBudget {
  /** @type {string} */
  #id;

  /** @type {string} */
  #name;

  /** @type {CostCategory|null} */
  #category;

  /** @type {BudgetPeriod} */
  #period;

  /** @type {Money} */
  #amount;

  /** @type {Thresholds} */
  #thresholds;

  /** @type {string} */
  #householdId;

  /**
   * Create a CostBudget instance
   *
   * @param {Object} config - CostBudget configuration
   * @param {string} config.id - Unique identifier (required)
   * @param {string} config.name - Budget name (required)
   * @param {CostCategory|null} [config.category=null] - Cost category (null for global budget)
   * @param {BudgetPeriod|string} config.period - Budget period (required, accepts string like 'monthly')
   * @param {Money} config.amount - Budget limit amount (required)
   * @param {Thresholds} [config.thresholds] - Alert thresholds (uses defaults if not provided)
   * @param {string} config.householdId - Household identifier (required)
   * @throws {ValidationError} If required fields are missing
   */
  constructor({
    id,
    name,
    category = null,
    period,
    amount,
    thresholds,
    householdId
  }) {
    // Validate required fields
    if (!id) {
      throw new ValidationError('id is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'id'
      });
    }

    if (!name) {
      throw new ValidationError('name is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'name'
      });
    }

    if (!householdId) {
      throw new ValidationError('householdId is required', {
        code: 'MISSING_REQUIRED_FIELD',
        field: 'householdId'
      });
    }

    this.#id = id;
    this.#name = name;
    this.#category = category ?? null;

    // Convert string period to BudgetPeriod if needed
    if (typeof period === 'string') {
      this.#period = new BudgetPeriod(period);
    } else {
      this.#period = period;
    }

    this.#amount = amount;

    // Use provided thresholds or defaults
    this.#thresholds = thresholds ?? new Thresholds();

    this.#householdId = householdId;
  }

  /**
   * Get the budget ID
   * @returns {string}
   */
  get id() {
    return this.#id;
  }

  /**
   * Get the budget name
   * @returns {string}
   */
  get name() {
    return this.#name;
  }

  /**
   * Get the cost category (null for global budget)
   * @returns {CostCategory|null}
   */
  get category() {
    return this.#category;
  }

  /**
   * Get the budget period
   * @returns {BudgetPeriod}
   */
  get period() {
    return this.#period;
  }

  /**
   * Get the budget amount limit
   * @returns {Money}
   */
  get amount() {
    return this.#amount;
  }

  /**
   * Get the alert thresholds
   * @returns {Thresholds}
   */
  get thresholds() {
    return this.#thresholds;
  }

  /**
   * Get the household ID
   * @returns {string}
   */
  get householdId() {
    return this.#householdId;
  }

  /**
   * Calculate remaining budget
   *
   * @param {Money} spent - Amount already spent
   * @returns {Money} Remaining budget amount
   * @throws {ValidationError} If spent exceeds budget (Money cannot be negative)
   */
  getRemaining(spent) {
    return this.#amount.subtract(spent);
  }

  /**
   * Calculate percentage of budget spent
   *
   * @param {Money} spent - Amount already spent
   * @returns {number} Percentage spent (0-100+, can exceed 100 if over budget)
   */
  getPercentSpent(spent) {
    if (this.#amount.amount === 0) {
      return spent.amount > 0 ? Infinity : 0;
    }
    return (spent.amount / this.#amount.amount) * 100;
  }

  /**
   * Check if spending has exceeded the budget
   *
   * @param {Money} spent - Amount already spent
   * @returns {boolean} True if over budget
   */
  isOverBudget(spent) {
    return spent.amount > this.#amount.amount;
  }

  /**
   * Check if spending is at warning level
   * Returns true if percent spent >= warning threshold AND < critical threshold
   *
   * @param {Money} spent - Amount already spent
   * @returns {boolean} True if at warning level (not critical)
   */
  isAtWarningLevel(spent) {
    const percentDecimal = spent.amount / this.#amount.amount;
    return percentDecimal >= this.#thresholds.warning && percentDecimal < this.#thresholds.critical;
  }

  /**
   * Check if spending is at critical level
   * Returns true if percent spent >= critical threshold
   *
   * @param {Money} spent - Amount already spent
   * @returns {boolean} True if at or above critical level
   */
  isAtCriticalLevel(spent) {
    const percentDecimal = spent.amount / this.#amount.amount;
    return percentDecimal >= this.#thresholds.critical;
  }

  /**
   * Convert to JSON-serializable object
   *
   * @returns {Object} JSON-serializable representation
   */
  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      category: this.#category ? this.#category.toJSON() : null,
      period: this.#period.toJSON(),
      amount: this.#amount.toJSON(),
      thresholds: this.#thresholds.toJSON(),
      householdId: this.#householdId
    };
  }

  /**
   * Create a CostBudget from a JSON object
   *
   * @param {Object} data - JSON data
   * @returns {CostBudget}
   * @throws {ValidationError} If data is invalid
   */
  static fromJSON(data) {
    return new CostBudget({
      id: data.id,
      name: data.name,
      category: data.category ? CostCategory.fromJSON(data.category) : null,
      period: BudgetPeriod.fromJSON(data.period),
      amount: Money.fromJSON(data.amount),
      thresholds: data.thresholds ? Thresholds.fromJSON(data.thresholds) : undefined,
      householdId: data.householdId
    });
  }
}

export default CostBudget;
