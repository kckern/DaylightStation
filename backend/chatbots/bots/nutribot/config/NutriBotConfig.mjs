/**
 * NutriBot Configuration Loader
 * @module nutribot/config/NutriBotConfig
 * 
 * Loads and validates nutribot configuration, providing user mappings
 * between Telegram identifiers and system users.
 */

import { TelegramChatRef, TELEGRAM_CHANNEL } from '../../../infrastructure/telegram/TelegramChatRef.mjs';
import { ConversationId } from '../../../domain/value-objects/ChatId.mjs';
import { loadConfig } from '../../../_lib/config/ConfigLoader.mjs';
import { ValidationError, NotFoundError } from '../../../_lib/errors/index.mjs';
import { TestContext } from '../../../_lib/testing/TestContext.mjs';
import { UserResolver } from '../../../_lib/users/UserResolver.mjs';
import { configService } from '../../../../lib/config/ConfigService.mjs';

// Single source of truth for default nutrition goals
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
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

  // Users validation
  if (!Array.isArray(config.users)) {
    errors.push('users must be an array');
  } else {
    config.users.forEach((user, i) => {
      if (!user.telegram?.botId) errors.push(`users[${i}].telegram.botId is required`);
      if (!user.telegram?.chatId) errors.push(`users[${i}].telegram.chatId is required`);
      if (!user.systemUser) errors.push(`users[${i}].systemUser is required`);
      if (!user.displayName) errors.push(`users[${i}].displayName is required`);
    });
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
 * - Mapping Telegram IDs to system users
 * - Mapping system users to conversation IDs
 */
export class NutriBotConfig {
  /** @type {object} */
  #config;
  
  /** @type {UserResolver} */
  #userResolver;
  
  /** @type {Map<string, object>} */
  #conversationToUser = new Map();
  
  /** @type {Map<string, object[]>} */
  #userToConversations = new Map();

  /**
   * @param {object} config - Validated configuration object
   * @param {UserResolver} [userResolver] - User resolver for username lookups
   */
  constructor(config, userResolver = null) {
    // Validate config
    const result = validateConfig(config);
    if (!result.valid) {
      throw new ValidationError('Invalid NutriBot configuration', {
        errors: result.errors,
      });
    }

    this.#config = config;
    this.#userResolver = userResolver;
    this.#buildUserMappings();
    
    Object.freeze(this);
  }

  /**
   * Build internal lookup maps for user mappings
   */
  #buildUserMappings() {
    for (const mapping of this.#config.users) {
      // Create ConversationId from Telegram IDs
      const telegramRef = new TelegramChatRef(
        mapping.telegram.botId,
        mapping.telegram.chatId
      );
      const conversationId = telegramRef.toConversationId();
      const convKey = conversationId.toString();

      // Map conversation -> user
      this.#conversationToUser.set(convKey, {
        systemUser: mapping.systemUser,
        displayName: mapping.displayName,
        timezone: mapping.timezone,
        settings: mapping.settings,
        goals: mapping.goals,
        telegramRef,
        conversationId,
      });

      // Map user -> conversations (one user can have multiple bots/conversations)
      if (!this.#userToConversations.has(mapping.systemUser)) {
        this.#userToConversations.set(mapping.systemUser, []);
      }
      this.#userToConversations.get(mapping.systemUser).push({
        conversationId,
        telegramRef,
        displayName: mapping.displayName,
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

  // ==================== User Mapping Methods ====================

  /**
   * Get system user ID for a conversation
   * @param {ConversationId|string} conversationId
   * @returns {string|null}
   */
  getUserForConversation(conversationId) {
    const key = conversationId instanceof ConversationId 
      ? conversationId.toString() 
      : conversationId;
    
    const mapping = this.#conversationToUser.get(key);
    return mapping?.systemUser || null;
  }

  /**
   * Get full user info for a conversation
   * @param {ConversationId|string} conversationId
   * @returns {object|null}
   */
  getUserInfoForConversation(conversationId) {
    const key = conversationId instanceof ConversationId 
      ? conversationId.toString() 
      : conversationId;
    
    return this.#conversationToUser.get(key) || null;
  }

  /**
   * Get system user ID from Telegram chat reference
   * @param {TelegramChatRef} telegramRef
   * @returns {string|null}
   */
  getUserForTelegram(telegramRef) {
    return this.getUserForConversation(telegramRef.toConversationId());
  }

  /**
   * Get system user ID from legacy chat_id format
   * @param {string} legacyChatId - Format: "b{botId}_u{chatId}"
   * @returns {string|null}
   */
  getUserForLegacyChatId(legacyChatId) {
    try {
      const telegramRef = TelegramChatRef.fromLegacyPath(legacyChatId);
      return this.getUserForTelegram(telegramRef);
    } catch {
      return null;
    }
  }

  /**
   * Get all conversation IDs for a system user
   * @param {string} userId
   * @returns {ConversationId[]}
   */
  getConversationsForUser(userId) {
    const mappings = this.#userToConversations.get(userId) || [];
    return mappings.map(m => m.conversationId);
  }

  /**
   * Check if a conversation ID is registered
   * @param {ConversationId|string} conversationId
   * @returns {boolean}
   */
  isKnownConversation(conversationId) {
    const key = conversationId instanceof ConversationId 
      ? conversationId.toString() 
      : conversationId;
    return this.#conversationToUser.has(key);
  }

  /**
   * Check if a user ID is registered
   * @param {string} userId
   * @returns {boolean}
   */
  isKnownUser(userId) {
    return this.#userToConversations.has(userId);
  }

  /**
   * Get all registered system user IDs
   * @returns {string[]}
   */
  getAllUserIds() {
    return Array.from(this.#userToConversations.keys());
  }

  /**
   * Get user's timezone
   * @param {string} userId
   * @returns {string}
   */
  getUserTimezone(userId) {
    const conversations = this.#userToConversations.get(userId);
    if (!conversations || conversations.length === 0) {
      return this.getDefaultTimezone();
    }
    
    // Get from first conversation mapping
    const convKey = conversations[0].conversationId.toString();
    const mapping = this.#conversationToUser.get(convKey);
    return mapping?.timezone || this.getDefaultTimezone();
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
   * @param {string} userId
   * @returns {Object} - { calories, protein, carbs, fat, fiber, sodium }
   */
  getUserGoals(userId) {
    const username = this.#resolveUsername(userId);

    // Prefer goals from user profile if available
    try {
      if (configService?.isReady?.()) {
        const profile = configService.getUserProfile(username);
        const profileGoals = profile?.apps?.nutribot?.goals;
        if (profileGoals) {
          return {
            ...NutriBotConfig.#DEFAULT_GOALS,
            ...profileGoals,
          };
        }
      }
    } catch (e) {
      // Ignore and fall back to config mappings
    }

    const conversations = this.#userToConversations.get(username);
    if (!conversations || conversations.length === 0) {
      console.warn('nutribot.goals.fallback.default', { userId: username });
      return this.getDefaultGoals();
    }
    
    // Get from first conversation mapping
    const goals = conversations[0].goals;
    if (!goals) {
      console.warn('nutribot.goals.fallback.mapping', { userId: username });
      return this.getDefaultGoals();
    }
    
    // Merge with defaults to ensure all fields exist
    return {
      ...NutriBotConfig.#DEFAULT_GOALS,
      ...goals,
    };
  }

  /**
   * Get default nutrition goals
   * @returns {Object} - { calories, protein, carbs, fat, fiber, sodium }
   */
  getDefaultGoals() {
    return { ...NutriBotConfig.#DEFAULT_GOALS };
  }

  // ==================== Storage Paths ====================

  /**
   * Resolve a userId/conversationId to a username
   * @private
   * @param {string} userId - Conversation ID or username
   * @returns {string} - Username
   */
  #resolveUsername(userId) {
    // If already a simple username (no colons or underscores with 'b' prefix)
    if (!userId.includes(':') && !userId.startsWith('b')) {
      return userId;
    }
    
    // Try UserResolver
    if (this.#userResolver) {
      const username = this.#userResolver.resolveUsername(userId);
      if (username) return username;
    }
    
    // Fallback: try to find in our conversation mappings
    const mapping = this.#conversationToUser.get(userId);
    if (mapping?.systemUser) {
      return mapping.systemUser;
    }
    
    // Last resort: return as-is (for CLI or testing)
    return userId;
  }

  /**
   * Get storage path for a specific path type
   * @param {string} pathType - 'nutrilog', 'nutrilist', 'nutricursor', etc.
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getStoragePath(pathType, userId) {
    const username = this.#resolveUsername(userId);
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
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getNutrilogPath(userId) {
    return this.getStoragePath('nutrilog', userId);
  }

  /**
   * Get the nutrilist path for a user
   * Automatically applies test prefix if in test mode
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getNutrilistPath(userId) {
    return this.getStoragePath('nutrilist', userId);
  }

  /**
   * Get the nutricursor path for a user
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getNutricursorPath(userId) {
    return this.getStoragePath('nutricursor', userId);
  }

  /**
   * Get the nutriday path for a user
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getNutridayPath(userId) {
    return this.getStoragePath('nutriday', userId);
  }

  /**
   * Get the nutricoach path for a user
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getNutricoachPath(userId) {
    return this.getStoragePath('nutricoach', userId);
  }

  /**
   * Get the report state path for a user
   * @deprecated Use ConversationState instead
   * @param {string} userId - Conversation ID or username
   * @returns {string}
   */
  getReportStatePath(userId) {
    return this.getStoragePath('report_state', userId);
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
    return pattern
      .replace('{botId}', telegramRef.botId)
      .replace('{chatId}', telegramRef.chatId);
  }

  // ==================== AI Configuration ====================

  /**
   * Get AI parser configuration
   */
  get aiParser() {
    return this.#config.ai?.parser || {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2000,
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
   * Load configuration from file
   * @param {string} configPath - Path to config.yaml
   * @returns {Promise<NutriBotConfig>}
   */
  static async load(configPath) {
    const config = await loadConfig(configPath);
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
