/**
 * FoodItem Value Object
 * @module nutrition/entities/FoodItem
 *
 * Represents a single food item within a NutriLog entry.
 * Immutable value object with validation.
 */

import { v4 as uuidv4 } from 'uuid';
import { validateFoodItem } from './schemas.mjs';
import { ValidationError } from '../../../0_infrastructure/utils/errors/index.mjs';
import { shortId, shortIdFromUuid } from '../../../0_infrastructure/utils/shortId.mjs';

/**
 * FoodItem value object
 */
export class FoodItem {
  /** @type {string} */
  #id;
  /** @type {string|undefined} */
  #uuid;
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
  // Nutrition fields
  /** @type {number} */
  #calories;
  /** @type {number} */
  #protein;
  /** @type {number} */
  #carbs;
  /** @type {number} */
  #fat;
  /** @type {number} */
  #fiber;
  /** @type {number} */
  #sugar;
  /** @type {number} */
  #sodium;
  /** @type {number} */
  #cholesterol;

  /**
   * @param {object} props
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
    this.#uuid = data.uuid ?? null;
    this.#label = data.label;
    this.#icon = data.icon;
    this.#grams = data.grams;
    this.#unit = data.unit;
    this.#amount = data.amount;
    this.#color = data.color;
    // Nutrition fields
    this.#calories = data.calories ?? 0;
    this.#protein = data.protein ?? 0;
    this.#carbs = data.carbs ?? 0;
    this.#fat = data.fat ?? 0;
    this.#fiber = data.fiber ?? 0;
    this.#sugar = data.sugar ?? 0;
    this.#sodium = data.sodium ?? 0;
    this.#cholesterol = data.cholesterol ?? 0;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get id() { return this.#id; }
  get uuid() { return this.#uuid; }
  get label() { return this.#label; }
  get icon() { return this.#icon; }
  get grams() { return this.#grams; }
  get unit() { return this.#unit; }
  get amount() { return this.#amount; }
  get color() { return this.#color; }
  // Nutrition getters
  get calories() { return this.#calories; }
  get protein() { return this.#protein; }
  get carbs() { return this.#carbs; }
  get fat() { return this.#fat; }
  get fiber() { return this.#fiber; }
  get sugar() { return this.#sugar; }
  get sodium() { return this.#sodium; }
  get cholesterol() { return this.#cholesterol; }

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
   * @param {Partial<object>} updates
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
      uuid: this.#uuid,
      calories: this.#calories,
      protein: this.#protein,
      carbs: this.#carbs,
      fat: this.#fat,
      fiber: this.#fiber,
      sugar: this.#sugar,
      sodium: this.#sodium,
      cholesterol: this.#cholesterol,
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
      uuid: this.#uuid,
      label: this.#label,
      icon: this.#icon,
      grams: this.#grams,
      unit: this.#unit,
      amount: this.#amount,
      color: this.#color,
      // Nutrition fields
      calories: this.#calories,
      protein: this.#protein,
      carbs: this.#carbs,
      fat: this.#fat,
      fiber: this.#fiber,
      sugar: this.#sugar,
      sodium: this.#sodium,
      cholesterol: this.#cholesterol,
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
   * @param {object} props
   * @returns {FoodItem}
   */
  static create(props) {
    return new FoodItem({
      id: shortId(),
      uuid: uuidv4(),
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
    const itemUuid = legacy.uuid || legacy.id || uuidv4();
    return new FoodItem({
      id: id || shortIdFromUuid(itemUuid),
      uuid: itemUuid,
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
