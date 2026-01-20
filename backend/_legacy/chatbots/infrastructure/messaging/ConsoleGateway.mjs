/**
 * Console Gateway for Debugging
 * @module infrastructure/messaging/ConsoleGateway
 */

import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Console-based implementation of IMessagingGateway
 * Useful for local development and debugging
 */
export class ConsoleGateway {
  #nextMessageId = 1;
  #prefix;
  #logger;

  /**
   * @param {Object} [options]
   * @param {string} [options.prefix='[ChatBot]']
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#prefix = options.prefix || '[ChatBot]';
    this.#logger = options.logger || createLogger({ app: 'console-gateway' });
    this.botId = 'console';
  }

  /**
   * Send a text message (logs to logger)
   */
  async sendMessage(chatId, text, options = {}) {
    const messageId = MessageId.from(this.#nextMessageId++);
    
    this.#logger.debug('console.sendMessage', {
      chatId: chatId.userId,
      text,
      hasChoices: !!options.choices,
      choices: options.choices ? options.choices.flat() : undefined,
    });
    
    return { messageId };
  }

  /**
   * Send an image (logs to logger)
   */
  async sendImage(chatId, imageSource, caption, options = {}) {
    const messageId = MessageId.from(this.#nextMessageId++);
    
    this.#logger.debug('console.sendImage', {
      chatId: chatId.userId,
      imageSource: Buffer.isBuffer(imageSource) ? '[Buffer]' : imageSource,
      caption,
    });
    
    return { messageId };
  }

  /**
   * Update message (logs to logger)
   */
  async updateMessage(chatId, messageId, updates) {
    this.#logger.debug('console.updateMessage', {
      chatId: chatId.userId,
      messageId: messageId.toString(),
      updates,
    });
  }

  /**
   * Update keyboard (logs to logger)
   */
  async updateKeyboard(chatId, messageId, choices) {
    this.#logger.debug('console.updateKeyboard', {
      chatId: chatId.userId,
      messageId: messageId.toString(),
      choices: choices.flat(),
    });
  }

  /**
   * Delete message (logs to logger)
   */
  async deleteMessage(chatId, messageId) {
    this.#logger.debug('console.deleteMessage', {
      chatId: chatId.userId,
      messageId: messageId.toString(),
    });
  }

  /**
   * Transcribe voice (returns placeholder)
   */
  async transcribeVoice(voiceFileId) {
    this.#logger.debug('console.transcribeVoice', {
      voiceFileId,
    });
    return '[Voice transcription not available in console mode]';
  }

  /**
   * Get file URL (returns placeholder)
   */
  async getFileUrl(fileId) {
    return `file://${fileId}`;
  }
}

export default ConsoleGateway;
