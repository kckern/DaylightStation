/**
 * TelegramChatRef - Telegram-specific chat reference
 * @module infrastructure/telegram/TelegramChatRef
 * 
 * This class handles the Telegram-specific identification of a chat,
 * which consists of a bot ID and a chat ID (user or group).
 * It is responsible for converting to/from the domain's ConversationId.
 */

import { ConversationId } from '../../domain/value-objects/ChatId.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Channel identifier for Telegram
 */
export const TELEGRAM_CHANNEL = 'telegram';

/**
 * TelegramChatRef - Telegram-specific chat reference
 * 
 * Encapsulates the Telegram-specific identifiers (botId, chatId)
 * and provides bidirectional mapping to domain ConversationId.
 */
export class TelegramChatRef {
  /** @type {string} */
  #botId;
  
  /** @type {string} */
  #chatId;

  /**
   * @param {string} botId - Telegram bot ID (from bot token, e.g., "123456789")
   * @param {string|number} chatId - Telegram chat ID (user or group ID)
   */
  constructor(botId, chatId) {
    if (!botId || typeof botId !== 'string') {
      throw new ValidationError('botId is required and must be a string', { botId });
    }
    if (chatId === null || chatId === undefined) {
      throw new ValidationError('chatId is required', { chatId });
    }
    
    this.#botId = botId;
    this.#chatId = String(chatId);
    
    Object.freeze(this);
  }

  /**
   * Get the Telegram bot ID
   * @returns {string}
   */
  get botId() {
    return this.#botId;
  }

  /**
   * Get the Telegram chat ID
   * @returns {string}
   */
  get chatId() {
    return this.#chatId;
  }

  /**
   * Get the chat ID as a number (for Telegram API calls)
   * @returns {number}
   */
  get chatIdNumeric() {
    return parseInt(this.#chatId, 10);
  }

  /**
   * Convert to domain ConversationId
   * 
   * The identifier format is "b{botId}_c{chatId}" which encodes
   * both the bot and chat in a single string. This is opaque to
   * the domain layer.
   * 
   * @returns {ConversationId}
   */
  toConversationId() {
    // Format: telegram:b{botId}_c{chatId}
    // This keeps bot context (same user with different bots = different conversations)
    const identifier = `b${this.#botId}_c${this.#chatId}`;
    return new ConversationId(TELEGRAM_CHANNEL, identifier);
  }

  /**
   * Convert to the legacy file path format used in existing data files
   * This is for backward compatibility with existing nutribot/journalist data
   * 
   * @returns {string} Format: "b{botId}_u{chatId}"
   */
  toLegacyPath() {
    return `b${this.#botId}_u${this.#chatId}`;
  }

  /**
   * Check equality
   * @param {TelegramChatRef} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof TelegramChatRef)) return false;
    return this.#botId === other.botId && this.#chatId === other.chatId;
  }

  /**
   * Convert to plain object (for logging, debugging)
   * @returns {object}
   */
  toJSON() {
    return {
      botId: this.#botId,
      chatId: this.#chatId,
      channel: TELEGRAM_CHANNEL,
    };
  }

  /**
   * Create from a domain ConversationId
   * 
   * @param {ConversationId} conversationId
   * @returns {TelegramChatRef}
   * @throws {ValidationError} if not a Telegram conversation
   */
  static fromConversationId(conversationId) {
    if (conversationId.channel !== TELEGRAM_CHANNEL) {
      throw new ValidationError(
        `Cannot create TelegramChatRef from ${conversationId.channel} conversation`,
        { channel: conversationId.channel }
      );
    }
    
    // Parse identifier: "b{botId}_c{chatId}"
    const match = conversationId.identifier.match(/^b([^_]+)_c(.+)$/);
    if (!match) {
      throw new ValidationError(
        'Invalid Telegram identifier format in ConversationId',
        { identifier: conversationId.identifier }
      );
    }
    
    return new TelegramChatRef(match[1], match[2]);
  }

  /**
   * Create from a legacy path format
   * 
   * @param {string} botId - Bot ID
   * @param {string} legacyPath - Legacy path like "b{botId}_u{chatId}"
   * @returns {TelegramChatRef}
   */
  static fromLegacyPath(legacyPath) {
    const match = legacyPath.match(/^b([^_]+)_u(.+)$/);
    if (!match) {
      throw new ValidationError(
        'Invalid legacy path format. Expected "b{botId}_u{chatId}"',
        { legacyPath }
      );
    }
    
    return new TelegramChatRef(match[1], match[2]);
  }

  /**
   * Create from Telegram update object
   * 
   * @param {string} botId - Bot ID (extracted from token)
   * @param {object} update - Telegram update object
   * @returns {TelegramChatRef}
   */
  static fromTelegramUpdate(botId, update) {
    // Extract chat ID from various update types
    const chatId = 
      update.message?.chat?.id ||
      update.callback_query?.message?.chat?.id ||
      update.edited_message?.chat?.id ||
      update.channel_post?.chat?.id;
    
    if (!chatId) {
      throw new ValidationError('Cannot extract chat ID from Telegram update', { 
        updateKeys: Object.keys(update) 
      });
    }
    
    return new TelegramChatRef(botId, chatId);
  }

  /**
   * Extract bot ID from a Telegram bot token
   * 
   * @param {string} token - Telegram bot token (format: "{botId}:{secret}")
   * @returns {string} Bot ID
   */
  static extractBotIdFromToken(token) {
    const colonIndex = token.indexOf(':');
    if (colonIndex === -1) {
      throw new ValidationError('Invalid Telegram bot token format', { token: '***' });
    }
    return token.substring(0, colonIndex);
  }
}

export default TelegramChatRef;
