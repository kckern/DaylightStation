/**
 * Start Adjustment Flow Use Case
 * @module nutribot/usecases/StartAdjustmentFlow
 *
 * Initiates the food adjustment flow, defaulting to today's items.
 */

/**
 * Start adjustment flow use case
 */
export class StartAdjustmentFlow {
  #messagingGateway;
  #conversationStateStore;
  #selectDateForAdjustment;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.selectDateForAdjustment) throw new Error('selectDateForAdjustment is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#selectDateForAdjustment = deps.selectDateForAdjustment;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case - defaults to showing today's items
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, messageId: existingMessageId, responseContext } = input;

    this.#logger.debug?.('adjustment.start', { userId, existingMessageId, defaultDay: 'today', hasResponseContext: !!responseContext });

    try {
      // 1. Set conversation state (if store available)
      if (this.#conversationStateStore) {
        const state = {
          conversationId,
          activeFlow: 'adjustment',
          flowState: {
            step: 'item_selection',
            level: 1,
            originMessageId: existingMessageId,
            daysAgo: 0,
          },
        };
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 2. Delegate to SelectDateForAdjustment with today (daysAgo=0)
      const result = await this.#selectDateForAdjustment.execute({
        userId,
        conversationId,
        messageId: existingMessageId,
        daysAgo: 0,
        responseContext,
      });

      this.#logger.info?.('adjustment.started', { userId, messageId: existingMessageId, defaultedToToday: true });

      return result;
    } catch (error) {
      this.#logger.error?.('adjustment.start.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default StartAdjustmentFlow;
