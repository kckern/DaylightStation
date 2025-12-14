/**
 * Console Gateway for Debugging
 * @module infrastructure/messaging/ConsoleGateway
 */

import { MessageId } from '../../domain/value-objects/MessageId.mjs';

/**
 * Console-based implementation of IMessagingGateway
 * Useful for local development and debugging
 */
export class ConsoleGateway {
  #nextMessageId = 1;
  #prefix;

  /**
   * @param {Object} [options]
   * @param {string} [options.prefix='[ChatBot]']
   */
  constructor(options = {}) {
    this.#prefix = options.prefix || '[ChatBot]';
    this.botId = 'console';
  }

  /**
   * Send a text message (logs to console)
   */
  async sendMessage(chatId, text, options = {}) {
    const messageId = MessageId.from(this.#nextMessageId++);
    
    console.log(`${this.#prefix} → ${chatId.userId}:`);
    console.log(`  ${text}`);
    
    if (options.choices) {
      console.log(`  [Choices: ${options.choices.flat().join(', ')}]`);
    }
    
    return { messageId };
  }

  /**
   * Send an image (logs to console)
   */
  async sendImage(chatId, imageSource, caption, options = {}) {
    const messageId = MessageId.from(this.#nextMessageId++);
    
    console.log(`${this.#prefix} → ${chatId.userId}: [IMAGE]`);
    console.log(`  Source: ${Buffer.isBuffer(imageSource) ? '[Buffer]' : imageSource}`);
    if (caption) {
      console.log(`  Caption: ${caption}`);
    }
    
    return { messageId };
  }

  /**
   * Update message (logs to console)
   */
  async updateMessage(chatId, messageId, updates) {
    console.log(`${this.#prefix} → ${chatId.userId}: [UPDATE #${messageId}]`);
    console.log(`  Updates: ${JSON.stringify(updates)}`);
  }

  /**
   * Update keyboard (logs to console)
   */
  async updateKeyboard(chatId, messageId, choices) {
    console.log(`${this.#prefix} → ${chatId.userId}: [UPDATE KEYBOARD #${messageId}]`);
    console.log(`  Choices: ${choices.flat().join(', ')}`);
  }

  /**
   * Delete message (logs to console)
   */
  async deleteMessage(chatId, messageId) {
    console.log(`${this.#prefix} → ${chatId.userId}: [DELETE #${messageId}]`);
  }

  /**
   * Transcribe voice (returns placeholder)
   */
  async transcribeVoice(voiceFileId) {
    console.log(`${this.#prefix}: [TRANSCRIBE ${voiceFileId}]`);
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
