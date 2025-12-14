/**
 * NutriBot Configuration Loader
 * @module nutribot/config/NutriBotConfig
 * 
 * Loads and validates nutribot configuration, providing user mappings
 * between Telegram identifiers and system users.
 */

import { TelegramChatRef, TELEGRAM_CHANNEL } from '../../infrastructure/telegram/TelegramChatRef.mjs';
import { ConversationId } from '../../domain/value-objects/ChatId.mjs';
import { loadConfig } from '../../_lib/config/ConfigLoader.mjs';
import { ValidationError, NotFoundError } from '../../_lib/errors/index.mjs';
import { TestContext } from '../../_lib/testing/TestContext.mjs';

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
  
  /** @type {Map<string, object>} */
  #conversationToUser = new Map();
  
  /** @type {Map<string, object[]>} */
  #userToConversations = new Map();

  /**
   * @param {object} config - Validated configuration object
   */
  constructor(config) {
    // Validate config
    const result = validateConfig(config);
    if (!result.valid) {
      throw new ValidationError('Invalid NutriBot configuration', {
        errors: result.errors,
      });
    }

    this.#config = config;
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
      return 'America/Los_Angeles'; // Default
    }
    
    // Get from first conversation mapping
    const convKey = conversations[0].conversationId.toString();
    const mapping = this.#conversationToUser.get(convKey);
    return mapping?.timezone || 'America/Los_Angeles';
  }

  // ==================== Storage Paths ====================

  /**
   * Get the nutrilog path for a user
   * Automatically applies test prefix if in test mode
   * @param {string} userId
   * @returns {string}
   */
  getNutrilogPath(userId) {
    const template = this.#config.storage.paths.nutrilog;
    const basePath = `${this.#config.storage.basePath}/${template.replace('{userId}', userId)}`;
    return TestContext.transformPath(basePath);
  }

  /**
   * Get the nutrilist path for a user
   * Automatically applies test prefix if in test mode
   * @param {string} userId
   * @returns {string}
   */
  getNutrilistPath(userId) {
    const template = this.#config.storage.paths.nutrilist;
    const basePath = `${this.#config.storage.basePath}/${template.replace('{userId}', userId)}`;
    return TestContext.transformPath(basePath);
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
