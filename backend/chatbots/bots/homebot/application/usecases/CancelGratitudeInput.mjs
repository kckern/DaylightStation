/**
 * Cancel Gratitude Input Use Case
 * @module homebot/application/usecases/CancelGratitudeInput
 * 
 * Handles cancel callback - clears state and deletes message.
 * Phase 1: Stub implementation.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Cancel Gratitude Input Use Case
 */
export class CancelGratitudeInput {
  #messagingGateway;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'homebot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.conversationId - Chat ID
   * @param {string} input.callbackQueryId - Callback query ID to answer
   * @param {string} input.messageId - Message ID to delete
   */
  async execute(input) {
    const { conversationId, callbackQueryId, messageId } = input;

    this.#logger.info('cancelGratitudeInput.start', { conversationId });

    try {
      // Delete the confirmation message
      if (messageId && this.#messagingGateway) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          this.#logger.debug('cancelGratitudeInput.deleteMessage.skipped', { error: e.message });
        }
      }

      // Clear conversation state
      if (this.#conversationStateStore) {
        try {
          await this.#conversationStateStore.delete(conversationId);
        } catch (e) {
          this.#logger.debug('cancelGratitudeInput.clearState.skipped', { error: e.message });
        }
      }

      // Send cancellation confirmation
      await this.#messagingGateway.sendMessage(conversationId, {
        text: '❌ Cancelled. Send new items whenever you\'re ready!',
      });

      this.#logger.info('cancelGratitudeInput.complete', { conversationId });

    } catch (error) {
      this.#logger.error('cancelGratitudeInput.failed', {
        conversationId,
        error: error.message,
      });
    }
  }
}

export default CancelGratitudeInput;
