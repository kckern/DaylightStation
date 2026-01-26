/**
 * NutriBot Domain Schemas
 * @module nutrition/entities/schemas
 *
 * Validation schemas for nutrition data structures.
 */

import { isShortId, isUuid } from '../../core/utils/id.mjs';

// ==================== Enums ====================

/**
 * Noom color categories for food items
 */
export const NoomColors = ['green', 'yellow', 'orange'];

/**
 * Log status lifecycle states
 */
export const LogStatuses = ['pending', 'accepted', 'rejected', 'deleted'];

/**
 * Meal time categories
 */
export const MealTimes = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Message source types
 */
export const SourceTypes = ['telegram', 'api', 'import', 'migration'];

// ==================== Type Definitions (JSDoc) ====================

/**
 * @typedef {'green' | 'yellow' | 'orange'} NoomColor
 */

/**
 * @typedef {'pending' | 'accepted' | 'rejected' | 'deleted'} LogStatus
 */

/**
 * @typedef {'morning' | 'afternoon' | 'evening' | 'night'} MealTime
 */

/**
 * @typedef {'telegram' | 'api' | 'import' | 'migration'} SourceType
 */

/**
 * @typedef {Object} FoodItemData
 * @property {string} id - Short ID (Base62) or UUID (legacy)
 * @property {string} [uuid] - Full UUID for data integrity
 * @property {string} label - Display name
 * @property {string} icon - Icon identifier
 * @property {number} grams - Weight in grams
 * @property {string} unit - Original unit
 * @property {number} amount - Original amount
 * @property {NoomColor} color - Noom color category
 */

/**
 * @typedef {Object} Meal
 * @property {string} date - ISO date (YYYY-MM-DD)
 * @property {MealTime} time - Meal time category
 */

/**
 * @typedef {Object} NutritionSummary
 * @property {number} [calories]
 * @property {number} [protein]
 * @property {number} [carbs]
 * @property {number} [fat]
 * @property {number} [fiber]
 * @property {number} [sodium]
 * @property {number} [sugar]
 */

/**
 * @typedef {Object} LogMetadata
 * @property {string} [messageId]
 * @property {SourceType} [source]
 * @property {string} [editedAt]
 * @property {string} [originalText]
 * @property {string} [aiModel]
 * @property {number} [processingTimeMs]
 */

// ==================== Validators ====================

/**
 * Validate a NoomColor
 * @param {any} value
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateNoomColor(value) {
  if (!NoomColors.includes(value)) {
    return { valid: false, errors: [`Invalid noom color: ${value}. Must be one of: ${NoomColors.join(', ')}`] };
  }
  return { valid: true };
}

/**
 * Validate a LogStatus
 * @param {any} value
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateLogStatus(value) {
  if (!LogStatuses.includes(value)) {
    return { valid: false, errors: [`Invalid log status: ${value}. Must be one of: ${LogStatuses.join(', ')}`] };
  }
  return { valid: true };
}

/**
 * Validate a MealTime
 * @param {any} value
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateMealTime(value) {
  if (!MealTimes.includes(value)) {
    return { valid: false, errors: [`Invalid meal time: ${value}. Must be one of: ${MealTimes.join(', ')}`] };
  }
  return { valid: true };
}

/**
 * Validate a FoodItem
 * @param {any} item
 * @returns {{ valid: boolean, value?: FoodItemData, errors?: string[] }}
 */
export function validateFoodItem(item) {
  const errors = [];

  if (!item || typeof item !== 'object') {
    return { valid: false, errors: ['FoodItem must be an object'] };
  }

  // ID validation (short ID or UUID)
  const isIdShort = isShortId(item.id);
  const isIdUuid = isUuid(item.id);
  if (!item.id || typeof item.id !== 'string' || (!isIdShort && !isIdUuid)) {
    errors.push('id must be a valid short ID (10 base62) or UUID');
  }

  // UUID validation (optional but recommended)
  if (item.uuid && !isUuid(item.uuid)) {
    errors.push('uuid must be a valid UUID');
  }

  // Label validation
  if (!item.label || typeof item.label !== 'string' || item.label.length < 1 || item.label.length > 200) {
    errors.push('label must be a string between 1 and 200 characters');
  }

  // Icon validation
  if (item.icon !== undefined && (typeof item.icon !== 'string' || item.icon.length > 50)) {
    errors.push('icon must be a string up to 50 characters');
  }

  // Grams validation
  if (typeof item.grams !== 'number' || item.grams <= 0 || item.grams > 10000) {
    errors.push('grams must be a positive number up to 10000');
  }

  // Unit validation
  if (!item.unit || typeof item.unit !== 'string' || item.unit.length < 1 || item.unit.length > 20) {
    errors.push('unit must be a string between 1 and 20 characters');
  }

  // Amount validation
  if (typeof item.amount !== 'number' || item.amount <= 0 || item.amount > 10000) {
    errors.push('amount must be a positive number up to 10000');
  }

  // Color validation
  const colorResult = validateNoomColor(item.color);
  if (!colorResult.valid) {
    errors.push(...colorResult.errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const normalizedUuid = item.uuid || (isIdUuid ? item.id : undefined);

  return {
    valid: true,
    value: {
      id: item.id,
      uuid: normalizedUuid,
      label: item.label,
      icon: item.icon || 'default',
      grams: item.grams,
      unit: item.unit,
      amount: item.amount,
      color: item.color,
      // Nutrition fields (optional, default to 0)
      calories: item.calories ?? 0,
      protein: item.protein ?? 0,
      carbs: item.carbs ?? 0,
      fat: item.fat ?? 0,
      fiber: item.fiber ?? 0,
      sugar: item.sugar ?? 0,
      sodium: item.sodium ?? 0,
      cholesterol: item.cholesterol ?? 0,
    },
  };
}

/**
 * Validate a Meal
 * @param {any} meal
 * @returns {{ valid: boolean, value?: Meal, errors?: string[] }}
 */
export function validateMeal(meal) {
  const errors = [];

  if (!meal || typeof meal !== 'object') {
    return { valid: false, errors: ['Meal must be an object'] };
  }

  // Date validation (YYYY-MM-DD)
  if (!meal.date || !/^\d{4}-\d{2}-\d{2}$/.test(meal.date)) {
    errors.push('date must be in YYYY-MM-DD format');
  }

  // Time validation
  const timeResult = validateMealTime(meal.time);
  if (!timeResult.valid) {
    errors.push(...timeResult.errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      date: meal.date,
      time: meal.time,
    },
  };
}

/**
 * Validate a NutriLog
 * @param {any} log
 * @returns {{ valid: boolean, value?: object, errors?: string[] }}
 */
export function validateNutriLog(log) {
  const errors = [];

  if (!log || typeof log !== 'object') {
    return { valid: false, errors: ['NutriLog must be an object'] };
  }

  // ID validation (short ID or UUID)
  const isLogIdShort = isShortId(log.id);
  const isLogIdUuid = isUuid(log.id);
  if (!log.id || typeof log.id !== 'string' || (!isLogIdShort && !isLogIdUuid)) {
    errors.push('id must be a valid short ID (10 base62) or UUID');
  }

  // UserId validation
  if (!log.userId || typeof log.userId !== 'string' || log.userId.length < 1 || log.userId.length > 100) {
    errors.push('userId must be a string between 1 and 100 characters');
  }

  // ConversationId validation (optional, defaults to userId)
  if (log.conversationId && (typeof log.conversationId !== 'string' || log.conversationId.length < 1)) {
    errors.push('conversationId must be a non-empty string');
  }

  // Status validation
  const statusResult = validateLogStatus(log.status);
  if (!statusResult.valid) {
    errors.push(...statusResult.errors);
  }

  // Text validation
  if (log.text !== undefined && (typeof log.text !== 'string' || log.text.length > 2000)) {
    errors.push('text must be a string up to 2000 characters');
  }

  // Meal validation
  const mealResult = validateMeal(log.meal);
  if (!mealResult.valid) {
    errors.push(...mealResult.errors.map(e => `meal: ${e}`));
  }

  // Items validation
  if (!Array.isArray(log.items)) {
    errors.push('items must be an array');
  } else if (log.items.length > 50) {
    errors.push('items cannot exceed 50 items');
  } else {
    log.items.forEach((item, index) => {
      const itemResult = validateFoodItem(item);
      if (!itemResult.valid) {
        errors.push(...itemResult.errors.map(e => `items[${index}]: ${e}`));
      }
    });
  }

  // Timestamps validation
  if (!log.createdAt || typeof log.createdAt !== 'string') {
    errors.push('createdAt must be a timestamp string (local time)');
  }
  if (!log.updatedAt || typeof log.updatedAt !== 'string') {
    errors.push('updatedAt must be a timestamp string (local time)');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      id: log.id,
      userId: log.userId,
      conversationId: log.conversationId || log.userId,
      status: log.status,
      text: log.text || '',
      meal: mealResult.value,
      items: log.items.map(item => validateFoodItem(item).value),
      questions: log.questions || [],
      nutrition: log.nutrition || {},
      metadata: {
        messageId: log.metadata?.messageId,
        source: log.metadata?.source || 'telegram',
        editedAt: log.metadata?.editedAt,
        originalText: log.metadata?.originalText,
        aiModel: log.metadata?.aiModel,
        processingTimeMs: log.metadata?.processingTimeMs,
      },
      timezone: log.timezone || log.metadata?.timezone || 'America/Los_Angeles',
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      acceptedAt: log.acceptedAt || null,
    },
  };
}

// ==================== Utility Functions ====================

/**
 * Determine meal time from hour of day
 * @param {number} hour - Hour (0-23)
 * @returns {MealTime}
 */
export function getMealTimeFromHour(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Get display label for meal time
 * @param {MealTime} time
 * @returns {string}
 */
export function getMealLabel(time) {
  const labels = {
    morning: 'Breakfast',
    afternoon: 'Lunch',
    evening: 'Dinner',
    night: 'Late Night',
  };
  return labels[time] || time;
}

/**
 * Get display label for noom color
 * @param {NoomColor} color
 * @returns {string}
 */
export function getColorLabel(color) {
  const labels = {
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
  };
  return labels[color] || color;
}

export default {
  NoomColors,
  LogStatuses,
  MealTimes,
  SourceTypes,
  validateNoomColor,
  validateLogStatus,
  validateMealTime,
  validateFoodItem,
  validateMeal,
  validateNutriLog,
  getMealTimeFromHour,
  getMealLabel,
  getColorLabel,
};
