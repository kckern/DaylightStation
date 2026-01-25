// backend/src/1_domains/lifelog/entities/NutriLog.mjs
import { FoodItem } from './FoodItem.mjs';

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
    this.#meal = props.meal || { date: this.#today(), time: 'afternoon' };
    this.#items = (props.items || []).map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i));
    this.#questions = props.questions || [];
    this.#nutrition = props.nutrition || {};
    this.#metadata = props.metadata || {};
    this.#timezone = props.timezone || 'America/Los_Angeles';
    this.#createdAt = props.createdAt || nowTs24();
    this.#updatedAt = props.updatedAt || nowTs24();
    this.#acceptedAt = props.acceptedAt || null;

    Object.freeze(this);
  }

  #generateShortId() {
    return Math.random().toString(36).substring(2, 10);
  }

  #today() {
    return nowDate();
  }

  #now() {
    return nowTs24();
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
  accept() {
    if (this.#status !== 'pending') {
      throw new Error(`Cannot accept log with status: ${this.#status}`);
    }
    return this.#withUpdates({
      status: 'accepted',
      acceptedAt: this.#now()
    });
  }

  reject() {
    if (this.#status !== 'pending') {
      throw new Error(`Cannot reject log with status: ${this.#status}`);
    }
    return this.#withUpdates({ status: 'rejected' });
  }

  delete() {
    return this.#withUpdates({ status: 'deleted' });
  }

  // Item management
  addItem(item) {
    const foodItem = item instanceof FoodItem ? item : FoodItem.fromJSON(item);
    return this.#withUpdates({
      items: [...this.#items, foodItem]
    });
  }

  removeItem(itemId) {
    return this.#withUpdates({
      items: this.#items.filter(i => i.id !== itemId)
    });
  }

  updateItem(itemId, updates) {
    return this.#withUpdates({
      items: this.#items.map(i => i.id === itemId ? i.with(updates) : i)
    });
  }

  setItems(items) {
    return this.#withUpdates({
      items: items.map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i))
    });
  }

  // Other updates
  setText(text) {
    return this.#withUpdates({ text });
  }

  updateDate(date, time) {
    return this.#withUpdates({
      meal: { date, time: time || this.#meal.time }
    });
  }

  setNutrition(nutrition) {
    return this.#withUpdates({ nutrition });
  }

  #withUpdates(updates) {
    return new NutriLog({
      ...this.toJSON(),
      ...updates,
      updatedAt: this.#now()
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

  static create(props) {
    return new NutriLog({
      ...props,
      id: undefined,
      status: 'pending',
      createdAt: undefined,
      updatedAt: undefined
    });
  }

  /**
   * Create from legacy format
   * @param {Object} legacy
   * @param {string} userId
   * @param {string} conversationId
   * @param {string} timezone
   * @returns {NutriLog}
   */
  static fromLegacy(legacy, userId, conversationId, timezone) {
    const foodData = legacy.food_data || {};
    return new NutriLog({
      id: legacy.id,
      userId,
      conversationId,
      status: legacy.status || 'pending',
      text: foodData.text || '',
      meal: {
        date: foodData.date || nowDate(),
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
