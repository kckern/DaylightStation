/**
 * FoodItem Value Object
 * @module nutribot/domain/FoodItem
 * 
 * Represents a single food item within a NutriLog entry.
 * Immutable value object with validation.
 */

import { v4 as uuidv4 } from 'uuid';
import { validateFoodItem } from './schemas.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * FoodItem value object
 * @typedef {Object} FoodItemProps
 * @property {string} id - UUID
 * @property {string} label - Display name
 * @property {string} icon - Icon identifier
 * @property {number} grams - Weight in grams
 * @property {string} unit - Original unit
 * @property {number} amount - Original amount
 * @property {string} color - Noom color (green/yellow/orange)
 */

export class FoodItem {
  /** @type {string} */
  #id;
  /** @type {string} */
  #label;
  /** @type {string} */
  #icon;
  /** @type {number} */
  #grams;
  /** @type {string} */
  #unit;
  /** @type {number} */
  #amount;
  /** @type {string} */
  #color;

  /**
   * @param {FoodItemProps} props
   */
  constructor(props) {
    // Validate
    const result = validateFoodItem(props);
    if (!result.valid) {
      throw new ValidationError('Invalid FoodItem', { 
        errors: result.errors 
      });
    }

    const data = result.value;
    this.#id = data.id;
    this.#label = data.label;
    this.#icon = data.icon;
    this.#grams = data.grams;
    this.#unit = data.unit;
    this.#amount = data.amount;
    this.#color = data.color;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get id() { return this.#id; }
  get label() { return this.#label; }
  get icon() { return this.#icon; }
  get grams() { return this.#grams; }
  get unit() { return this.#unit; }
  get amount() { return this.#amount; }
  get color() { return this.#color; }

  // ==================== Computed Properties ====================

  /**
   * Check if this is a "green" (low calorie density) food
   */
  get isGreen() {
    return this.#color === 'green';
  }

  /**
   * Check if this is a "yellow" (moderate calorie density) food
   */
  get isYellow() {
    return this.#color === 'yellow';
  }

  /**
   * Check if this is an "orange" (high calorie density) food
   */
  get isOrange() {
    return this.#color === 'orange';
  }

  /**
   * Get display string with amount and unit
   */
  get displayAmount() {
    return `${this.#amount}${this.#unit}`;
  }

  // ==================== Methods ====================

  /**
   * Create a copy with updated properties
   * @param {Partial<FoodItemProps>} updates
   * @returns {FoodItem}
   */
  with(updates) {
    return new FoodItem({
      id: this.#id,
      label: this.#label,
      icon: this.#icon,
      grams: this.#grams,
      unit: this.#unit,
      amount: this.#amount,
      color: this.#color,
      ...updates,
    });
  }

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.#id,
      label: this.#label,
      icon: this.#icon,
      grams: this.#grams,
      unit: this.#unit,
      amount: this.#amount,
      color: this.#color,
    };
  }

  /**
   * Check equality
   * @param {FoodItem} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof FoodItem)) return false;
    return this.#id === other.id;
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new FoodItem with auto-generated ID
   * @param {Omit<FoodItemProps, 'id'>} props
   * @returns {FoodItem}
   */
  static create(props) {
    return new FoodItem({
      id: uuidv4(),
      ...props,
    });
  }

  /**
   * Create from plain object
   * @param {object} obj
   * @returns {FoodItem}
   */
  static from(obj) {
    if (obj instanceof FoodItem) return obj;
    return new FoodItem(obj);
  }

  /**
   * Create from legacy format
   * @param {object} legacy - Legacy food item from existing data
   * @param {string} [id] - Optional ID (will be generated if not provided)
   * @returns {FoodItem}
   */
  static fromLegacy(legacy, id) {
    return new FoodItem({
      id: id || uuidv4(),
      label: legacy.item,
      icon: legacy.icon || 'default',
      grams: legacy.amount, // Assume same as amount for now
      unit: legacy.unit,
      amount: legacy.amount,
      color: legacy.noom_color,
    });
  }
}

export default FoodItem;
