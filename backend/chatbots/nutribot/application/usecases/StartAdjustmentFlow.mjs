/**
 * Start Adjustment Flow Use Case
 * @module nutribot/application/usecases/StartAdjustmentFlow
 * 
 * Initiates the food adjustment flow, showing date selection.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * @typedef {Object} StartAdjustmentFlowInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
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
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.config) throw new Error('config is required');

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
    const { userId, conversationId } = input;

    this.#logger.debug('adjustment.start', { userId });

    try {
      // 1. Set conversation state
      await this.#conversationStateStore.set(conversationId, {
        flow: 'adjustment',
        step: 'date_selection',
        data: { level: 0 },
        lastActivity: new Date().toISOString(),
      });

      // 2. Build date selection keyboard
      const keyboard = this.#buildDateKeyboard(7);

      // 3. Send message
      const { messageId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '📅 <b>Review & Adjust</b>\n\nSelect a date to review:',
        {
          parseMode: 'HTML',
          choices: keyboard,
          inline: true,
        }
      );

      this.#logger.info('adjustment.started', { userId, messageId });

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
      { text: '☀️ Today', callback_data: 'adj_date_0' },
      { text: '📆 Yesterday', callback_data: 'adj_date_1' },
    ]);

    // Second row: 2-4 days ago
    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: `${dayName}`, callback_data: `adj_date_${i}` });
    }
    keyboard.push(row2);

    // Third row: 5-7 days ago
    const row3 = [];
    for (let i = 5; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row3.push({ text: `${dayName}`, callback_data: `adj_date_${i}` });
    }
    keyboard.push(row3);

    // Done button
    keyboard.push([{ text: '↩️ Done', callback_data: 'adj_done' }]);

    return keyboard;
  }
}

export default StartAdjustmentFlow;
