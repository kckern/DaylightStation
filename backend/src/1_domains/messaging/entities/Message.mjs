/**
 * Message Entity - Represents a single message in a conversation
 */

export const MESSAGE_TYPES = ['text', 'voice', 'image', 'document', 'callback'];
export const MESSAGE_DIRECTIONS = ['incoming', 'outgoing'];

import { ValidationError } from '../../core/errors/index.mjs';

export class Message {
  constructor({
    id,
    conversationId,
    senderId,
    recipientId,
    type = 'text',
    direction = null, // 'incoming' or 'outgoing'
    content,
    attachments = [], // Array of attachment objects (photos, voice memos, documents)
    timestamp,
    metadata = {}
  }) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    this.id = id;
    this.conversationId = conversationId;
    this.senderId = senderId;
    this.recipientId = recipientId;
    this.type = type;
    this.direction = direction;
    this.content = content;
    this.attachments = attachments;
    this.timestamp = timestamp;
    this.metadata = metadata;
  }

  /**
   * Check if message is text type
   */
  isText() {
    return this.type === 'text';
  }

  /**
   * Check if message is voice type
   */
  isVoice() {
    return this.type === 'voice';
  }

  /**
   * Check if message is image type
   */
  isImage() {
    return this.type === 'image';
  }

  /**
   * Check if message is a callback (button press)
   */
  isCallback() {
    return this.type === 'callback';
  }

  /**
   * Check if message is incoming
   */
  isIncoming() {
    return this.direction === 'incoming';
  }

  /**
   * Check if message is outgoing
   */
  isOutgoing() {
    return this.direction === 'outgoing';
  }

  /**
   * Check if message has attachments
   */
  hasAttachments() {
    return this.attachments && this.attachments.length > 0;
  }

  /**
   * Get text content (for text and callback types)
   */
  getText() {
    if (this.isText() || this.isCallback()) {
      return typeof this.content === 'string' ? this.content : this.content?.text || '';
    }
    return this.metadata.caption || '';
  }

  /**
   * Get age in milliseconds
   * @param {number} nowMs - Current time in milliseconds (required)
   * @returns {number}
   */
  getAgeMs(nowMs) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    return nowMs - new Date(this.timestamp).getTime();
  }

  /**
   * Get age in minutes
   * @param {number} nowMs - Current time in milliseconds (required)
   * @returns {number}
   */
  getAgeMinutes(nowMs) {
    return Math.floor(this.getAgeMs(nowMs) / 60000);
  }

  /**
   * Check if message is from a specific sender
   */
  isFrom(senderId) {
    return this.senderId === senderId;
  }

  /**
   * Check if message is recent (within threshold minutes)
   * @param {number} nowMs - Current time in milliseconds (required)
   * @param {number} thresholdMinutes - Threshold in minutes (default 5)
   * @returns {boolean}
   */
  isRecent(nowMs, thresholdMinutes = 5) {
    return this.getAgeMinutes(nowMs) <= thresholdMinutes;
  }

  toJSON() {
    return {
      id: this.id,
      conversationId: this.conversationId,
      senderId: this.senderId,
      recipientId: this.recipientId,
      type: this.type,
      direction: this.direction,
      content: this.content,
      attachments: this.attachments,
      timestamp: this.timestamp,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Message(data);
  }

  /**
   * Create a text message
   * @param {Object} params
   * @param {number} params.nowMs - Current time in milliseconds for ID generation (required)
   */
  static createText({ conversationId, senderId, recipientId, text, timestamp, nowMs, direction = null, metadata = {} }) {
    return new Message({
      id: Message.generateId(nowMs),
      conversationId,
      senderId,
      recipientId,
      type: 'text',
      direction,
      content: text,
      attachments: [],
      timestamp,
      metadata
    });
  }

  /**
   * Create a voice message
   * @param {Object} params
   * @param {number} params.nowMs - Current time in milliseconds for ID generation (required)
   */
  static createVoice({ conversationId, senderId, recipientId, fileId, duration, timestamp, nowMs, direction = null, metadata = {} }) {
    return new Message({
      id: Message.generateId(nowMs),
      conversationId,
      senderId,
      recipientId,
      type: 'voice',
      direction,
      content: { fileId, duration },
      attachments: [{ type: 'voice', fileId, duration }],
      timestamp,
      metadata
    });
  }

  /**
   * Create an image message
   * @param {Object} params
   * @param {number} params.nowMs - Current time in milliseconds for ID generation (required)
   */
  static createImage({ conversationId, senderId, recipientId, fileId, caption, timestamp, nowMs, direction = null, metadata = {} }) {
    return new Message({
      id: Message.generateId(nowMs),
      conversationId,
      senderId,
      recipientId,
      type: 'image',
      direction,
      content: { fileId },
      attachments: [{ type: 'image', fileId, caption }],
      timestamp,
      metadata: { ...metadata, caption }
    });
  }

  /**
   * Create a callback message (button press)
   * @param {Object} params
   * @param {number} params.nowMs - Current time in milliseconds for ID generation (required)
   */
  static createCallback({ conversationId, senderId, recipientId, callbackData, timestamp, nowMs, direction = null, metadata = {} }) {
    return new Message({
      id: Message.generateId(nowMs),
      conversationId,
      senderId,
      recipientId,
      type: 'callback',
      direction,
      content: callbackData,
      attachments: [],
      timestamp,
      metadata
    });
  }

  /**
   * Generate a unique message ID
   * @param {number} nowMs - Current time in milliseconds (required)
   * @returns {string}
   */
  static generateId(nowMs) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required for generateId', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    return `msg-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default Message;
