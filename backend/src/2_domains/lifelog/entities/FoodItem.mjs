// backend/src/1_domains/lifelog/entities/FoodItem.mjs
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * @typedef {Object} FoodItemProps
 * @property {string} [id]
 * @property {string} [uuid]
 * @property {string} label
 * @property {string} [icon]
 * @property {number} grams
 * @property {string} [unit]
 * @property {number} [amount]
 * @property {'green'|'yellow'|'orange'} [color]
 * @property {number} [calories]
 * @property {number} [protein]
 * @property {number} [carbs]
 * @property {number} [fat]
 * @property {number} [fiber]
 * @property {number} [sugar]
 * @property {number} [sodium]
 * @property {number} [cholesterol]
 */

/**
 * FoodItem - Immutable value object representing a food item with nutrition data
 */
export class FoodItem {
  #id;
  #uuid;
  #label;
  #icon;
  #grams;
  #unit;
  #amount;
  #color;
  #calories;
  #protein;
  #carbs;
  #fat;
  #fiber;
  #sugar;
  #sodium;
  #cholesterol;

  /**
   * @param {FoodItemProps} props
   */
  constructor(props) {
    if (!props.id || !props.uuid) throw new ValidationError('FoodItem id and uuid are required');
    this.#id = props.id;
    this.#uuid = props.uuid;
    this.#label = props.label;
    this.#icon = props.icon || '';
    this.#grams = props.grams || 0;
    this.#unit = props.unit || 'g';
    this.#amount = props.amount ?? props.grams ?? 0;
    this.#color = props.color || 'yellow';
    this.#calories = props.calories || 0;
    this.#protein = props.protein || 0;
    this.#carbs = props.carbs || 0;
    this.#fat = props.fat || 0;
    this.#fiber = props.fiber || 0;
    this.#sugar = props.sugar || 0;
    this.#sodium = props.sodium || 0;
    this.#cholesterol = props.cholesterol || 0;

    Object.freeze(this);
  }

  // Getters
  get id() { return this.#id; }
  get uuid() { return this.#uuid; }
  get label() { return this.#label; }
  get icon() { return this.#icon; }
  get grams() { return this.#grams; }
  get unit() { return this.#unit; }
  get amount() { return this.#amount; }
  get color() { return this.#color; }
  get calories() { return this.#calories; }
  get protein() { return this.#protein; }
  get carbs() { return this.#carbs; }
  get fat() { return this.#fat; }
  get fiber() { return this.#fiber; }
  get sugar() { return this.#sugar; }
  get sodium() { return this.#sodium; }
  get cholesterol() { return this.#cholesterol; }

  // Computed properties
  get isGreen() { return this.#color === 'green'; }
  get isYellow() { return this.#color === 'yellow'; }
  get isOrange() { return this.#color === 'orange'; }
  get displayAmount() { return `${this.#amount}${this.#unit}`; }

  /**
   * Create new FoodItem with updated properties
   * @param {Partial<FoodItemProps>} updates
   * @returns {FoodItem}
   */
  with(updates) {
    return new FoodItem({
      id: this.#id,
      uuid: this.#uuid,
      label: this.#label,
      icon: this.#icon,
      grams: this.#grams,
      unit: this.#unit,
      amount: this.#amount,
      color: this.#color,
      calories: this.#calories,
      protein: this.#protein,
      carbs: this.#carbs,
      fat: this.#fat,
      fiber: this.#fiber,
      sugar: this.#sugar,
      sodium: this.#sodium,
      cholesterol: this.#cholesterol,
      ...updates
    });
  }

  /**
   * Create new FoodItem with auto-generated IDs
   * @param {Omit<FoodItemProps, 'id' | 'uuid'>} props
   * @returns {FoodItem}
   */
  static create(props) {
    return new FoodItem(props);
  }

  /**
   * Create from legacy format
   * @param {Object} legacy - Legacy food item with item/noom_color fields
   * @param {string} [id]
   * @returns {FoodItem}
   */
  static fromLegacy(legacy, id) {
    return new FoodItem({
      id: id || legacy.uuid?.substring(0, 8),
      uuid: legacy.uuid,
      label: legacy.item || legacy.label,
      icon: legacy.icon || '',
      grams: legacy.amount || legacy.grams || 0,
      unit: legacy.unit || 'g',
      amount: legacy.amount || legacy.grams || 0,
      color: legacy.noom_color || legacy.color || 'yellow',
      calories: legacy.calories || 0,
      protein: legacy.protein || 0,
      carbs: legacy.carbs || 0,
      fat: legacy.fat || 0,
      fiber: legacy.fiber || 0,
      sugar: legacy.sugar || 0,
      sodium: legacy.sodium || 0,
      cholesterol: legacy.cholesterol || 0
    });
  }

  /**
   * Check equality by ID
   * @param {FoodItem} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof FoodItem && this.#id === other.id;
  }
}

export default FoodItem;
