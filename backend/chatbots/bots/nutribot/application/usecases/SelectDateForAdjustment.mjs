/**
 * Select Date for Adjustment Use Case
 * @module nutribot/application/usecases/SelectDateForAdjustment
 * 
 * Handles date selection in adjustment flow, shows items for that date.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { NOOM_COLOR_EMOJI } from '../../domain/formatters.mjs';

/**
 * @typedef {Object} SelectDateForAdjustmentInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID
 * @property {string} messageId - Message to update
 * @property {number} daysAgo - Number of days ago (0 = today)
 */

/**
 * Select date for adjustment use case
 */
export class SelectDateForAdjustment {
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
    const { userId, conversationId, messageId, daysAgo, offset = 0 } = input;

    this.#logger.debug('adjustment.selectDate', { userId, daysAgo, messageId });

    try {
      // Get originMessageId from state (the report photo message)
      let originMessageId = messageId;
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        originMessageId = state?.flowState?.originMessageId || messageId;
      }

      // 1. Calculate date
      const date = this.#getDateFromDaysAgo(daysAgo);

      // 2. Load items for date from nutrilist
      let items = [];
      if (this.#nutrilistRepository?.findByDate) {
        items = await this.#nutrilistRepository.findByDate(userId, date) || [];
      } else if (this.#nutrilistRepository?.getAll) {
        const allItems = this.#nutrilistRepository.getAll();
        items = allItems.filter(item => item.date === date);
      }

      // 3. If no items, show message and stay at level 0
      if (items.length === 0) {
        // Build date keyboard for going back
        const keyboard = this.#buildDateKeyboard();
        // Update photo caption with "no items" message
        await this.#messagingGateway.updateMessage(conversationId, originMessageId, {
          caption: `📅 <b>No items for ${date}</b>\n\nNo food logged for this date. Select another date:`,
          parseMode: 'HTML',
          choices: keyboard,
        });
        return { success: true, noItems: true };
      }

      // 4. Update state (if store available)
      if (this.#conversationStateStore?.update) {
        await this.#conversationStateStore.update(conversationId, {
          activeFlow: 'adjustment',
          flowState: { level: 1, date, daysAgo, items: items.map(i => i.id), offset },
        });
      }

      // 5. Build item selection keyboard
      const keyboard = this.#buildItemKeyboard(items, offset, daysAgo);

      // 6. Build message with items list
      const message = this.#buildItemsMessage(date, items);

      // 7. Update photo caption with items list (not send new message)
      await this.#messagingGateway.updateMessage(conversationId, originMessageId, {
        caption: message,
        parseMode: 'HTML',
        choices: keyboard,
      });

      this.#logger.info('adjustment.dateSelected', { userId, date, itemCount: items.length });

      return { success: true, date, itemCount: items.length };
    } catch (error) {
      this.#logger.error('adjustment.selectDate.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get date string from days ago (local time)
   * @private
   */
  #getDateFromDaysAgo(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    // Use local date format YYYY-MM-DD
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  /**
   * Build date keyboard (for going back)
   * @private
   */
  #buildDateKeyboard() {
    const keyboard = [];
    const today = new Date();

    keyboard.push([
      { text: '☀️ Today', callback_data: 'adj_date_0' },
      { text: '📆 Yesterday', callback_data: 'adj_date_1' },
    ]);

    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: dayName, callback_data: `adj_date_${i}` });
    }
    keyboard.push(row2);

    keyboard.push([{ text: '↩️ Done', callback_data: 'adj_done' }]);

    return keyboard;
  }

  /**
   * Build items message (simplified - buttons show the items)
   * @private
   */
  #buildItemsMessage(date, items) {
    const totalCal = items.reduce((sum, i) => sum + (i.calories || 0), 0);
    const totalGrams = items.reduce((sum, i) => sum + (i.grams || 0), 0);
    
    return `📅 <b>${date}</b>\n` +
      `${items.length} items • ${totalGrams}g • ${totalCal} cal\n\n` +
      `Select an item to adjust:`;
  }

  /**
   * Build item selection keyboard
   * @private
   */
  #buildItemKeyboard(items, offset, daysAgo = 0) {
    const keyboard = [];
    const pageSize = 9; // 3 rows of 3 items
    // Sort by calories descending
    const sortedItems = [...items].sort((a, b) => (b.calories || 0) - (a.calories || 0));
    const pageItems = sortedItems.slice(offset, offset + pageSize);

    // Item buttons (3 per row)
    let currentRow = [];
    for (const item of pageItems) {
      const emoji = NOOM_COLOR_EMOJI[item.noom_color || item.color] || '⚪';
      const name = item.name || item.label || item.item || 'Item';
      // Truncate name if too long for button
      const truncatedName = name.length > 12 ? name.substring(0, 10) + '…' : name;
      const label = `${emoji} ${truncatedName}`;
      // Use uuid, id, or fall back to log_uuid (for legacy items without uuid)
      const itemId = item.uuid || item.id || item.log_uuid;
      
      currentRow.push({
        text: label,
        callback_data: `adj_item_${itemId}`,
      });
      
      // Every 3 items, push row and start new one
      if (currentRow.length === 3) {
        keyboard.push(currentRow);
        currentRow = [];
      }
    }
    // Push any remaining items in partial row
    if (currentRow.length > 0) {
      keyboard.push(currentRow);
    }

    // Navigation row
    const navRow = [];
    if (offset > 0) {
      navRow.push({ text: '⬆️ Prev', callback_data: `adj_page_${daysAgo}_${offset - pageSize}` });
    }
    if (offset + pageSize < sortedItems.length) {
      navRow.push({ text: '⬇️ More', callback_data: `adj_page_${daysAgo}_${offset + pageSize}` });
    }
    if (navRow.length > 0) {
      keyboard.push(navRow);
    }

    // Action row
    keyboard.push([
      { text: '📅 Other Day', callback_data: 'adj_back_date' },
      { text: '✅ Done', callback_data: 'adj_done' },
    ]);

    return keyboard;
  }
}

export default SelectDateForAdjustment;
