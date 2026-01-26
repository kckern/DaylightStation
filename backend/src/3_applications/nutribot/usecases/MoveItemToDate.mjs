/**
 * Move Item to Date Use Case
 * @module nutribot/usecases/MoveItemToDate
 *
 * Moves a food item to a different date.
 * If newDate is not provided, shows a date picker first.
 */

import { NutriLog } from '../../../1_domains/nutrition/entities/NutriLog.mjs';

/**
 * Move item to date use case
 */
export class MoveItemToDate {
  #messagingGateway;
  #conversationStateStore;
  #foodLogStore;
  #nutriListStore;
  #generateDailyReport;
  #config;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.foodLogStore) throw new Error('foodLogStore is required');
    if (!deps.nutriListStore) throw new Error('nutriListStore is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, newDate, itemId: inputItemId } = input;

    this.#logger.debug?.('adjustment.move', { userId, newDate, itemId: inputItemId });

    try {
      // 1. Get itemId from input or fallback to state
      let itemId = inputItemId;
      let oldDate = null;
      let logId = null;

      if (!itemId) {
        const state = await this.#conversationStateStore.get(conversationId);
        const flowState = state?.flowState || {};
        itemId = flowState.itemId;
        oldDate = flowState.date;
        logId = flowState.logId;
      }

      if (!itemId) {
        throw new Error('No item selected in adjustment state');
      }

      // If we don't have logId, look it up from nutrilist
      const listItem = await this.#nutriListStore.findByUuid(userId, itemId);
      if (!logId) {
        logId = listItem?.logId || listItem?.log_uuid;
        oldDate = oldDate || listItem?.date;
      }

      // 2. If no newDate provided, show date picker
      if (!newDate) {
        // Save current state with itemId for when date is selected
        const currentState = await this.#conversationStateStore.get(conversationId) || {};
        await this.#conversationStateStore.set(conversationId, {
          ...currentState,
          activeFlow: 'move',
          flowState: { itemId, logId, oldDate },
        });

        const itemLabel = listItem?.name || listItem?.label || 'item';
        const keyboard = this.#buildDateKeyboard(itemId, oldDate);
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          caption: `📅 Move <b>${itemLabel}</b> to which day?`,
          parseMode: 'HTML',
          choices: keyboard,
        });

        return { success: true, showingDatePicker: true };
      }

      if (!logId) {
        throw new Error('Log not found for item');
      }

      // 2. Load the original log
      const originalLog = await this.#foodLogStore.findById(userId, logId);
      if (!originalLog) {
        throw new Error('Log not found');
      }

      // 3. Find the item
      const item = originalLog.items.find((i) => i.id === itemId);
      if (!item) {
        throw new Error('Item not found in log');
      }

      // 4. Remove item from original log
      const now = new Date();
      const updatedOriginalLog = originalLog.removeItem(itemId, now);

      // 5. Save or delete original log
      if (updatedOriginalLog.items.length === 0) {
        await this.#foodLogStore.hardDelete(userId, logId);
      } else {
        await this.#foodLogStore.save(updatedOriginalLog);
        await this.#nutriListStore.syncFromLog(updatedOriginalLog);
      }

      // 6. Create new log for the new date with the item
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const newLog = NutriLog.create({
        userId,
        conversationId,
        text: `Moved: ${item.label}`,
        meal: { date: newDate, time: originalLog.meal?.time || 'afternoon' },
        items: [item],
        timezone,
        timestamp: now,
      }).accept(now);

      await this.#foodLogStore.save(newLog);
      await this.#nutriListStore.syncFromLog(newLog);

      // 7. Clear adjustment state
      await this.#conversationStateStore.clear(conversationId);

      // 8. Delete adjustment message
      try {
        await this.#messagingGateway.deleteMessage(conversationId, messageId);
      } catch (e) {
        // Ignore delete errors
      }

      // 9. Send confirmation
      await this.#messagingGateway.sendMessage(conversationId, `📅 <b>${item.label}</b> moved\n${oldDate} → ${newDate}`, { parseMode: 'HTML' });

      // 10. Regenerate reports for both dates if available
      if (this.#generateDailyReport) {
        if (oldDate !== newDate) {
          await this.#generateDailyReport.execute({
            userId,
            conversationId,
            date: oldDate,
            forceRegenerate: true,
          });
        }
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
          date: newDate,
          forceRegenerate: true,
        });
      }

      this.#logger.info?.('adjustment.moved', { userId, itemId, oldDate, newDate });

      return { success: true, oldDate, newDate, item };
    } catch (error) {
      this.#logger.error?.('adjustment.move.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Build date selection keyboard for move
   * @private
   */
  #buildDateKeyboard(itemId, currentDate) {
    const keyboard = [];
    const today = new Date();

    // Row 1: Today and Yesterday
    keyboard.push([
      { text: '☀️ Today', callback_data: this.#encodeCallback('md', { id: itemId, d: 0 }) },
      { text: '📆 Yesterday', callback_data: this.#encodeCallback('md', { id: itemId, d: 1 }) },
    ]);

    // Row 2: Past 3 days
    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: dayName, callback_data: this.#encodeCallback('md', { id: itemId, d: i }) });
    }
    keyboard.push(row2);

    // Row 3: Cancel
    keyboard.push([{ text: '↩️ Cancel', callback_data: this.#encodeCallback('bi') }]);

    return keyboard;
  }
}

export default MoveItemToDate;
