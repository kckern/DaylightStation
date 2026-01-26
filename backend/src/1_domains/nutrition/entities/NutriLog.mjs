/**
 * NutriLog Entity
 * @module nutrition/entities/NutriLog
 *
 * Aggregate root for food logging entries.
 * Manages the lifecycle of a food log from creation through acceptance.
 */

import { v4 as uuidv4 } from 'uuid';
import { shortId, shortIdFromUuid, isUuid } from '../../core/utils/id.mjs';
import { formatLocalTimestamp } from '../../../0_infrastructure/utils/time.mjs';
import { FoodItem } from './FoodItem.mjs';
import { getMealTimeFromHour, validateNutriLog, LogStatuses } from './schemas.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

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

  /**
   * Format a timestamp for this log's timezone
   * @param {Date} date - Date to format (required)
   * @returns {string} Formatted timestamp
   * @private
   */
  #formatTimestamp(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new ValidationError('Valid Date required for timestamp', {
        field: 'timestamp',
        received: date,
      });
    }
    return formatLocalTimestamp(date, this.#timezone);
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
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  accept(timestamp) {
    if (!this.isPending) {
      throw new ValidationError(`Cannot accept log with status: ${this.#status}`);
    }

    const formatted = this.#formatTimestamp(timestamp);
    return new NutriLog({
      ...this.toJSON(),
      status: 'accepted',
      acceptedAt: formatted,
      updatedAt: formatted,
    });
  }

  /**
   * Reject the log
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  reject(timestamp) {
    if (!this.isPending) {
      throw new ValidationError(`Cannot reject log with status: ${this.#status}`);
    }

    return new NutriLog({
      ...this.toJSON(),
      status: 'rejected',
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Delete the log (soft delete)
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  delete(timestamp) {
    if (this.isDeleted) {
      return this; // Already deleted
    }

    return new NutriLog({
      ...this.toJSON(),
      status: 'deleted',
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  // ==================== Item Management ====================

  /**
   * Add a food item
   * @param {FoodItem|object} item
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  addItem(item, timestamp) {
    const foodItem = item instanceof FoodItem ? item : FoodItem.from(item);

    return new NutriLog({
      ...this.toJSON(),
      items: [...this.#items.map(i => i.toJSON()), foodItem.toJSON()],
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Remove a food item by ID
   * @param {string} itemId
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  removeItem(itemId, timestamp) {
    return new NutriLog({
      ...this.toJSON(),
      items: this.#items.filter(i => i.id !== itemId).map(i => i.toJSON()),
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Update a food item
   * @param {string} itemId
   * @param {object} updates
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  updateItem(itemId, updates, timestamp) {
    const items = this.#items.map(item => {
      if (item.id === itemId) {
        return item.with(updates).toJSON();
      }
      return item.toJSON();
    });

    return new NutriLog({
      ...this.toJSON(),
      items,
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Replace all items
   * @param {FoodItem[]|object[]} items
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  setItems(items, timestamp) {
    const itemsAsJson = items.map(item =>
      item instanceof FoodItem ? item.toJSON() : item
    );

    return new NutriLog({
      ...this.toJSON(),
      items: itemsAsJson,
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Update items (alias for setItems)
   * @param {FoodItem[]|object[]} items
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  updateItems(items, timestamp) {
    return this.setItems(items, timestamp);
  }

  /**
   * Update the date and optionally time
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} [time] - Time of day (morning, afternoon, evening, night)
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  updateDate(date, time, timestamp) {
    const json = this.toJSON();
    return new NutriLog({
      ...json,
      date,
      meal: {
        ...json.meal,
        date,
        ...(time ? { time } : {}),
      },
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  // ==================== Other Updates ====================

  /**
   * Update nutrition summary
   * @param {object} nutrition
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  setNutrition(nutrition, timestamp) {
    return new NutriLog({
      ...this.toJSON(),
      nutrition: { ...this.#nutrition, ...nutrition },
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Update the text
   * @param {string} text
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  setText(text, timestamp) {
    return new NutriLog({
      ...this.toJSON(),
      text,
      metadata: { ...this.#metadata, originalText: this.#text },
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }

  /**
   * Create a copy with updates
   * @param {object} updates
   * @param {Date} timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  with(updates, timestamp) {
    return new NutriLog({
      ...this.toJSON(),
      ...updates,
      updatedAt: this.#formatTimestamp(timestamp),
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
   * @param {Date} props.timestamp - Current timestamp (required)
   * @returns {NutriLog}
   */
  static create(props) {
    const { timestamp } = props;
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      throw new ValidationError('timestamp is required for NutriLog.create', {
        field: 'timestamp',
        received: timestamp,
      });
    }

    const timezone = props.timezone || 'America/Los_Angeles';
    const logId = shortId();
    const meal = props.meal || {
      date: formatLocalTimestamp(timestamp, timezone).split(' ')[0],
      time: getMealTimeFromHour(timestamp.getHours()),
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

    const formattedTimestamp = formatLocalTimestamp(timestamp, timezone);
    return new NutriLog({
      id: logId,
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
      createdAt: formattedTimestamp,
      updatedAt: formattedTimestamp,
      acceptedAt: null,
    });
  }

  /**
   * Create from plain object
   * @param {object} obj
   * @param {string} [timezone='America/Los_Angeles']
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
   * @param {string} [timezone='America/Los_Angeles']
   * @param {Date} currentTimestamp - Current timestamp for fallback values (required)
   * @returns {NutriLog}
   */
  static fromLegacy(legacy, userId, conversationId, timezone = 'America/Los_Angeles', currentTimestamp) {
    if (!(currentTimestamp instanceof Date) || isNaN(currentTimestamp.getTime())) {
      throw new ValidationError('currentTimestamp is required for NutriLog.fromLegacy', {
        field: 'currentTimestamp',
        received: currentTimestamp,
      });
    }

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

    const fallbackTimestamp = formatLocalTimestamp(currentTimestamp, timezone);
    return new NutriLog({
      id: legacy.id || legacy.uuid, // Fallback to uuid if id missing during migration
      userId,
      conversationId,
      status: legacy.status,
      text: legacy.food_data?.text || '',
      meal: {
        date: legacy.food_data?.date || fallbackTimestamp.split(' ')[0],
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
      createdAt: legacy.createdAt || fallbackTimestamp,
      updatedAt: legacy.updatedAt || fallbackTimestamp,
      acceptedAt: legacy.status === 'accepted' ? (legacy.acceptedAt || legacy.updatedAt || fallbackTimestamp) : null,
    });
  }
}

export default NutriLog;
