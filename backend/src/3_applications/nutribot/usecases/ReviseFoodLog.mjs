/**
 * Revise Food Log Use Case
 * @module nutribot/usecases/ReviseFoodLog
 *
 * Enters revision mode for a pending food log.
 */


/**
 * Revise food log use case
 */
export class ReviseFoodLog {
  #receipts;
  #foodLogStore;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    this.#receipts = deps.receipts || (() => null);
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
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

    this.#logger.debug?.('reviseLog.start', { conversationId, logUuid, hasResponseContext: !!responseContext });

    if (!logUuid) {
      this.#logger.error?.('reviseLog.missingLogUuid', { conversationId });
      throw new Error('logUuid is required');
    }

    try {
      // 1. Load the log to show current items
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }
      if (!nutriLog || !['accepted', 'pending', 'deleted'].includes(nutriLog.status)) throw new Error('Food entry is no longer available');

      // 2. Set conversation state to revision mode
      if (this.#conversationStateStore) {
        const state = {
          conversationId,
          activeFlow: 'revision',
          flowState: {
            pendingLogUuid: logUuid,
            originalMessageId: messageId,
          },
        };
        await this.#conversationStateStore.set(conversationId, state);
        this.#logger.info?.('reviseLog.stateSet', { conversationId, activeFlow: state.activeFlow });
      }

      const result = await this.#receipts()?.interaction(userId, logUuid, 'revision');
      const message = result?.receipts?.[0]?.text;

      this.#logger.info?.('reviseLog.modeEnabled', { conversationId, logUuid });

      return {
        success: true,
        logUuid,
        mode: 'revision',
        message,
      };
    } catch (error) {
      this.#logger.error?.('reviseLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default ReviseFoodLog;
