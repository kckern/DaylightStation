/**
 * ConversationMessage Entity
 * @module journalist/domain/entities/ConversationMessage
 *
 * Represents a single message in a journal conversation.
 */

import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * ConversationMessage entity
 */
export class ConversationMessage {
  #messageId;
  #chatId;
  #timestamp;
  #senderId;
  #senderName;
  #text;
  #foreignKey;

  /**
   * @param {object} props
   * @param {string} props.messageId - Unique message ID
   * @param {string} props.chatId - Chat/conversation ID
   * @param {string} props.timestamp - ISO timestamp
   * @param {string} props.senderId - ID of sender
   * @param {string} props.senderName - Display name of sender
   * @param {string} props.text - Message text
   * @param {object} [props.foreignKey] - Optional foreign key references
   */
  constructor(props) {
    if (!props.messageId) throw new ValidationError('messageId is required');
    if (!props.chatId) throw new ValidationError('chatId is required');
    if (!props.timestamp) throw new ValidationError('timestamp is required');
    if (!props.senderId) throw new ValidationError('senderId is required');
    if (!props.senderName) throw new ValidationError('senderName is required');
    if (typeof props.text !== 'string') throw new ValidationError('text must be a string');

    this.#messageId = props.messageId;
    this.#chatId = props.chatId;
    this.#timestamp = props.timestamp;
    this.#senderId = props.senderId;
    this.#senderName = props.senderName;
    this.#text = props.text;
    this.#foreignKey = Object.freeze(props.foreignKey || {});

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get messageId() {
    return this.#messageId;
  }
  get chatId() {
    return this.#chatId;
  }
  get timestamp() {
    return this.#timestamp;
  }
  get senderId() {
    return this.#senderId;
  }
  get senderName() {
    return this.#senderName;
  }
  get text() {
    return this.#text;
  }
  get foreignKey() {
    return { ...this.#foreignKey };
  }

  // ==================== Computed Properties ====================

  /**
   * Check if message is from the bot
   * @param {string} [botName='Journalist']
   * @returns {boolean}
   */
  isFromBot(botName = 'Journalist') {
    return this.#senderName === botName || this.#senderId === 'bot';
  }

  /**
   * Get datetime for display
   * @returns {Date}
   */
  get datetime() {
    return new Date(this.#timestamp);
  }

  /**
   * Check if message has quiz reference
   * @returns {boolean}
   */
  get hasQuizRef() {
    return !!this.#foreignKey.quiz;
  }

  /**
   * Check if message has queue reference
   * @returns {boolean}
   */
  get hasQueueRef() {
    return !!this.#foreignKey.queue;
  }

  // ==================== Factory Methods ====================

  /**
   * Create from Telegram update object
   * @param {object} update - Telegram update
   * @param {string} botName - Bot's display name
   * @returns {ConversationMessage}
   */
  static fromTelegramUpdate(update, botName = 'Journalist') {
    const message = update.message || update.callback_query?.message;
    if (!message) {
      throw new ValidationError('Invalid Telegram update: no message');
    }

    const from = update.callback_query?.from || message.from;
    const isBot = from.is_bot || false;

    return new ConversationMessage({
      messageId: String(message.message_id),
      chatId: String(message.chat.id),
      timestamp: new Date(message.date * 1000).toISOString(),
      senderId: String(from.id),
      senderName: isBot ? botName : from.first_name || from.username || 'User',
      text: message.text || update.callback_query?.data || '',
      foreignKey: {},
    });
  }

  /**
   * Create a bot message
   * @param {object} props
   * @param {string} props.chatId - Chat/conversation ID
   * @param {string} props.timestamp - ISO timestamp (required)
   * @param {string} props.text - Message text
   * @param {string} [props.messageId] - Unique message ID (generated if not provided)
   * @param {string} [props.botName] - Bot display name
   * @param {object} [props.foreignKey] - Optional foreign key references
   * @returns {ConversationMessage}
   */
  static createBotMessage(props) {
    if (!props.timestamp) throw new ValidationError('timestamp is required');
    return new ConversationMessage({
      messageId: props.messageId || uuidv4(),
      chatId: props.chatId,
      timestamp: props.timestamp,
      senderId: 'bot',
      senderName: props.botName || 'Journalist',
      text: props.text,
      foreignKey: props.foreignKey || {},
    });
  }

  /**
   * Create a user message
   * @param {object} props
   * @param {string} props.chatId - Chat/conversation ID
   * @param {string} props.timestamp - ISO timestamp (required)
   * @param {string} props.senderId - ID of sender
   * @param {string} props.text - Message text
   * @param {string} [props.messageId] - Unique message ID (generated if not provided)
   * @param {string} [props.senderName] - Display name of sender
   * @param {object} [props.foreignKey] - Optional foreign key references
   * @returns {ConversationMessage}
   */
  static createUserMessage(props) {
    if (!props.timestamp) throw new ValidationError('timestamp is required');
    return new ConversationMessage({
      messageId: props.messageId || uuidv4(),
      chatId: props.chatId,
      timestamp: props.timestamp,
      senderId: props.senderId,
      senderName: props.senderName || 'User',
      text: props.text,
      foreignKey: props.foreignKey || {},
    });
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      messageId: this.#messageId,
      chatId: this.#chatId,
      timestamp: this.#timestamp,
      senderId: this.#senderId,
      senderName: this.#senderName,
      text: this.#text,
      foreignKey: { ...this.#foreignKey },
    };
  }

  /**
   * Create from plain object
   * @param {object} data
   * @returns {ConversationMessage}
   */
  static from(data) {
    return new ConversationMessage(data);
  }
}

export default ConversationMessage;
