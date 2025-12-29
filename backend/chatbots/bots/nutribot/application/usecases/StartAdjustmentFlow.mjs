/**
 * Start Adjustment Flow Use Case
 * @module nutribot/application/usecases/StartAdjustmentFlow
 * 
 * Initiates the food adjustment flow, defaulting to today's items.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';

/**
 * @typedef {Object} StartAdjustmentFlowInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
 * @property {string} [messageId] - Optional message ID to update (instead of creating new)
 * @property {import('./SelectDateForAdjustment.mjs').SelectDateForAdjustment} selectDateForAdjustment - Date selection use case
 */

/**
 * @typedef {Object} StartAdjustmentFlowResult
 * @property {boolean} success
 * @property {string} [messageId]
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
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case - defaults to showing today's items
   * @param {StartAdjustmentFlowInput} input
   * @returns {Promise<StartAdjustmentFlowResult>}
   */
  async execute(input) {
    const { userId, conversationId, messageId: existingMessageId } = input;

    this.#logger.debug('adjustment.start', { userId, existingMessageId, defaultDay: 'today' });

    try {
      // 1. Set conversation state (if store available)
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'adjustment',
          flowState: { 
            step: 'item_selection',
            level: 1, 
            originMessageId: existingMessageId,
            daysAgo: 0
          },
        });
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 2. Delegate to SelectDateForAdjustment with today (daysAgo=0)
      const result = await this.#selectDateForAdjustment.execute({
        userId,
        conversationId,
        messageId: existingMessageId,
        daysAgo: 0
      });

      this.#logger.info('adjustment.started', { userId, messageId: existingMessageId, defaultedToToday: true, action: 'show_today_items' });

      return result;
    } catch (error) {
      this.#logger.error('adjustment.start.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default StartAdjustmentFlow;
