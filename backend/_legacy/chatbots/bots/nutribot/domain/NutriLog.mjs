/**
 * NutriLog Entity
 * @module nutribot/domain/NutriLog
 * 
 * Aggregate root for food logging entries.
 * Manages the lifecycle of a food log from creation through acceptance.
 */

import { v4 as uuidv4 } from 'uuid';
import { shortId, shortIdFromUuid, isUuid } from '../../../_lib/shortId.mjs';
import { formatLocalTimestamp } from '../../../_lib/time.mjs';
import { FoodItem } from './FoodItem.mjs';
import { getMealTimeFromHour } from './schemas.mjs';
import { validateNutriLog, LogStatuses } from './schemas.mjs';
import { ValidationError } from '../../../_lib/errors/index.mjs';
import { Timestamp } from '../../../domain/value-objects/Timestamp.mjs';

/**
 * NutriLog entity - aggregate root for food logging
 */
export class NutriLog {
  /** @type {string} */
  #id;
  /** @type {string|null|undefined} */
  #uuid;
  /** @type {string} */
  #userId;
  /** @type {string} */
  #conversationId;
  /** @type {string} */
  #status;
  /** @type {string} */
  #text;
  /** @type {object} */
  #meal;
  /** @type {FoodItem[]} */
  #items;
  /** @type {object[]} */
  #questions;
  /** @type {object} */
  #nutrition;
  /** @type {object} */
  #metadata;
  /** @type {string} */
  #timezone;
  /** @type {string} */
  #createdAt;
  /** @type {string} */
  #updatedAt;
  /** @type {string|null} */
  #acceptedAt;

  /**
   * @param {object} props - NutriLog properties
   */
  constructor(props) {
    // Normalize meal date if it's a full timestamp (legacy data fix)
    const normalizedProps = { ...props };
    
    // Handle legacy meal format (string instead of object)
    if (normalizedProps.meal && typeof normalizedProps.meal === 'string') {
      const dateStr = normalizedProps.meal;
      normalizedProps.meal = {
        date: dateStr.includes('T') ? dateStr.split('T')[0] : dateStr,
        time: 'morning' // Default fallback
      };
    } else if (normalizedProps.meal?.date && typeof normalizedProps.meal.date === 'string' && normalizedProps.meal.date.includes('T')) {
      normalizedProps.meal = { 
        ...normalizedProps.meal, 
        date: normalizedProps.meal.date.split('T')[0] 
      };
    }

    // Convert FoodItem arrays if needed
    const itemsAsObjects = (normalizedProps.items || []).map(item => 
      item instanceof FoodItem ? item.toJSON() : item
    );

    // Validate
    const result = validateNutriLog({
      ...normalizedProps,
      items: itemsAsObjects,
    });
    
    if (!result.valid) {
      throw new ValidationError('Invalid NutriLog', {
        errors: result.errors,
      });
    }

    const data = result.value;
    this.#id = data.id;
    // UUID is no longer stored or used
    this.#uuid = null;
    this.#userId = data.userId;
    this.#conversationId = data.conversationId;
    this.#status = data.status;
    this.#text = data.text;
    this.#meal = Object.freeze({ ...data.meal });
    this.#items = data.items.map(item => FoodItem.from(item));
    this.#questions = Object.freeze([...data.questions]);
    this.#nutrition = Object.freeze({ ...data.nutrition });
    this.#metadata = Object.freeze({ ...data.metadata });
    this.#timezone = data.timezone || data.metadata?.timezone || 'America/Los_Angeles';
    this.#createdAt = data.createdAt;
    this.#updatedAt = data.updatedAt;
    this.#acceptedAt = data.acceptedAt;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get id() { return this.#id; }
  // UUID getter removed
  get userId() { return this.#userId; }
  get conversationId() { return this.#conversationId; }
  get status() { return this.#status; }
  get text() { return this.#text; }
  get meal() { return this.#meal; }
  get items() { return [...this.#items]; }
  get questions() { return [...this.#questions]; }
  get nutrition() { return { ...this.#nutrition }; }
  get metadata() { return { ...this.#metadata }; }
  get timezone() { return this.#timezone; }
  get createdAt() { return this.#createdAt; }
  get updatedAt() { return this.#updatedAt; }
  get acceptedAt() { return this.#acceptedAt; }

  // ==================== Computed Properties ====================

  /**
   * Check if the log is pending confirmation
   */
  get isPending() {
    return this.#status === 'pending';
  }

  #now() {
    return formatLocalTimestamp(new Date(), this.#timezone);
  }

  /**
   * Check if the log has been accepted
   */
  get isAccepted() {
    return this.#status === 'accepted';
  }

  /**
   * Check if the log has been rejected
   */
  get isRejected() {
    return this.#status === 'rejected';
  }

  /**
   * Check if the log has been deleted
   */
  get isDeleted() {
    return this.#status === 'deleted';
  }

  /**
   * Get the number of food items
   */
  get itemCount() {
    return this.#items.length;
  }

  /**
   * Get total grams across all items
   */
  get totalGrams() {
    return this.#items.reduce((sum, item) => sum + item.grams, 0);
  }

  /**
   * Get count of items by color
   */
  get colorCounts() {
    return this.#items.reduce((counts, item) => {
      counts[item.color] = (counts[item.color] || 0) + 1;
      return counts;
    }, { green: 0, yellow: 0, orange: 0 });
  }

  /**
   * Get grams by color
   */
  get gramsByColor() {
    return this.#items.reduce((grams, item) => {
      grams[item.color] = (grams[item.color] || 0) + item.grams;
      return grams;
    }, { green: 0, yellow: 0, orange: 0 });
  }

  /**
   * Check if there are unanswered questions
   */
  get hasUnansweredQuestions() {
    return this.#questions.some(q => !q.answered);
  }

  /**
   * Get the meal date as a Date object
   */
  get mealDate() {
    return new Date(this.#meal.date);
  }

  // ==================== Status Transitions ====================

  /**
   * Accept the log (confirm items are correct)
   * @returns {NutriLog}
   */
  accept() {
    if (!this.isPending) {
      throw new ValidationError(`Cannot accept log with status: ${this.#status}`);
    }
    
    return new NutriLog({
      ...this.toJSON(),
      status: 'accepted',
      acceptedAt: this.#now(),
      updatedAt: this.#now(),
    });
  }

  /**
   * Reject the log
   * @returns {NutriLog}
   */
  reject() {
    if (!this.isPending) {
      throw new ValidationError(`Cannot reject log with status: ${this.#status}`);
    }
    
    return new NutriLog({
      ...this.toJSON(),
      status: 'rejected',
      updatedAt: this.#now(),
    });
  }

  /**
   * Delete the log (soft delete)
   * @returns {NutriLog}
   */
  delete() {
    if (this.isDeleted) {
      return this; // Already deleted
    }
    
    return new NutriLog({
      ...this.toJSON(),
      status: 'deleted',
      updatedAt: this.#now(),
    });
  }

  // ==================== Item Management ====================

  /**
   * Add a food item
   * @param {FoodItem|object} item
   * @returns {NutriLog}
   */
  addItem(item) {
    const foodItem = item instanceof FoodItem ? item : FoodItem.from(item);
    
    return new NutriLog({
      ...this.toJSON(),
      items: [...this.#items.map(i => i.toJSON()), foodItem.toJSON()],
      updatedAt: this.#now(),
    });
  }

  /**
   * Remove a food item by ID
   * @param {string} itemId
   * @returns {NutriLog}
   */
  removeItem(itemId) {
    return new NutriLog({
      ...this.toJSON(),
      items: this.#items.filter(i => i.id !== itemId).map(i => i.toJSON()),
      updatedAt: this.#now(),
    });
  }

  /**
   * Update a food item
   * @param {string} itemId
   * @param {object} updates
   * @returns {NutriLog}
   */
  updateItem(itemId, updates) {
    const items = this.#items.map(item => {
      if (item.id === itemId) {
        return item.with(updates).toJSON();
      }
      return item.toJSON();
    });

    return new NutriLog({
      ...this.toJSON(),
      items,
      updatedAt: this.#now(),
    });
  }

  /**
   * Replace all items
   * @param {FoodItem[]|object[]} items
   * @returns {NutriLog}
   */
  setItems(items) {
    const itemsAsJson = items.map(item => 
      item instanceof FoodItem ? item.toJSON() : item
    );

    return new NutriLog({
      ...this.toJSON(),
      items: itemsAsJson,
      updatedAt: this.#now(),
    });
  }

  /**
   * Update items (alias for setItems)
   * @param {FoodItem[]|object[]} items
   * @returns {NutriLog}
   */
  updateItems(items) {
    return this.setItems(items);
  }

  /**
   * Update the date and optionally time
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} [time] - Time of day (morning, afternoon, evening, night)
   * @returns {NutriLog}
   */
  updateDate(date, time) {
    const json = this.toJSON();
    return new NutriLog({
      ...json,
      date,
      meal: {
        ...json.meal,
        date,
        ...(time ? { time } : {}),
      },
      updatedAt: this.#now(),
    });
  }

  // ==================== Other Updates ====================

  /**
   * Update nutrition summary
   * @param {object} nutrition
   * @returns {NutriLog}
   */
  setNutrition(nutrition) {
    return new NutriLog({
      ...this.toJSON(),
      nutrition: { ...this.#nutrition, ...nutrition },
      updatedAt: this.#now(),
    });
  }

  /**
   * Update the text
   * @param {string} text
   * @returns {NutriLog}
   */
  setText(text) {
    return new NutriLog({
      ...this.toJSON(),
      text,
      metadata: { ...this.#metadata, originalText: this.#text },
      updatedAt: this.#now(),
    });
  }

  /**
   * Create a copy with updates
   * @param {object} updates
   * @returns {NutriLog}
   */
  with(updates) {
    return new NutriLog({
      ...this.toJSON(),
      ...updates,
      updatedAt: this.#now(),
    });
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    const json = {
      id: this.#id,
      // uuid removed
      userId: this.#userId,
      status: this.#status,
      text: this.#text,
      meal: { ...this.#meal },
      items: this.#items.map(item => item.toJSON()),
      questions: [...this.#questions],
      nutrition: { ...this.#nutrition },
      metadata: { ...this.#metadata },
      timezone: this.#timezone,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      acceptedAt: this.#acceptedAt,
    };

    // Only include conversationId if it differs from userId
    if (this.#conversationId !== this.#userId) {
      json.conversationId = this.#conversationId;
    }

    return json;
  }

  /**
   * Convert to NutriList items (denormalized)
   * @returns {object[]}
   */
  toNutriListItems() {
    return this.#items.map(item => ({
      id: item.id,
      uuid: item.uuid,
      logId: this.#id,
      // log_uuid removed
      label: item.label,
      grams: item.grams,
      color: item.color,
      status: this.#status,
      createdAt: this.#createdAt,
      acceptedAt: this.#acceptedAt,
    }));
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new pending NutriLog
   * @param {object} props
   * @returns {NutriLog}
   */
  static create(props) {
    const timezone = props.timezone || 'America/Los_Angeles';
    const now = new Date();
    // logUuid removed
    const logId = shortId();
    const meal = props.meal || {
      date: formatLocalTimestamp(now, timezone).split(' ')[0],
      time: getMealTimeFromHour(now.getHours()),
    };

    // Generate IDs for items if needed
    const items = (props.items || []).map(item => {
      const baseItem = item instanceof FoodItem ? item.toJSON() : item;
      if (!baseItem.id) {
        return FoodItem.create(baseItem).toJSON();
      }
      if (!baseItem.uuid) {
        const generatedUuid = isUuid(baseItem.id) ? baseItem.id : uuidv4();
        return { ...baseItem, uuid: generatedUuid };
      }
      return baseItem;
    });

    return new NutriLog({
      id: logId,
      // uuid removed
      userId: props.userId,
      conversationId: props.conversationId,
      status: 'pending',
      text: props.text || '',
      meal,
      items,
      questions: props.questions || [],
      nutrition: props.nutrition || {},
      metadata: {
        source: 'telegram',
        timezone,
        ...props.metadata,
      },
      timezone,
      createdAt: formatLocalTimestamp(now, timezone),
      updatedAt: formatLocalTimestamp(now, timezone),
      acceptedAt: null,
    });
  }

  /**
   * Create from plain object
   * @param {object} obj
   * @returns {NutriLog}
   */
  static from(obj, timezone = 'America/Los_Angeles') {
    if (obj instanceof NutriLog) return obj;
    return new NutriLog({ timezone, ...obj });
  }

  /**
   * Create from legacy format
   * @param {object} legacy - Legacy NutriLog from existing data
   * @param {string} userId - System user ID (from config mapping)
   * @param {string} conversationId - Channel:identifier format
   * @returns {NutriLog}
   */
  static fromLegacy(legacy, userId, conversationId, timezone = 'America/Los_Angeles') {
    const items = (legacy.food_data?.food || []).map((item) => {
      const itemUuid = item.uuid || uuidv4();
      return {
        id: shortIdFromUuid(itemUuid),
        uuid: itemUuid,
        label: item.item,
        icon: item.icon || 'default',
        grams: item.amount, // Assume same for now
        unit: item.unit,
        amount: item.amount,
        color: item.noom_color,
      };
    });

    return new NutriLog({
      id: legacy.id || legacy.uuid, // Fallback to uuid if id missing during migration
      // uuid removed
      userId,
      conversationId,
      status: legacy.status,
      text: legacy.food_data?.text || '',
      meal: {
        date: legacy.food_data?.date || formatLocalTimestamp(new Date(), timezone).split(' ')[0],
        time: legacy.food_data?.time || 'morning',
      },
      items,
      questions: legacy.food_data?.questions || [],
      nutrition: legacy.food_data?.nutrition || {},
      metadata: {
        messageId: String(legacy.message_id),
        source: 'migration',
        timezone,
      },
      timezone,
      createdAt: legacy.createdAt || formatLocalTimestamp(new Date(), timezone),
      updatedAt: legacy.updatedAt || formatLocalTimestamp(new Date(), timezone),
      acceptedAt: legacy.status === 'accepted' ? (legacy.acceptedAt || legacy.updatedAt || formatLocalTimestamp(new Date(), timezone)) : null,
    });
  }
}

export default NutriLog;
