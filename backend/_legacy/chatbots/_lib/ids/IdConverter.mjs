/**
 * ID Converter Utility
 * @module _lib/ids/IdConverter
 * 
 * Utilities for converting between different ID formats used in the system.
 * 
 * ID Formats:
 * - Legacy: "b{botId}_u{userId}" (e.g., "b6898194425_u575596036")
 * - New:    "telegram:{botId}_{userId}" (e.g., "telegram:6898194425_575596036")
 * - CLI:    "cli:{sessionId}" (e.g., "cli:test-session-1")
 * 
 * This utility ensures backward compatibility during migration from
 * legacy to new ID formats.
 */

// ==================== Constants ====================

/**
 * Supported channels
 * @readonly
 * @enum {string}
 */
export const Channel = Object.freeze({
  TELEGRAM: 'telegram',
  CLI: 'cli',
  DISCORD: 'discord',
  SLACK: 'slack',
});

/**
 * Legacy chat_id pattern: b{botId}_u{userId}
 * @constant {RegExp}
 */
const LEGACY_PATTERN = /^b(\d+)_u(\d+)$/;

/**
 * New conversationId pattern: telegram:{botId}_{userId}
 * @constant {RegExp}
 */
const TELEGRAM_PATTERN = /^telegram:(\d+)_(\d+)$/;

/**
 * CLI conversationId pattern: cli:{identifier}
 * @constant {RegExp}
 */
const CLI_PATTERN = /^cli:(.+)$/;

/**
 * Generic channel pattern: {channel}:{identifier}
 * @constant {RegExp}
 */
const GENERIC_PATTERN = /^([a-z]+):(.+)$/;

// ==================== Main Converter ====================

/**
 * ID Converter - static utility class
 */
export class IdConverter {
  
  // ==================== Detection ====================

  /**
   * Detect the format of an ID
   * @param {string} id - ID to analyze
   * @returns {'legacy'|'telegram'|'cli'|'generic'|'plain'|'unknown'}
   */
  static detectFormat(id) {
    if (!id || typeof id !== 'string') return 'unknown';
    
    if (LEGACY_PATTERN.test(id)) return 'legacy';
    if (TELEGRAM_PATTERN.test(id)) return 'telegram';
    if (CLI_PATTERN.test(id)) return 'cli';
    if (GENERIC_PATTERN.test(id)) return 'generic';
    
    // Plain numeric ID (likely just userId)
    if (/^\d+$/.test(id)) return 'plain';
    
    return 'unknown';
  }

  /**
   * Check if ID is in legacy format
   * @param {string} id
   * @returns {boolean}
   */
  static isLegacyFormat(id) {
    return LEGACY_PATTERN.test(id);
  }

  /**
   * Check if ID is in new canonical format
   * @param {string} id
   * @returns {boolean}
   */
  static isCanonicalFormat(id) {
    return GENERIC_PATTERN.test(id);
  }

  // ==================== Conversion ====================

  /**
   * Convert legacy chat_id to new conversationId format
   * 
   * @param {string} legacyChatId - Legacy format: "b{botId}_u{userId}"
   * @returns {string} New format: "telegram:{botId}_{userId}"
   * @throws {Error} if format is invalid
   * 
   * @example
   * IdConverter.legacyToConversationId("b6898194425_u575596036")
   * // => "telegram:6898194425_575596036"
   */
  static legacyToConversationId(legacyChatId) {
    const match = legacyChatId.match(LEGACY_PATTERN);
    if (!match) {
      throw new Error(`Invalid legacy chat_id format: "${legacyChatId}". Expected "b{botId}_u{userId}"`);
    }
    return `telegram:${match[1]}_${match[2]}`;
  }

  /**
   * Convert new conversationId to legacy chat_id format
   * 
   * @param {string} conversationId - New format: "telegram:{botId}_{userId}"
   * @returns {string} Legacy format: "b{botId}_u{userId}"
   * @throws {Error} if format is invalid or not Telegram
   * 
   * @example
   * IdConverter.conversationIdToLegacy("telegram:6898194425_575596036")
   * // => "b6898194425_u575596036"
   */
  static conversationIdToLegacy(conversationId) {
    const match = conversationId.match(TELEGRAM_PATTERN);
    if (!match) {
      throw new Error(`Invalid telegram conversationId format: "${conversationId}". Expected "telegram:{botId}_{userId}"`);
    }
    return `b${match[1]}_u${match[2]}`;
  }

  /**
   * Normalize any ID format to canonical conversationId
   * 
   * Handles:
   * - Legacy "b{botId}_u{userId}" → "telegram:{botId}_{userId}"
   * - Already canonical → returns as-is
   * - Plain userId with botId → "telegram:{botId}_{userId}"
   * 
   * @param {string} id - Any ID format
   * @param {string} [defaultBotId] - Bot ID to use if ID is plain userId
   * @returns {string} Canonical conversationId
   */
  static normalize(id, defaultBotId) {
    if (!id || typeof id !== 'string') {
      throw new Error('ID is required');
    }

    const format = this.detectFormat(id);

    switch (format) {
      case 'legacy':
        return this.legacyToConversationId(id);
      
      case 'telegram':
      case 'cli':
      case 'generic':
        return id; // Already canonical
      
      case 'plain':
        if (!defaultBotId) {
          throw new Error(`Plain userId "${id}" requires defaultBotId for normalization`);
        }
        return `telegram:${defaultBotId}_${id}`;
      
      default:
        throw new Error(`Unknown ID format: "${id}"`);
    }
  }

  // ==================== Extraction ====================

  /**
   * Extract userId from any supported ID format
   * 
   * @param {string} id - Any ID format
   * @returns {string} Plain userId
   * @throws {Error} if userId cannot be extracted
   * 
   * @example
   * IdConverter.getUserId("b6898194425_u575596036") // => "575596036"
   * IdConverter.getUserId("telegram:6898194425_575596036") // => "575596036"
   * IdConverter.getUserId("575596036") // => "575596036"
   */
  static getUserId(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('ID is required');
    }

    // Try telegram format
    const telegramMatch = id.match(TELEGRAM_PATTERN);
    if (telegramMatch) return telegramMatch[2];

    // Try legacy format
    const legacyMatch = id.match(LEGACY_PATTERN);
    if (legacyMatch) return legacyMatch[2];

    // Try CLI format (identifier is the userId)
    const cliMatch = id.match(CLI_PATTERN);
    if (cliMatch) return cliMatch[1];

    // Plain numeric ID
    if (/^\d+$/.test(id)) return id;

    // Try generic format, return identifier
    const genericMatch = id.match(GENERIC_PATTERN);
    if (genericMatch) {
      // For telegram-like formats, try to extract userId from identifier
      const identifierUserMatch = genericMatch[2].match(/_(\d+)$/);
      if (identifierUserMatch) return identifierUserMatch[1];
      return genericMatch[2];
    }

    throw new Error(`Cannot extract userId from: "${id}"`);
  }

  /**
   * Extract botId from conversationId
   * 
   * @param {string} id - Conversation ID containing botId
   * @returns {string|null} Bot ID or null if not present
   * 
   * @example
   * IdConverter.getBotId("telegram:6898194425_575596036") // => "6898194425"
   * IdConverter.getBotId("b6898194425_u575596036") // => "6898194425"
   * IdConverter.getBotId("cli:test") // => null
   */
  static getBotId(id) {
    if (!id || typeof id !== 'string') return null;

    // Try telegram format
    const telegramMatch = id.match(TELEGRAM_PATTERN);
    if (telegramMatch) return telegramMatch[1];

    // Try legacy format
    const legacyMatch = id.match(LEGACY_PATTERN);
    if (legacyMatch) return legacyMatch[1];

    return null;
  }

  /**
   * Extract channel from conversationId
   * 
   * @param {string} id - Conversation ID
   * @returns {string} Channel name or 'telegram' for legacy format
   * 
   * @example
   * IdConverter.getChannel("telegram:6898194425_575596036") // => "telegram"
   * IdConverter.getChannel("cli:test") // => "cli"
   * IdConverter.getChannel("b6898194425_u575596036") // => "telegram"
   */
  static getChannel(id) {
    if (!id || typeof id !== 'string') return 'unknown';

    // Legacy format is always telegram
    if (LEGACY_PATTERN.test(id)) return Channel.TELEGRAM;

    // Try generic format
    const genericMatch = id.match(GENERIC_PATTERN);
    if (genericMatch) return genericMatch[1];

    // Plain numeric likely telegram
    if (/^\d+$/.test(id)) return Channel.TELEGRAM;

    return 'unknown';
  }

  // ==================== Construction ====================

  /**
   * Build a new-format conversationId from components
   * 
   * @param {string} channel - Channel name (telegram, cli, etc.)
   * @param {string} identifier - Channel-specific identifier
   * @returns {string} Canonical conversationId
   * 
   * @example
   * IdConverter.buildConversationId("telegram", "6898194425_575596036")
   * // => "telegram:6898194425_575596036"
   */
  static buildConversationId(channel, identifier) {
    if (!channel || !identifier) {
      throw new Error('Both channel and identifier are required');
    }
    return `${channel}:${identifier}`;
  }

  /**
   * Build a telegram conversationId from bot and user IDs
   * 
   * @param {string} botId - Telegram bot ID
   * @param {string} userId - Telegram user ID
   * @returns {string} Telegram conversationId
   * 
   * @example
   * IdConverter.buildTelegramConversationId("6898194425", "575596036")
   * // => "telegram:6898194425_575596036"
   */
  static buildTelegramConversationId(botId, userId) {
    if (!botId || !userId) {
      throw new Error('Both botId and userId are required');
    }
    return `telegram:${botId}_${userId}`;
  }

  /**
   * Build a CLI conversationId
   * 
   * @param {string} identifier - Session or test identifier
   * @returns {string} CLI conversationId
   * 
   * @example
   * IdConverter.buildCLIConversationId("test-session-1")
   * // => "cli:test-session-1"
   */
  static buildCLIConversationId(identifier) {
    if (!identifier) {
      throw new Error('identifier is required');
    }
    return `cli:${identifier}`;
  }

  /**
   * Build a legacy chat_id from components
   * 
   * @param {string} botId - Telegram bot ID
   * @param {string} userId - Telegram user ID
   * @returns {string} Legacy chat_id
   * 
   * @example
   * IdConverter.buildLegacyChatId("6898194425", "575596036")
   * // => "b6898194425_u575596036"
   */
  static buildLegacyChatId(botId, userId) {
    if (!botId || !userId) {
      throw new Error('Both botId and userId are required');
    }
    return `b${botId}_u${userId}`;
  }

  // ==================== Comparison ====================

  /**
   * Check if two IDs refer to the same conversation (ignoring format)
   * 
   * @param {string} id1 - First ID
   * @param {string} id2 - Second ID
   * @returns {boolean}
   * 
   * @example
   * IdConverter.isSameConversation(
   *   "b6898194425_u575596036",
   *   "telegram:6898194425_575596036"
   * ) // => true
   */
  static isSameConversation(id1, id2) {
    try {
      const userId1 = this.getUserId(id1);
      const userId2 = this.getUserId(id2);
      const botId1 = this.getBotId(id1);
      const botId2 = this.getBotId(id2);

      // Must have same userId
      if (userId1 !== userId2) return false;

      // If both have botId, they must match
      if (botId1 && botId2 && botId1 !== botId2) return false;

      return true;
    } catch {
      return false;
    }
  }
}

export default IdConverter;
