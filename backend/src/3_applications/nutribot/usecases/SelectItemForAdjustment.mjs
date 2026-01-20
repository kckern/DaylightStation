/**
 * Select Item for Adjustment Use Case
 * @module nutribot/usecases/SelectItemForAdjustment
 *
 * Shows adjustment options for a selected food item.
 */

import { NOOM_COLOR_EMOJI } from '../../../1_domains/nutrition/entities/formatters.mjs';

/**
 * Select item for adjustment use case
 */
export class SelectItemForAdjustment {
  #messagingGateway;
  #conversationStateStore;
  #nutriListStore;
  #config;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, itemId } = input;

    this.#logger.debug?.('adjustment.selectItem', { userId, itemId });

    try {
      // 1. Get current state to find the date
      let date = null;
      if (this.#conversationStateStore?.get) {
        const state = await this.#conversationStateStore.get(conversationId);
        date = state?.flowState?.date;
      }

      // 2. Find the item in nutrilist
      let foundItem = null;
      if (this.#nutriListStore) {
        if (this.#nutriListStore.findByUuid) {
          foundItem = await this.#nutriListStore.findByUuid(userId, itemId);
        }
        if (!foundItem && this.#nutriListStore.findAll) {
          const allItems = await this.#nutriListStore.findAll(userId);
          foundItem = allItems.find((item) => item.uuid === itemId || item.id === itemId);
        }
      }

      if (!foundItem) {
        this.#logger.warn?.('adjustment.itemNotFound', { userId, itemId });
        return { success: false, error: 'Item not found' };
      }

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
        caption: message,
        parseMode: 'HTML',
        choices: keyboard,
      });

      const label = foundItem.name || foundItem.label || 'item';
      this.#logger.info?.('adjustment.itemSelected', { userId, itemId, label });

      return { success: true, item: foundItem };
    } catch (error) {
      this.#logger.error?.('adjustment.selectItem.error', { userId, error: error.message });
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

    return `${emoji} ${name} (${amount}${unit})\n` + `🔥 ${Math.round(calories)} cal\n` + `🧀 ${Math.round(fat)}g 🍖 ${Math.round(protein)}g 🍏 ${Math.round(carbs)}g\n\n` + `↕️ How to adjust?`;
  }

  /**
   * Build action keyboard
   * @private
   */
  #buildActionKeyboard(itemId) {
    return [
      // Fraction row
      [
        { text: '¼', callback_data: this.#encodeCallback('f', { id: itemId, f: 0.25 }) },
        { text: '⅓', callback_data: this.#encodeCallback('f', { id: itemId, f: 0.33 }) },
        { text: '½', callback_data: this.#encodeCallback('f', { id: itemId, f: 0.5 }) },
        { text: '⅔', callback_data: this.#encodeCallback('f', { id: itemId, f: 0.67 }) },
        { text: '¾', callback_data: this.#encodeCallback('f', { id: itemId, f: 0.75 }) },
      ],
      // Multiplier row
      [
        { text: '×1¼', callback_data: this.#encodeCallback('f', { id: itemId, f: 1.25 }) },
        { text: '×1½', callback_data: this.#encodeCallback('f', { id: itemId, f: 1.5 }) },
        { text: '×1¾', callback_data: this.#encodeCallback('f', { id: itemId, f: 1.75 }) },
        { text: '×2', callback_data: this.#encodeCallback('f', { id: itemId, f: 2 }) },
        { text: '×3', callback_data: this.#encodeCallback('f', { id: itemId, f: 3 }) },
        { text: '×4', callback_data: this.#encodeCallback('f', { id: itemId, f: 4 }) },
      ],
      // Actions row
      [
        { text: '🗑️ Delete', callback_data: this.#encodeCallback('d', { id: itemId }) },
        { text: '📅 Move Day', callback_data: this.#encodeCallback('m', { id: itemId }) },
        { text: '↩️ Done', callback_data: this.#encodeCallback('bi') },
      ],
    ];
  }
}

export default SelectItemForAdjustment;
