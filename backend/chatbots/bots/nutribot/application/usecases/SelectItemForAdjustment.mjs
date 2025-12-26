/**
 * Select Item for Adjustment Use Case
 * @module nutribot/application/usecases/SelectItemForAdjustment
 * 
 * Shows adjustment options for a selected food item.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
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
        // Items in nutrilist use 'uuid' field, try findByUuid first
        if (this.#nutrilistRepository.findByUuid) {
          foundItem = await this.#nutrilistRepository.findByUuid(userId, itemId);
        }
        // Fall back to findAll and filter by uuid or id
        if (!foundItem && this.#nutrilistRepository.findAll) {
          const allItems = await this.#nutrilistRepository.findAll(userId);
          foundItem = allItems.find(item => item.uuid === itemId || item.id === itemId);
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
          activeFlow: 'adjustment',
          flowState: { level: 2, date, itemId },
        });
      }

      // 4. Build action keyboard
      const keyboard = this.#buildActionKeyboard(itemId);

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
    const name = item.name || item.label || item.item || 'Unknown';
    const amount = item.amount || item.grams || '?';
    const unit = item.unit || 'g';
    const calories = item.calories || 0;
    const fat = item.fat || 0;
    const protein = item.protein || 0;
    const carbs = item.carbs || 0;

    return `${emoji} ${name} (${amount}${unit})\n` +
      `🔥 ${Math.round(calories)} cal\n` +
      `🧀 ${Math.round(fat)}g 🍖 ${Math.round(protein)}g 🍏 ${Math.round(carbs)}g\n\n` +
      `↕️ How to adjust?`;
  }

  /**
   * Build action keyboard (matches legacy foodlog_hook.mjs format)
   * @private
   */
  #buildActionKeyboard(itemId) {
    return [
      // Fraction row
      [
        { text: '¼', callback_data: encodeCallback('f', { id: itemId, f: 0.25 }) },
        { text: '⅓', callback_data: encodeCallback('f', { id: itemId, f: 0.33 }) },
        { text: '½', callback_data: encodeCallback('f', { id: itemId, f: 0.5 }) },
        { text: '⅔', callback_data: encodeCallback('f', { id: itemId, f: 0.67 }) },
        { text: '¾', callback_data: encodeCallback('f', { id: itemId, f: 0.75 }) },
      ],
      // Multiplier row
      [
        { text: '×1¼', callback_data: encodeCallback('f', { id: itemId, f: 1.25 }) },
        { text: '×1½', callback_data: encodeCallback('f', { id: itemId, f: 1.5 }) },
        { text: '×1¾', callback_data: encodeCallback('f', { id: itemId, f: 1.75 }) },
        { text: '×2', callback_data: encodeCallback('f', { id: itemId, f: 2 }) },
        { text: '×3', callback_data: encodeCallback('f', { id: itemId, f: 3 }) },
        { text: '×4', callback_data: encodeCallback('f', { id: itemId, f: 4 }) },
      ],
      // Actions row
      [
        { text: '🗑️ Delete', callback_data: encodeCallback('d', { id: itemId }) },
        { text: '📅 Move Day', callback_data: encodeCallback('m', { id: itemId }) },
        { text: '↩️ Done', callback_data: encodeCallback('bi') },
      ],
    ];
  }
}

export default SelectItemForAdjustment;
