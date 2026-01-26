// backend/src/1_domains/lifelog/entities/NutriLog.mjs
import { FoodItem } from './FoodItem.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {'pending'|'accepted'|'rejected'|'deleted'} NutriLogStatus
 * @typedef {'morning'|'afternoon'|'evening'|'night'} MealTime
 */

/**
 * @typedef {Object} NutriLogProps
 * @property {string} [id]
 * @property {string} userId
 * @property {string} [conversationId]
 * @property {NutriLogStatus} [status]
 * @property {string} text
 * @property {{date: string, time: MealTime}} meal
 * @property {Array<FoodItem|Object>} [items]
 * @property {Object[]} [questions]
 * @property {Object} [nutrition]
 * @property {Object} [metadata]
 * @property {string} [timezone]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string|null} [acceptedAt]
 */

/**
 * NutriLog - Aggregate root for meal logs
 */
export class NutriLog {
  #id;
  #userId;
  #conversationId;
  #status;
  #text;
  #meal;
  #items;
  #questions;
  #nutrition;
  #metadata;
  #timezone;
  #createdAt;
  #updatedAt;
  #acceptedAt;

  /**
   * @param {NutriLogProps} props
   */
  constructor(props) {
    this.#id = props.id || this.#generateShortId();
    this.#userId = props.userId;
    this.#conversationId = props.conversationId || props.userId;
    this.#status = props.status || 'pending';
    this.#text = props.text || '';
    this.#meal = props.meal;
    this.#items = (props.items || []).map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i));
    this.#questions = props.questions || [];
    this.#nutrition = props.nutrition || {};
    this.#metadata = props.metadata || {};
    this.#timezone = props.timezone || 'America/Los_Angeles';
    this.#createdAt = props.createdAt;
    this.#updatedAt = props.updatedAt;
    this.#acceptedAt = props.acceptedAt || null;

    Object.freeze(this);
  }

  #generateShortId() {
    return Math.random().toString(36).substring(2, 10);
  }

  // Getters
  get id() { return this.#id; }
  get userId() { return this.#userId; }
  get conversationId() { return this.#conversationId; }
  get status() { return this.#status; }
  get text() { return this.#text; }
  get meal() { return { ...this.#meal }; }
  get items() { return [...this.#items]; }
  get questions() { return [...this.#questions]; }
  get nutrition() { return { ...this.#nutrition }; }
  get metadata() { return { ...this.#metadata }; }
  get timezone() { return this.#timezone; }
  get createdAt() { return this.#createdAt; }
  get updatedAt() { return this.#updatedAt; }
  get acceptedAt() { return this.#acceptedAt; }

  // Status checks
  get isPending() { return this.#status === 'pending'; }
  get isAccepted() { return this.#status === 'accepted'; }
  get isRejected() { return this.#status === 'rejected'; }
  get isDeleted() { return this.#status === 'deleted'; }

  // Computed properties
  get itemCount() { return this.#items.length; }

  get totalCalories() {
    return this.#items.reduce((sum, item) => sum + (item.calories || 0), 0);
  }

  get totalProtein() {
    return this.#items.reduce((sum, item) => sum + (item.protein || 0), 0);
  }

  get colorCounts() {
    return {
      green: this.#items.filter(i => i.color === 'green').length,
      yellow: this.#items.filter(i => i.color === 'yellow').length,
      orange: this.#items.filter(i => i.color === 'orange').length
    };
  }

  get hasUnansweredQuestions() {
    return this.#questions.some(q => !q.answered);
  }

  // Status transitions
  /**
   * Accept the log
   * @param {string} timestamp - Timestamp for the acceptance (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   * @throws {Error} If log is not in pending status
   */
  accept(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for accept');
    }
    if (this.#status !== 'pending') {
      throw new Error(`Cannot accept log with status: ${this.#status}`);
    }
    return this.#withUpdates({
      status: 'accepted',
      acceptedAt: timestamp
    }, timestamp);
  }

  /**
   * Reject the log
   * @param {string} timestamp - Timestamp for the rejection (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   * @throws {Error} If log is not in pending status
   */
  reject(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for reject');
    }
    if (this.#status !== 'pending') {
      throw new Error(`Cannot reject log with status: ${this.#status}`);
    }
    return this.#withUpdates({ status: 'rejected' }, timestamp);
  }

  /**
   * Delete the log
   * @param {string} timestamp - Timestamp for the deletion (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  delete(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for delete');
    }
    return this.#withUpdates({ status: 'deleted' }, timestamp);
  }

  // Item management
  /**
   * Add an item to the log
   * @param {Object|FoodItem} item - Item to add
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  addItem(item, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for addItem');
    }
    const foodItem = item instanceof FoodItem ? item : FoodItem.fromJSON(item);
    return this.#withUpdates({
      items: [...this.#items, foodItem]
    }, timestamp);
  }

  /**
   * Remove an item from the log
   * @param {string} itemId - ID of item to remove
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  removeItem(itemId, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for removeItem');
    }
    return this.#withUpdates({
      items: this.#items.filter(i => i.id !== itemId)
    }, timestamp);
  }

  /**
   * Update an item in the log
   * @param {string} itemId - ID of item to update
   * @param {Object} updates - Updates to apply
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  updateItem(itemId, updates, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for updateItem');
    }
    return this.#withUpdates({
      items: this.#items.map(i => i.id === itemId ? i.with(updates) : i)
    }, timestamp);
  }

  /**
   * Set all items in the log
   * @param {Array} items - Items to set
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  setItems(items, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for setItems');
    }
    return this.#withUpdates({
      items: items.map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i))
    }, timestamp);
  }

  // Other updates
  /**
   * Set the text description
   * @param {string} text - Text to set
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  setText(text, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for setText');
    }
    return this.#withUpdates({ text }, timestamp);
  }

  /**
   * Update the meal date/time
   * @param {string} date - Date string (YYYY-MM-DD)
   * @param {string} time - Meal time
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  updateDate(date, time, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for updateDate');
    }
    return this.#withUpdates({
      meal: { date, time: time || this.#meal.time }
    }, timestamp);
  }

  /**
   * Set nutrition data
   * @param {Object} nutrition - Nutrition data
   * @param {string} timestamp - Timestamp for the update (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  setNutrition(nutrition, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for setNutrition');
    }
    return this.#withUpdates({ nutrition }, timestamp);
  }

  /**
   * Create new NutriLog with updates
   * @param {Object} updates - Updates to apply
   * @param {string} timestamp - Timestamp for updatedAt
   * @returns {NutriLog}
   * @private
   */
  #withUpdates(updates, timestamp) {
    return new NutriLog({
      ...this.toJSON(),
      ...updates,
      updatedAt: timestamp
    });
  }

  /**
   * Convert items to denormalized list format
   * @returns {Object[]}
   */
  toNutriListItems() {
    return this.#items.map(item => ({
      ...item.toJSON(),
      logId: this.#id,
      date: this.#meal.date,
      status: this.#status,
      createdAt: this.#createdAt,
      acceptedAt: this.#acceptedAt
    }));
  }

  toJSON() {
    return {
      id: this.#id,
      userId: this.#userId,
      conversationId: this.#conversationId,
      status: this.#status,
      text: this.#text,
      meal: { ...this.#meal },
      items: this.#items.map(i => i.toJSON()),
      questions: [...this.#questions],
      nutrition: { ...this.#nutrition },
      metadata: { ...this.#metadata },
      timezone: this.#timezone,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      acceptedAt: this.#acceptedAt
    };
  }

  static fromJSON(obj, timezone) {
    return new NutriLog({
      ...obj,
      timezone: timezone || obj.timezone
    });
  }

  /**
   * Create a new NutriLog
   * @param {NutriLogProps} props - Properties for the log
   * @param {string} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   * @throws {ValidationError} If timestamp is not provided
   */
  static create(props, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for NutriLog.create');
    }
    return new NutriLog({
      ...props,
      id: undefined,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  /**
   * Create from legacy format
   * @param {Object} legacy
   * @param {string} userId
   * @param {string} conversationId
   * @param {string} timezone
   * @param {string} [currentDate] - Current date for default meal date (required if no foodData.date)
   * @returns {NutriLog}
   */
  static fromLegacy(legacy, userId, conversationId, timezone, currentDate) {
    const foodData = legacy.food_data || {};
    const mealDate = foodData.date || currentDate;
    if (!mealDate) {
      throw new ValidationError('currentDate is required for NutriLog.fromLegacy when food_data.date is missing');
    }
    return new NutriLog({
      id: legacy.id,
      userId,
      conversationId,
      status: legacy.status || 'pending',
      text: foodData.text || '',
      meal: {
        date: mealDate,
        time: foodData.time || 'afternoon'
      },
      items: (foodData.food || []).map(f => FoodItem.fromLegacy(f)),
      questions: foodData.questions || [],
      nutrition: foodData.nutrition || {},
      metadata: { messageId: legacy.message_id },
      timezone,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      acceptedAt: legacy.acceptedAt
    });
  }
}
