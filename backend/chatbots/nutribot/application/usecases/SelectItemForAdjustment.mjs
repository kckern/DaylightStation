/**
 * Select Item for Adjustment Use Case
 * @module nutribot/application/usecases/SelectItemForAdjustment
 * 
 * Shows adjustment options for a selected food item.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { NOOM_COLOR_EMOJI } from '../../domain/formatters.mjs';

/**
 * Select item for adjustment use case
 */
export class SelectItemForAdjustment {
  #messagingGateway;
  #conversationStateStore;
  #nutrilistRepository;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutrilistRepository = deps.nutrilistRepository;
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
      // 1. Get current state to find the date
      let date = null;
      if (this.#conversationStateStore?.get) {
        const state = await this.#conversationStateStore.get(conversationId);
        date = state?.flowState?.date;
      }

      // 2. Find the item in nutrilist
      let foundItem = null;
      if (this.#nutrilistRepository) {
        // Try to find by ID directly
        if (this.#nutrilistRepository.findById) {
          foundItem = await this.#nutrilistRepository.findById(itemId);
        }
        // Fall back to getAll and filter
        if (!foundItem && this.#nutrilistRepository.getAll) {
          const allItems = this.#nutrilistRepository.getAll();
          foundItem = allItems.find(item => item.id === itemId);
        }
      }

      if (!foundItem) {
        this.#logger.warn('adjustment.itemNotFound', { userId, itemId });
        return { success: false, error: 'Item not found' };
      }

      // Use item's date if we don't have one from state
      date = date || foundItem.date;

      // 3. Update state (if store available)
      if (this.#conversationStateStore?.update) {
        await this.#conversationStateStore.update(conversationId, {
          step: 'action_selection',
          data: { level: 2, date, itemId },
        });
      }

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

      const label = foundItem.name || foundItem.label || 'item';
      this.#logger.info('adjustment.itemSelected', { userId, itemId, label });

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
    const color = item.noom_color || item.color;
    const emoji = NOOM_COLOR_EMOJI[color] || '⚪';
    const name = item.name || item.label || 'Unknown';

    return `${emoji} <b>${name}</b>\n\n` +
      `📅 Date: ${date}\n` +
      `⚖️ Amount: ${item.grams || '?'}g\n` +
      `🔥 Calories: ${item.calories || '?'}\n` +
      `🎨 Color: ${color || 'unknown'}\n\n` +
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
