/**
 * MessageQueue Entity
 * @module journalist/domain/entities/MessageQueue
 *
 * Represents a queued message waiting to be sent.
 */

import { v4 as uuidv4 } from 'uuid';
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

/**
 * ValidationError for entity validation
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * MessageQueue entity
 */
export class MessageQueue {
  #uuid;
  #chatId;
  #timestamp;
  #queuedMessage;
  #choices;
  #inline;
  #foreignKey;
  #messageId;

  /**
   * @param {object} props
   * @param {string} [props.uuid] - Queue item ID
   * @param {string} props.chatId - Target chat ID
   * @param {string} [props.timestamp] - When queued
   * @param {string} props.queuedMessage - Message text to send
   * @param {string[][]|null} [props.choices] - Optional keyboard choices
   * @param {boolean} [props.inline] - Whether to use inline keyboard
   * @param {object} [props.foreignKey] - Foreign key references
   * @param {string|null} [props.messageId] - ID after sending (null if unsent)
   */
  constructor(props) {
    if (!props.chatId) throw new ValidationError('chatId is required');
    if (!props.queuedMessage) throw new ValidationError('queuedMessage is required');

    this.#uuid = props.uuid || uuidv4();
    this.#chatId = props.chatId;
    this.#timestamp = props.timestamp || nowTs24();
    this.#queuedMessage = props.queuedMessage;
    this.#choices = props.choices ? Object.freeze(props.choices.map((row) => Object.freeze([...row]))) : null;
    this.#inline = props.inline ?? true;
    this.#foreignKey = Object.freeze(props.foreignKey || {});
    this.#messageId = props.messageId || null;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get uuid() {
    return this.#uuid;
  }
  get chatId() {
    return this.#chatId;
  }
  get timestamp() {
    return this.#timestamp;
  }
  get queuedMessage() {
    return this.#queuedMessage;
  }
  get choices() {
    return this.#choices ? this.#choices.map((row) => [...row]) : null;
  }
  get inline() {
    return this.#inline;
  }
  get foreignKey() {
    return { ...this.#foreignKey };
  }
  get messageId() {
    return this.#messageId;
  }

  // ==================== Computed Properties ====================

  /**
   * Check if the queue item has been sent
   * @returns {boolean}
   */
  isSent() {
    return this.#messageId !== null;
  }

  /**
   * Check if item has choices
   * @returns {boolean}
   */
  hasChoices() {
    return this.#choices !== null && this.#choices.length > 0;
  }

  // ==================== Mutation Methods ====================

  /**
   * Create a copy with messageId set (marks as sent)
   * @param {string} messageId
   * @returns {MessageQueue}
   */
  withMessageId(messageId) {
    return new MessageQueue({
      ...this.toJSON(),
      messageId,
    });
  }

  /**
   * Create a copy with choices
   * @param {string[][]} choices
   * @returns {MessageQueue}
   */
  withChoices(choices) {
    return new MessageQueue({
      ...this.toJSON(),
      choices,
    });
  }

  /**
   * Create a copy with foreign key
   * @param {object} foreignKey
   * @returns {MessageQueue}
   */
  withForeignKey(foreignKey) {
    return new MessageQueue({
      ...this.toJSON(),
      foreignKey: { ...this.#foreignKey, ...foreignKey },
    });
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new queue item
   * @param {object} props
   * @returns {MessageQueue}
   */
  static create(props) {
    return new MessageQueue(props);
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      uuid: this.#uuid,
      chatId: this.#chatId,
      timestamp: this.#timestamp,
      queuedMessage: this.#queuedMessage,
      choices: this.#choices ? this.#choices.map((row) => [...row]) : null,
      inline: this.#inline,
      foreignKey: { ...this.#foreignKey },
      messageId: this.#messageId,
    };
  }

  /**
   * Create from plain object
   * @param {object} data
   * @returns {MessageQueue}
   */
  static from(data) {
    return new MessageQueue(data);
  }
}

export default MessageQueue;
