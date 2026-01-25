/**
 * NutriBot Configuration Loader
 * @module nutribot/config/NutriBotConfig
 *
 * Loads and validates nutribot configuration, providing storage paths
 * and nutrition goals for users.
 *
 * NOTE: Identity resolution (conversation ID -> username) is now handled
 * by UserResolver in the infrastructure layer. This config only handles
 * bot-specific configuration like storage paths and nutrition goals.
 */

// Infrastructure imports
import { TelegramChatRef } from '../../../2_adapters/telegram/TelegramChatRef.mjs';
import { ValidationError } from '../../../0_infrastructure/utils/errors/index.mjs';
import { TestContext } from '../../../0_infrastructure/testing/TestContext.mjs';
import { configService } from '../../../0_infrastructure/config/index.mjs';
import { loadBotConfig } from '../../../0_infrastructure/config/BotConfigLoader.mjs';

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

  // Telegram validation
  if (!config.telegram?.botId) errors.push('telegram.botId is required');
  if (!config.telegram?.botToken) errors.push('telegram.botToken is required');

  // Users validation - still needed for legacy goals/settings lookup
  // Identity resolution is now handled by UserResolver
  if (config.users && !Array.isArray(config.users)) {
    errors.push('users must be an array if provided');
  }

  // Storage validation
  if (!config.storage?.basePath) errors.push('storage.basePath is required');
  if (!config.storage?.paths?.nutrilog) errors.push('storage.paths.nutrilog is required');
  if (!config.storage?.paths?.nutrilist) errors.push('storage.paths.nutrilist is required');

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * NutriBot configuration manager
 *
 * Handles:
 * - Loading and validating config.yaml
 * - Storage paths for nutrilog, nutrilist, etc.
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

  /** @type {Map<string, object>} User goals/settings by username */
  #userSettings = new Map();

  /**
   * @param {object} config - Validated configuration object
   * @param {Object} [options] - Options
   * @param {Object} [options.logger] - Logger instance
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
   * Get Telegram bot ID
   */
  get telegramBotId() {
    return this.#config.telegram.botId;
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
   * Get default timezone from config (weather.timezone)
   * @returns {string}
   */
  getDefaultTimezone() {
    return this.#config.weather?.timezone || 'America/Los_Angeles';
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

    // Prefer goals from user profile if available (via ConfigService)
    try {
      if (configService?.isReady?.()) {
        const profile = configService.getUserProfile(username);
        const profileGoals = profile?.apps?.nutribot?.goals;
        if (profileGoals) {
          rawGoals = {
            ...NutriBotConfig.#DEFAULT_GOALS,
            ...profileGoals,
          };
        }
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

  // ==================== Storage Paths ====================

  /**
   * Get storage path for a specific path type
   * @param {string} pathType - 'nutrilog', 'nutrilist', 'nutricursor', etc.
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getStoragePath(pathType, username) {
    const template = this.#config.storage.paths[pathType];

    if (!template) {
      throw new Error(`Unknown storage path type: ${pathType}`);
    }

    const basePath = `${this.#config.storage.basePath}/${template.replace('{username}', username)}`;
    return TestContext.transformPath(basePath);
  }

  /**
   * Get the nutrilog path for a user
   * Automatically applies test prefix if in test mode
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getNutrilogPath(username) {
    return this.getStoragePath('nutrilog', username);
  }

  /**
   * Get the nutrilist path for a user
   * Automatically applies test prefix if in test mode
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getNutrilistPath(username) {
    return this.getStoragePath('nutrilist', username);
  }

  /**
   * Get the nutricursor path for a user
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getNutricursorPath(username) {
    return this.getStoragePath('nutricursor', username);
  }

  /**
   * Get the nutriday path for a user
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getNutridayPath(username) {
    return this.getStoragePath('nutriday', username);
  }

  /**
   * Get the nutricoach path for a user
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getNutricoachPath(username) {
    return this.getStoragePath('nutricoach', username);
  }

  /**
   * Get the report state path for a user
   * @deprecated Use ConversationState instead
   * @param {string} username - System username (NOT conversation ID)
   * @returns {string}
   */
  getReportStatePath(username) {
    return this.getStoragePath('report_state', username);
  }

  /**
   * Get the legacy path for a Telegram chat
   * @param {TelegramChatRef} telegramRef
   * @returns {string|null}
   */
  getLegacyPath(telegramRef) {
    if (!this.#config.storage.legacy?.enabled) {
      return null;
    }

    const pattern = this.#config.storage.legacy.pattern;
    return pattern.replace('{botId}', telegramRef.botId).replace('{chatId}', telegramRef.chatId);
  }

  // ==================== AI Configuration ====================

  /**
   * Get AI parser configuration
   */
  get aiParser() {
    return (
      this.#config.ai?.parser || {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 2000,
      }
    );
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
   * Load configuration from config directory
   * @param {string} botName - Bot name (e.g., 'nutribot')
   * @param {object} options - Options
   * @param {string} options.configDir - Directory containing config files
   * @returns {NutriBotConfig}
   */
  static load(botName, options = {}) {
    const config = loadBotConfig(botName, options);
    return new NutriBotConfig(config);
  }

  /**
   * Create from plain object
   * @param {object} config
   * @returns {NutriBotConfig}
   */
  static from(config) {
    return new NutriBotConfig(config);
  }
}

export default NutriBotConfig;
