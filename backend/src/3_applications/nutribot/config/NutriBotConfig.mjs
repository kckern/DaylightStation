/**
 * NutriBot Configuration Loader
 * @module nutribot/config/NutriBotConfig
 *
 * Validates NutriBot policy and provides nutrition goals for users.
 *
 * NOTE: Identity resolution (conversation ID -> username) is now handled
 * by UserResolver in the infrastructure layer. This config only handles
 * bot-specific policy such as nutrition goals and storage resource selection.
 */

// Infrastructure imports
import { ValidationError } from '#apps/common/errors/SemanticErrors.mjs';

// Single source of truth for default nutrition goals
// calories_min/calories_max define the acceptable calorie range
// For backwards compatibility, 'calories' is treated as the max if min/max not specified
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000, // Legacy single value (treated as max if min/max not set)
  calories_min: 1600, // Minimum calorie target
  calories_max: 2000, // Maximum calorie target
  protein: 150,
  carbs: 200,
  fat: 65,
  fiber: 30,
  sodium: 2300,
};

/**
 * Validate NutriBot configuration
 * @param {object} config
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }

  // Bot validation
  if (!config.bot?.name) errors.push('bot.name is required');
  if (!config.bot?.displayName) errors.push('bot.displayName is required');

  if (!config.messaging?.botId) errors.push('messaging.botId is required');

  // Users validation - still needed for legacy goals/settings lookup
  // Identity resolution is now handled by UserResolver
  if (config.users && !Array.isArray(config.users)) {
    errors.push('users must be an array if provided');
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * NutriBot configuration manager
 *
 * Handles:
 * - Validating bot policy
 * - Delegating storage address projection
 * - User nutrition goals lookup
 *
 * NOTE: Identity resolution is NOT handled here. Use UserResolver for
 * mapping conversation IDs / platform IDs to system usernames.
 */
export class NutriBotConfig {
  /** @type {object} */
  #config;

  /** @type {Object} */
  #logger;

  /** @type {Object|null} */
  #readUserGoals;

  /** @type {Map<string, object>} User goals/settings by username */
  #userSettings = new Map();

  /**
   * @param {object} config - Validated configuration object
   * @param {Object} [options] - Options
   * @param {Object} [options.logger] - Logger instance
   * @param {Function} [options.readUserGoals] - Semantic user-goal projection.
   */
  constructor(config, options = {}) {
    // Validate config
    const result = validateConfig(config);
    if (!result.valid) {
      throw new ValidationError('Invalid NutriBot configuration', {
        errors: result.errors,
      });
    }

    this.#config = config;
    this.#logger = options.logger || console;
    this.#readUserGoals = options.readUserGoals || (() => null);
    this.#buildUserSettings();

    Object.freeze(this);
  }

  /**
   * Build internal lookup map for user settings (goals, timezone, etc.)
   * This is NOT for identity resolution - just for user-specific config
   */
  #buildUserSettings() {
    if (!Array.isArray(this.#config.users)) return;

    for (const mapping of this.#config.users) {
      if (!mapping.systemUser) continue;

      // Store settings by systemUser (username)
      this.#userSettings.set(mapping.systemUser, {
        displayName: mapping.displayName,
        timezone: mapping.timezone,
        settings: mapping.settings,
        goals: mapping.goals,
      });
    }
  }

  // ==================== Bot Info ====================

  /**
   * Get bot name
   */
  get botName() {
    return this.#config.bot.name;
  }

  /**
   * Get bot display name
   */
  get botDisplayName() {
    return this.#config.bot.displayName;
  }

  /**
   * Get messaging bot ID
   */
  get messagingBotId() {
    return this.#config.messaging?.botId;
  }

  // ==================== User Settings ====================

  /**
   * Get user's timezone
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getUserTimezone(username) {
    // Try user settings from config
    const settings = this.#userSettings.get(username);
    if (settings?.timezone) {
      return settings.timezone;
    }

    // Fall back to config default
    return this.getDefaultTimezone();
  }

  /**
   * Get the configured default timezone.
   * @returns {string}
   */
  getDefaultTimezone() {
    return this.#config.defaultTimezone || 'America/Los_Angeles';
  }

  // ==================== User Goals ====================

  /**
   * Default nutrition goals (fallback)
   * @private
   */
  static #DEFAULT_GOALS = DEFAULT_NUTRITION_GOALS;

  /**
   * Get user's nutrition goals
   * @param {string} username - System username (NOT conversation ID)
   * @returns {Object} - { calories, protein, carbs, fat, fiber, sodium }
   */
  getUserGoals(username) {
    let rawGoals = null;

    try {
      const projectedGoals = this.#readUserGoals(username);
      if (projectedGoals) {
        rawGoals = { ...NutriBotConfig.#DEFAULT_GOALS, ...projectedGoals };
      }
    } catch (e) {
      // Ignore and fall back to config mappings
    }

    if (!rawGoals) {
      // Try user settings from config
      const settings = this.#userSettings.get(username);
      if (!settings) {
        this.#logger.warn?.('nutribot.goals.fallback.default', { userId: username });
        rawGoals = this.getDefaultGoals();
      } else if (!settings.goals) {
        this.#logger.warn?.('nutribot.goals.fallback.mapping', { userId: username });
        rawGoals = this.getDefaultGoals();
      } else {
        // Merge with defaults to ensure all fields exist
        rawGoals = {
          ...NutriBotConfig.#DEFAULT_GOALS,
          ...settings.goals,
        };
      }
    }

    // Normalize calorie goals to support min/max range
    return NutriBotConfig.normalizeCalorieGoals(rawGoals);
  }

  /**
   * Normalize calorie goals to ensure both min/max values exist
   * Handles backwards compatibility with single 'calories' value
   * @param {Object} goals - Raw goals object
   * @returns {Object} - Goals with normalized calories_min/calories_max
   */
  static normalizeCalorieGoals(goals) {
    const normalized = { ...goals };

    // If calories_min and calories_max are both specified, use them
    if (normalized.calories_min !== undefined && normalized.calories_max !== undefined) {
      // Both specified - ensure calories is set to max for backwards compat
      normalized.calories = normalized.calories_max;
    } else if (normalized.calories_min !== undefined && normalized.calories_max === undefined) {
      // Only min specified - set max to same as legacy calories or min + 400
      normalized.calories_max = normalized.calories || normalized.calories_min + 400;
      normalized.calories = normalized.calories_max;
    } else if (normalized.calories_max !== undefined && normalized.calories_min === undefined) {
      // Only max specified - set min to 80% of max
      normalized.calories_min = Math.round(normalized.calories_max * 0.8);
      normalized.calories = normalized.calories_max;
    } else if (normalized.calories !== undefined) {
      // Legacy single value - treat as max, set min to 80% of it
      normalized.calories_max = normalized.calories;
      normalized.calories_min = Math.round(normalized.calories * 0.8);
    }

    return normalized;
  }

  /**
   * Get default nutrition goals
   * @returns {Object} - { calories, calories_min, calories_max, protein, carbs, fat, fiber, sodium }
   */
  getDefaultGoals() {
    return NutriBotConfig.normalizeCalorieGoals({ ...NutriBotConfig.#DEFAULT_GOALS });
  }

  /**
   * Get thresholds for coaching triggers
   * @param {string} username - System username
   * @returns {Object}
   */
  getThresholds(username) {
    const goals = this.getUserGoals(username);
    return {
      daily: goals.calories_max || goals.calories || 2000,
    };
  }

  // ==================== Feature Flags ====================

  /**
   * Check if a feature is enabled
   * @param {string} feature
   * @returns {boolean}
   */
  isFeatureEnabled(feature) {
    return this.#config.features?.[feature] ?? false;
  }

  // ==================== Raw Config Access ====================

  /**
   * Get the full configuration object
   * @returns {object}
   */
  toJSON() {
    return { ...this.#config };
  }

  // ==================== Factory Methods ====================

  /**
   * Create from plain object
   * @param {object} config
   * @returns {NutriBotConfig}
   */
  static from(config, options = {}) {
    return new NutriBotConfig(config, options);
  }
}

export default NutriBotConfig;
