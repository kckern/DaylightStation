/**
 * FoodItem Value Object
 * @module nutrition/entities/FoodItem
 *
 * Represents a single food item within a NutriLog entry.
 * Immutable value object with validation.
 */

import { validateFoodItem } from './schemas.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { shortIdFromUuid } from '#domains/core/utils/id.mjs';
import { foodGrams } from '#shared/contracts/health/foodQuantity.mjs';

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
  // Lifecycle / group fields (PRD Themes 2–3)
  /** @type {'item'|'group'} */
  #kind;
  /** @type {string|null} */
  #parentId;
  /** @type {string|null} */
  #photoRef;
  /** @type {boolean|undefined} — ABSENT means "legacy row, treat as settled" */
  #settled;
  /** @type {'user'|'auto'|null} */
  #settledBy;
  /** @type {string|null} */
  #settledAt;
  /** @type {'ai'|'catalog'|null} */
  #microsSource;

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
    // Lifecycle / group fields. `settled` is the one field whose ABSENCE is
    // meaningful (legacy row = settled), so it is never defaulted here.
    this.#kind = data.kind;
    this.#parentId = data.parentId;
    this.#photoRef = data.photoRef;
    if (data.settled !== undefined) this.#settled = data.settled;
    this.#settledBy = data.settledBy;
    this.#settledAt = data.settledAt;
    this.#microsSource = data.microsSource;
    this.foodId = data.foodId;
    this.nutrientProvenance = data.nutrientProvenance;
    this.originalQuantity = data.originalQuantity;
    this.manualFields = data.manualFields;
    this.cleanupFields = data.cleanupFields;

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
  // Lifecycle / group getters
  get kind() { return this.#kind; }
  get parentId() { return this.#parentId; }
  get photoRef() { return this.#photoRef; }
  /** @returns {boolean|undefined} undefined = absent = legacy row (treat as settled) */
  get settled() { return this.#settled; }
  get settledBy() { return this.#settledBy; }
  get settledAt() { return this.#settledAt; }
  get microsSource() { return this.#microsSource; }

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
      kind: this.#kind,
      parentId: this.#parentId,
      photoRef: this.#photoRef,
      // Absence must survive a copy — never widen it to null/false.
      ...(this.#settled !== undefined ? { settled: this.#settled } : {}),
      settledBy: this.#settledBy,
      settledAt: this.#settledAt,
      microsSource: this.#microsSource,
      foodId: this.foodId,
      nutrientProvenance: this.nutrientProvenance,
      originalQuantity: this.originalQuantity,
      manualFields: this.manualFields,
      cleanupFields: this.cleanupFields,
      ...updates,
    });
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
   * Create a new FoodItem from caller-supplied identity.
   * @param {object} props
   * @returns {FoodItem}
   */
  static create(props) {
    return new FoodItem(props);
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
  static fromLegacy(legacy, id, generatedUuid = null) {
    const itemUuid = legacy.uuid || legacy.id || generatedUuid;
    if (!itemUuid) throw new ValidationError('uuid is required for legacy FoodItem hydration');
    return new FoodItem({
      id: id || shortIdFromUuid(itemUuid),
      uuid: itemUuid,
      label: legacy.item,
      icon: legacy.icon || 'default',
      grams: foodGrams(legacy),
      unit: legacy.unit,
      amount: legacy.amount,
      color: legacy.noom_color,
    });
  }
}

export default FoodItem;
