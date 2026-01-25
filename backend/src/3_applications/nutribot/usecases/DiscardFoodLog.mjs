/**
 * Discard Food Log Use Case
 * @module nutribot/usecases/DiscardFoodLog
 *
 * Discards a pending food log without saving items.
 */

/**
 * Discard food log use case
 */
export class DiscardFoodLog {
  #messagingGateway;
  #foodLogStore;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.logUuid
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, logUuid, messageId, responseContext } = input;

    this.#logger.debug?.('discardLog.start', { conversationId, logUuid, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Update log status to rejected
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateStatus(userId, logUuid, 'rejected');
      }

      // 2. Clear revision state if any
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        if (state) {
          await this.#conversationStateStore.set(conversationId, state.clearFlow());
        }
      }

      // 3. Delete the confirmation message
      if (messageId) {
        try {
          await messaging.deleteMessage(messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      this.#logger.info?.('discardLog.complete', { conversationId, logUuid });

      return {
        success: true,
        logUuid,
      };
    } catch (error) {
      this.#logger.error?.('discardLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default DiscardFoodLog;
