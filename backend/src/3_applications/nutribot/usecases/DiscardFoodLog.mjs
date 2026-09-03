/**
 * Discard Food Log Use Case
 * @module nutribot/usecases/DiscardFoodLog
 *
 * Discard is now DELETE, and it works on a COMMITTED log.
 *
 * Captures land immediately as `accepted` + `settled: false`, so the button
 * this use case backs reads "Undo" — it must remove a log that already has
 * rows in the nutrilist and is already counted by BudgetService. It therefore
 * marks the log `deleted` (not `rejected` — that status is unreachable now)
 * and removes the log's nutrilist rows.
 */

/**
 * Discard food log use case
 */
export class DiscardFoodLog {
  #messagingGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
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
      // 1. Mark the log deleted (accepted logs included — this is Undo)
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateStatus(userId, logUuid, 'deleted');
      }

      // 1b. Remove the log's nutrilist rows so the day view and the budget stop
      // counting it. A committed capture already wrote rows via the accept path.
      if (this.#nutriListStore?.removeByLogId) {
        try {
          const removed = await this.#nutriListStore.removeByLogId(userId, logUuid);
          this.#logger.debug?.('discardLog.nutrilistRemoved', { logUuid, removed });
        } catch (e) {
          this.#logger.warn?.('discardLog.nutrilistRemoveFailed', { logUuid, error: e.message });
        }
      }

      // 2. Clear revision state if any
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.clear(conversationId);
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
