/**
 * User Resolver
 * @module infrastructure/users/UserResolver
 *
 * Resolves platform-specific identifiers (e.g., Telegram chat IDs)
 * to internal usernames for storage path resolution.
 */

import { createLogger } from '../logging/logger.js';

/**
 * Resolves conversation IDs to usernames
 */
export class UserResolver {
  #usersByTelegram = new Map();  // telegram:{botId}_{chatId} -> username
  #usersByUsername = new Map();  // username -> config object
  #usersByChatId = new Map();    // chatId only -> username (fallback)
  #logger;

  /**
   * @param {Object} config - Chatbots config object from ConfigService
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#logger = options.logger || createLogger({ source: 'user-resolver', app: 'chatbots' });

    if (!config?.users) {
      this.#logger.warn?.('userResolver.noUsers', { message: 'No users configured' });
      return;
    }

    // Build lookup maps from config.chatbots.users
    for (const [username, userData] of Object.entries(config.users)) {
      this.#usersByUsername.set(username, { username, ...userData });

      // Build telegram key if we have both IDs
      if (userData.telegram_bot_id && userData.telegram_user_id) {
        const telegramKey = `telegram:${userData.telegram_bot_id}_${userData.telegram_user_id}`;
        this.#usersByTelegram.set(telegramKey, username);
        this.#logger.debug?.('userResolver.mapped', { telegramKey, username });
      }

      // Also index by chat ID alone for fallback
      if (userData.telegram_user_id) {
        this.#usersByChatId.set(String(userData.telegram_user_id), username);
      }
    }

    this.#logger.info?.('userResolver.initialized', {
      userCount: this.#usersByUsername.size,
      telegramMappings: this.#usersByTelegram.size,
    });
  }

  /**
   * Resolve a conversation ID to a username
   *
   * Supports multiple formats:
   * - "telegram:6898194425_575596036" -> "{username}"
   * - "575596036" (chat ID only) -> "{username}"
   * - "{username}" (already a username) -> "{username}"
   *
   * @param {string} conversationId - Platform-specific conversation identifier
   * @returns {string|null} - Username or null if not found
   */
  resolveUsername(conversationId) {
    if (!conversationId) return null;

    const idStr = String(conversationId);

    // 1. Check if it's already a known username
    if (this.#usersByUsername.has(idStr)) {
      return idStr;
    }

    // 2. Direct telegram lookup (full format)
    if (this.#usersByTelegram.has(idStr)) {
      return this.#usersByTelegram.get(idStr);
    }

    // 3. Try parsing telegram format: "telegram:{botId}_{chatId}"
    const telegramMatch = idStr.match(/^telegram:(\d+)_(\d+)$/);
    if (telegramMatch) {
      const [, botId, chatId] = telegramMatch;

      // Try exact match first
      const exactKey = `telegram:${botId}_${chatId}`;
      if (this.#usersByTelegram.has(exactKey)) {
        return this.#usersByTelegram.get(exactKey);
      }

      // Fall back to chat ID only
      if (this.#usersByChatId.has(chatId)) {
        return this.#usersByChatId.get(chatId);
      }
    }

    // 4. Try as bare chat ID
    if (this.#usersByChatId.has(idStr)) {
      return this.#usersByChatId.get(idStr);
    }

    // 5. Try legacy format: "b{botId}_u{chatId}"
    const legacyMatch = idStr.match(/^b(\d+)_u(\d+)$/);
    if (legacyMatch) {
      const [, botId, chatId] = legacyMatch;

      const telegramKey = `telegram:${botId}_${chatId}`;
      if (this.#usersByTelegram.has(telegramKey)) {
        return this.#usersByTelegram.get(telegramKey);
      }

      if (this.#usersByChatId.has(chatId)) {
        return this.#usersByChatId.get(chatId);
      }
    }

    this.#logger.warn?.('userResolver.notFound', { conversationId: idStr });
    return null;
  }

  /**
   * Get user config by username
   * @param {string} username
   * @returns {Object|null}
   */
  getUser(username) {
    return this.#usersByUsername.get(username) || null;
  }

  /**
   * Get all configured usernames
   * @returns {string[]}
   */
  getAllUsernames() {
    return Array.from(this.#usersByUsername.keys());
  }

  /**
   * Check if a username exists
   * @param {string} username
   * @returns {boolean}
   */
  hasUser(username) {
    return this.#usersByUsername.has(username);
  }
}

export default UserResolver;
