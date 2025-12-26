/**
 * Start Adjustment Flow Use Case
 * @module nutribot/application/usecases/StartAdjustmentFlow
 * 
 * Initiates the food adjustment flow, showing date selection.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';

/**
 * @typedef {Object} StartAdjustmentFlowInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
 * @property {string} [messageId] - Optional message ID to update (instead of creating new)
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
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {StartAdjustmentFlowInput} input
   * @returns {Promise<StartAdjustmentFlowResult>}
   */
  async execute(input) {
    const { userId, conversationId, messageId: existingMessageId } = input;

    this.#logger.debug('adjustment.start', { userId, existingMessageId });

    try {
      // 1. Set conversation state (if store available)
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'adjustment',
          flowState: { 
            step: 'date_selection',
            level: 0, 
            originMessageId: existingMessageId 
          },
        });
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 2. Build date selection keyboard
      const keyboard = this.#buildDateKeyboard(7);
      
      let messageId = existingMessageId;

      if (existingMessageId) {
        // Update caption and reply markup on the photo message
        await this.#messagingGateway.updateMessage(conversationId, existingMessageId, {
          caption: '📅 <b>Review & Adjust</b>\n\nSelect a date to review:',
          parseMode: 'HTML',
          choices: keyboard,
        });
      } else {
        // Fallback: create new message if no existing message
        const text = '📅 <b>Review & Adjust</b>\n\nSelect a date to review:';
        const result = await this.#messagingGateway.sendMessage(
          conversationId,
          text,
          {
            parseMode: 'HTML',
            choices: keyboard,
            inline: true,
          }
        );
        messageId = result.messageId;
      }

      this.#logger.info('adjustment.started', { userId, messageId, wasUpdate: !!existingMessageId });

      return { success: true, messageId };
    } catch (error) {
      this.#logger.error('adjustment.start.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Build date selection keyboard
   * @private
   */
  #buildDateKeyboard(daysBack) {
    const keyboard = [];
    const today = new Date();

    // First row: Today and Yesterday
    keyboard.push([
      { text: '☀️ Today', callback_data: encodeCallback('dt', { d: 0 }) },
      { text: '📆 Yesterday', callback_data: encodeCallback('dt', { d: 1 }) },
    ]);

    // Second row: 2-4 days ago
    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: `${dayName}`, callback_data: encodeCallback('dt', { d: i }) });
    }
    keyboard.push(row2);

    // Third row: 5-7 days ago
    const row3 = [];
    for (let i = 5; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row3.push({ text: `${dayName}`, callback_data: encodeCallback('dt', { d: i }) });
    }
    keyboard.push(row3);

    // Done button
    keyboard.push([{ text: '↩️ Done', callback_data: encodeCallback('dn') }]);

    return keyboard;
  }
}

export default StartAdjustmentFlow;
