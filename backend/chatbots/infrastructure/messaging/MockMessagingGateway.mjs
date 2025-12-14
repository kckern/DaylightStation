/**
 * Mock Messaging Gateway for Testing
 * @module infrastructure/messaging/MockMessagingGateway
 */

import { MessageId } from '../../domain/value-objects/MessageId.mjs';

/**
 * In-memory mock implementation of IMessagingGateway
 * Useful for testing without network calls
 */
export class MockMessagingGateway {
  /** @type {Array<Object>} */
  #sentMessages = [];
  
  /** @type {Array<Object>} */
  #deletedMessages = [];
  
  /** @type {Array<Object>} */
  #updatedMessages = [];
  
  /** @type {number} */
  #nextMessageId = 1000;
  
  /** @type {Map<string, string>} */
  #transcriptions = new Map();
  
  /** @type {Map<string, string>} */
  #fileUrls = new Map();
  
  /** @type {Error|null} */
  #simulatedError = null;

  /**
   * @param {Object} [options]
   * @param {string} [options.botId='mock-bot']
   */
  constructor(options = {}) {
    this.botId = options.botId || 'mock-bot';
  }

  // ==================== IMessagingGateway Implementation ====================

  /**
   * Send a text message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {string} text
   * @param {Object} [options]
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendMessage(chatId, text, options = {}) {
    this.#checkForError();
    
    const messageId = MessageId.from(this.#nextMessageId++);
    
    this.#sentMessages.push({
      type: 'message',
      chatId: chatId.toJSON(),
      text,
      options,
      messageId: messageId.toString(),
      timestamp: new Date().toISOString(),
    });

    return { messageId };
  }

  /**
   * Send an image
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {string|Buffer} imageSource
   * @param {string} [caption]
   * @param {Object} [options]
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendImage(chatId, imageSource, caption, options = {}) {
    this.#checkForError();
    
    const messageId = MessageId.from(this.#nextMessageId++);
    
    this.#sentMessages.push({
      type: 'image',
      chatId: chatId.toJSON(),
      imageSource: Buffer.isBuffer(imageSource) ? '[Buffer]' : imageSource,
      caption,
      options,
      messageId: messageId.toString(),
      timestamp: new Date().toISOString(),
    });

    return { messageId };
  }

  /**
   * Update an existing message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async updateMessage(chatId, messageId, updates) {
    this.#checkForError();
    
    this.#updatedMessages.push({
      chatId: chatId.toJSON(),
      messageId: messageId.toString(),
      updates,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Update just the keyboard
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @param {Array<Array<string|Object>>} choices
   * @returns {Promise<void>}
   */
  async updateKeyboard(chatId, messageId, choices) {
    this.#checkForError();
    
    this.#updatedMessages.push({
      chatId: chatId.toJSON(),
      messageId: messageId.toString(),
      updates: { choices },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Delete a message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @returns {Promise<void>}
   */
  async deleteMessage(chatId, messageId) {
    this.#checkForError();
    
    this.#deletedMessages.push({
      chatId: chatId.toJSON(),
      messageId: messageId.toString(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Transcribe a voice message
   * @param {string} voiceFileId
   * @returns {Promise<string>}
   */
  async transcribeVoice(voiceFileId) {
    this.#checkForError();
    
    const transcription = this.#transcriptions.get(voiceFileId);
    if (!transcription) {
      return 'Mock transcription for ' + voiceFileId;
    }
    return transcription;
  }

  /**
   * Get download URL for a file
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getFileUrl(fileId) {
    this.#checkForError();
    
    const url = this.#fileUrls.get(fileId);
    if (!url) {
      return `https://mock-telegram.example.com/file/${fileId}`;
    }
    return url;
  }

  // ==================== Testing Helpers ====================

  /**
   * Get the last sent message
   * @returns {Object|null}
   */
  getLastMessage() {
    return this.#sentMessages.length > 0 
      ? this.#sentMessages[this.#sentMessages.length - 1] 
      : null;
  }

  /**
   * Get all sent messages
   * @returns {Array<Object>}
   */
  getAllMessages() {
    return [...this.#sentMessages];
  }

  /**
   * Get messages sent to a specific chat
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @returns {Array<Object>}
   */
  getMessagesTo(chatId) {
    // Compare using the full string representation for accuracy
    const targetKey = chatId.toString();
    return this.#sentMessages.filter(m => {
      // m.chatId is a JSON serialized version, reconstruct for comparison
      const msgKey = `${m.chatId.channel}:${m.chatId.identifier}`;
      return msgKey === targetKey;
    });
  }

  /**
   * Get all deleted messages
   * @returns {Array<Object>}
   */
  getDeletedMessages() {
    return [...this.#deletedMessages];
  }

  /**
   * Get all updated messages
   * @returns {Array<Object>}
   */
  getUpdatedMessages() {
    return [...this.#updatedMessages];
  }

  /**
   * Set the next message ID
   * @param {number} id
   */
  setNextMessageId(id) {
    this.#nextMessageId = id;
  }

  /**
   * Set a transcription result
   * @param {string} fileId
   * @param {string} text
   */
  setTranscription(fileId, text) {
    this.#transcriptions.set(fileId, text);
  }

  /**
   * Set a file URL
   * @param {string} fileId
   * @param {string} url
   */
  setFileUrl(fileId, url) {
    this.#fileUrls.set(fileId, url);
  }

  /**
   * Simulate an error on next call
   * @param {Error} error
   */
  simulateError(error) {
    this.#simulatedError = error;
  }

  /**
   * Clear simulated error
   */
  clearError() {
    this.#simulatedError = null;
  }

  /**
   * Reset all state
   */
  reset() {
    this.#sentMessages = [];
    this.#deletedMessages = [];
    this.#updatedMessages = [];
    this.#nextMessageId = 1000;
    this.#transcriptions.clear();
    this.#fileUrls.clear();
    this.#simulatedError = null;
  }

  /**
   * Get count of sent messages
   * @returns {number}
   */
  get messageCount() {
    return this.#sentMessages.length;
  }

  /**
   * Check for and throw simulated error
   * @private
   */
  #checkForError() {
    if (this.#simulatedError) {
      const error = this.#simulatedError;
      this.#simulatedError = null; // Clear after throwing
      throw error;
    }
  }
}

export default MockMessagingGateway;
