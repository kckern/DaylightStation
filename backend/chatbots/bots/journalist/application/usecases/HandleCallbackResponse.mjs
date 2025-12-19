/**
 * Handle Callback Response Use Case
 * @module journalist/application/usecases/HandleCallbackResponse
 * 
 * Handles callback responses from inline keyboard buttons.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * @typedef {Object} HandleCallbackResponseInput
 * @property {string} chatId
 * @property {string} messageId
 * @property {string} callbackData - Button callback data
 * @property {Object} [options] - Additional options
 */

/**
 * Handle callback response use case
 */
export class HandleCallbackResponse {
  #messagingGateway;
  #journalEntryRepository;
  #handleQuizAnswer;
  #processTextEntry;
  #initiateJournalPrompt;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#handleQuizAnswer = deps.handleQuizAnswer;
    this.#processTextEntry = deps.processTextEntry;
    this.#initiateJournalPrompt = deps.initiateJournalPrompt;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {HandleCallbackResponseInput} input
   */
  async execute(input) {
    const { chatId, messageId, callbackData, options = {} } = input;

    this.#logger.debug('callback.handle.start', { chatId, callbackData });

    try {
      // 1. Handle special callbacks
      if (callbackData === '🎲 Change Subject') {
        // Change subject - start new prompt
        if (this.#initiateJournalPrompt) {
          return this.#initiateJournalPrompt.execute({ chatId, instructions: 'change_subject' });
        }
        return { success: true, action: 'change_subject' };
      }

      if (callbackData === '❌ Cancel') {
        // Cancel - just acknowledge
        await this.#messagingGateway.updateMessage(chatId, messageId, {
          text: '❌ Cancelled',
          choices: null,
        });
        return { success: true, action: 'cancelled' };
      }

      // 2. Check if this is a quiz callback
      const foreignKey = options.foreignKey || await this.#loadForeignKey(chatId, messageId);
      
      if (foreignKey?.quiz && this.#handleQuizAnswer) {
        return this.#handleQuizAnswer.execute({
          chatId,
          messageId,
          questionUuid: foreignKey.quiz,
          answer: callbackData,
        });
      }

      // 3. Treat as text response
      if (this.#processTextEntry) {
        // Remove keyboard from original message
        try {
          await this.#messagingGateway.updateKeyboard(chatId, messageId, null);
        } catch (e) {
          // Ignore keyboard update errors
        }

        return this.#processTextEntry.execute({
          chatId,
          text: callbackData,
          messageId: `callback_${Date.now()}`,
          senderId: options.senderId || 'user',
          senderName: options.senderName || 'User',
        });
      }

      this.#logger.info('callback.handle.complete', { chatId, action: 'text_response' });

      return { success: true, action: 'processed_as_text' };
    } catch (error) {
      this.#logger.error('callback.handle.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Load foreign key from message
   * @private
   */
  async #loadForeignKey(chatId, messageId) {
    if (!this.#journalEntryRepository?.getMessageById) {
      return null;
    }

    try {
      const message = await this.#journalEntryRepository.getMessageById(chatId, messageId);
      return message?.foreignKey || null;
    } catch {
      return null;
    }
  }
}

export default HandleCallbackResponse;
