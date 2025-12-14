/**
 * Select Date for Adjustment Use Case
 * @module nutribot/application/usecases/SelectDateForAdjustment
 * 
 * Handles date selection in adjustment flow, shows items for that date.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

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
    const { userId, conversationId, messageId, daysAgo } = input;

    this.#logger.debug('adjustment.selectDate', { userId, daysAgo });

    try {
      // 1. Calculate date
      const date = this.#getDateFromDaysAgo(userId, daysAgo);

      // 2. Load items for date
      const logs = await this.#nutriLogRepository.findByDate(userId, date);
      const acceptedLogs = logs.filter(log => log.isAccepted);
      
      // Flatten items with log reference
      const items = [];
      for (const log of acceptedLogs) {
        for (const item of log.items) {
          items.push({
            ...item,
            logId: log.id,
            meal: log.meal,
          });
        }
      }

      // 3. If no items, show message and stay at level 0
      if (items.length === 0) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          text: `📅 <b>No items for ${date}</b>\n\nNo food logged for this date. Select another date:`,
          parseMode: 'HTML',
        });
        return { success: true, noItems: true };
      }

      // 4. Update state
      await this.#conversationStateStore.update(conversationId, {
        step: 'item_selection',
        data: { level: 1, date, items: items.map(i => i.id), offset: 0 },
      });

      // 5. Build item selection keyboard
      const keyboard = this.#buildItemKeyboard(items, 0);

      // 6. Build message with items list
      const message = this.#buildItemsMessage(date, items);

      // 7. Update message
      await this.#messagingGateway.updateMessage(conversationId, messageId, {
        text: message,
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
   * Get date string from days ago
   * @private
   */
  #getDateFromDaysAgo(userId, daysAgo) {
    const timezone = this.#config.getUserTimezone(userId);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  }

  /**
   * Build items message
   * @private
   */
  #buildItemsMessage(date, items) {
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' };
    
    let message = `📅 <b>${date}</b>\n\nSelect an item to adjust:\n\n`;
    
    for (let i = 0; i < Math.min(items.length, 10); i++) {
      const item = items[i];
      const emoji = colorEmoji[item.color] || '⚪';
      message += `${i + 1}. ${emoji} ${item.label} (${item.grams}g)\n`;
    }

    if (items.length > 10) {
      message += `\n... and ${items.length - 10} more`;
    }

    return message;
  }

  /**
   * Build item selection keyboard
   * @private
   */
  #buildItemKeyboard(items, offset) {
    const keyboard = [];
    const pageSize = 5;
    const pageItems = items.slice(offset, offset + pageSize);
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' };

    // Item buttons (2 per row)
    for (let i = 0; i < pageItems.length; i += 2) {
      const row = [];
      for (let j = i; j < Math.min(i + 2, pageItems.length); j++) {
        const item = pageItems[j];
        const emoji = colorEmoji[item.color] || '⚪';
        const label = item.label.length > 12 ? item.label.slice(0, 12) + '…' : item.label;
        row.push({
          text: `${emoji} ${label}`,
          callback_data: `adj_item_${item.id}`,
        });
      }
      keyboard.push(row);
    }

    // Navigation row
    const navRow = [];
    if (offset > 0) {
      navRow.push({ text: '⏮️ Prev', callback_data: `adj_page_${offset - pageSize}` });
    }
    if (offset + pageSize < items.length) {
      navRow.push({ text: '⏭️ Next', callback_data: `adj_page_${offset + pageSize}` });
    }
    if (navRow.length > 0) {
      keyboard.push(navRow);
    }

    // Action row
    keyboard.push([
      { text: '📅 Other Day', callback_data: 'adj_back_date' },
      { text: '↩️ Done', callback_data: 'adj_done' },
    ]);

    return keyboard;
  }
}

export default SelectDateForAdjustment;
