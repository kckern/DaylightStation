/**
 * CancelGratitudeInput Use Case
 * @module homebot/usecases/CancelGratitudeInput
 *
 * Handles cancelling the gratitude/hopes input flow when
 * the user clicks the Cancel button.
 */

/**
 * Cancel gratitude input use case
 */
export class CancelGratitudeInput {
  #messagingGateway;
  #conversationStateStore;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for updating/deleting messages
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.messagingGateway) throw new Error('messagingGateway is required');
    if (!config.conversationStateStore) throw new Error('conversationStateStore is required');

    this.#messagingGateway = config.messagingGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#logger = config.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageId - Message ID of the confirmation UI
   * @returns {Promise<Object>} Result with success status
   */
  async execute({ conversationId, messageId }) {
    this.#logger.info?.('cancelGratitudeInput.start', { conversationId, messageId });

    try {
      // 1. Get state from conversation state store (optional - may not exist)
      const state = await this.#conversationStateStore.get(conversationId, messageId);

      // 2. Update message to show cancelled
      await this.#messagingGateway.updateMessage(
        conversationId,
        messageId,
        '❌ Input cancelled.'
      );

      // 3. Clear conversation state (if it exists)
      if (state) {
        await this.#conversationStateStore.delete(conversationId, messageId);
      }

      this.#logger.info?.('cancelGratitudeInput.complete', {
        conversationId,
        hadState: !!state
      });

      return {
        success: true,
        hadState: !!state
      };
    } catch (error) {
      this.#logger.error?.('cancelGratitudeInput.error', {
        conversationId,
        error: error.message
      });
      throw error;
    }
  }
}

export default CancelGratitudeInput;
