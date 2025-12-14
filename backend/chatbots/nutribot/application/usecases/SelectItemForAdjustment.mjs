/**
 * Select Item for Adjustment Use Case
 * @module nutribot/application/usecases/SelectItemForAdjustment
 * 
 * Shows adjustment options for a selected food item.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Select item for adjustment use case
 */
export class SelectItemForAdjustment {
  #messagingGateway;
  #conversationStateStore;
  #nutriLogRepository;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, itemId } = input;

    this.#logger.debug('adjustment.selectItem', { userId, itemId });

    try {
      // 1. Get current state
      const state = await this.#conversationStateStore.get(conversationId);
      const { date } = state?.data || {};

      if (!date) {
        throw new Error('No date in adjustment state');
      }

      // 2. Find the item in logs
      const logs = await this.#nutriLogRepository.findByDate(userId, date);
      let foundItem = null;
      let foundLog = null;

      for (const log of logs) {
        const item = log.items.find(i => i.id === itemId);
        if (item) {
          foundItem = item;
          foundLog = log;
          break;
        }
      }

      if (!foundItem) {
        this.#logger.warn('adjustment.itemNotFound', { userId, itemId });
        return { success: false, error: 'Item not found' };
      }

      // 3. Update state
      await this.#conversationStateStore.update(conversationId, {
        step: 'action_selection',
        data: { level: 2, date, itemId, logId: foundLog.id },
      });

      // 4. Build action keyboard
      const keyboard = this.#buildActionKeyboard();

      // 5. Build item detail message
      const message = this.#buildItemDetailMessage(foundItem, date);

      // 6. Update message
      await this.#messagingGateway.updateMessage(conversationId, messageId, {
        text: message,
        parseMode: 'HTML',
        choices: keyboard,
      });

      this.#logger.info('adjustment.itemSelected', { userId, itemId, label: foundItem.label });

      return { success: true, item: foundItem };
    } catch (error) {
      this.#logger.error('adjustment.selectItem.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Build item detail message
   * @private
   */
  #buildItemDetailMessage(item, date) {
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' };
    const emoji = colorEmoji[item.color] || '⚪';

    return `${emoji} <b>${item.label}</b>\n\n` +
      `📅 Date: ${date}\n` +
      `⚖️ Amount: ${item.grams}g\n` +
      `🎨 Color: ${item.color}\n\n` +
      `Select an action:`;
  }

  /**
   * Build action keyboard
   * @private
   */
  #buildActionKeyboard() {
    return [
      // Portion reduction row
      [
        { text: '¼', callback_data: 'adj_factor_0.25' },
        { text: '⅓', callback_data: 'adj_factor_0.33' },
        { text: '½', callback_data: 'adj_factor_0.5' },
        { text: '⅔', callback_data: 'adj_factor_0.67' },
        { text: '¾', callback_data: 'adj_factor_0.75' },
      ],
      // Portion increase row
      [
        { text: '×1¼', callback_data: 'adj_factor_1.25' },
        { text: '×1½', callback_data: 'adj_factor_1.5' },
        { text: '×2', callback_data: 'adj_factor_2' },
        { text: '×3', callback_data: 'adj_factor_3' },
        { text: '×4', callback_data: 'adj_factor_4' },
      ],
      // Actions row
      [
        { text: '🗑️ Delete', callback_data: 'adj_delete' },
        { text: '📅 Move Day', callback_data: 'adj_move' },
        { text: '↩️ Back', callback_data: 'adj_back_items' },
      ],
    ];
  }
}

export default SelectItemForAdjustment;
