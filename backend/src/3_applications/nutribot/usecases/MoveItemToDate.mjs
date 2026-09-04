/**
 * Move Item to Date Use Case
 * @module nutribot/usecases/MoveItemToDate
 *
 * Moves a food item to a different date.
 * If newDate is not provided, shows a date picker first.
 */

import { isISODate } from '#shared/contracts/health/isoDate.mjs';

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
    const { userId, conversationId, messageId, newDate, entryId: inputEntryId } = input;

    this.#logger.debug?.('adjustment.move', { userId, newDate, entryId: inputEntryId });

    try {
      // 1. Get entryId from input or fallback to state
      let entryId = inputEntryId;
      let oldDate = null;
      let logId = null;

      if (!entryId) {
        const state = await this.#conversationStateStore.get(conversationId);
        const flowState = state?.flowState || {};
        entryId = flowState.entryId || flowState.itemId;
        oldDate = flowState.date;
        logId = flowState.logId;
      }

      if (!entryId) {
        throw new Error('No item selected in adjustment state');
      }

      // If we don't have logId, look it up from nutrilist
      const listItem = await this.#nutriListStore.findByUuid(userId, entryId);
      if (!listItem) throw new Error('Item not found');
      oldDate = listItem.date || oldDate;
      logId = listItem.logId || listItem.log_uuid || logId;
      const item = { ...listItem, label: listItem.label || listItem.name || listItem.item };
      if (!newDate) {
        const current = await this.#conversationStateStore.get(conversationId) || {};
        await this.#conversationStateStore.set(conversationId, { ...current, activeFlow: 'move',
          flowState: { entryId, logId, date: oldDate } });
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          caption: `Move ${item.label} to which day?`, choices: this.#buildDateKeyboard(entryId, oldDate),
        });
        return { success: true, showingDatePicker: true };
      }
      if (!isISODate(newDate)) throw Object.assign(new Error('A real destination date is required'), { status: 400 });
      const siblings = item.kind === 'group' ? await this.#nutriListStore.findByDate(userId, oldDate) : [];
      const parentIds = new Set([item.id, item.uuid].filter(Boolean));
      const ids = [entryId, ...siblings.filter(child => parentIds.has(child.parentId)).map(child => child.uuid || child.id)];
      if (this.#nutriListStore.mutateEntries) {
        await this.#nutriListStore.mutateEntries(userId, { updates: ids.map(id => ({ id, changes: { date: newDate } })) });
      } else {
        await this.#nutriListStore.update(userId, entryId, { date: newDate });
      }

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

      this.#logger.info?.('adjustment.moved', { userId, entryId, oldDate, newDate });

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
  #buildDateKeyboard(entryId, currentDate) {
    const keyboard = [];
    const today = new Date();

    // Row 1: Today and Yesterday
    keyboard.push([
      { text: '☀️ Today', callback_data: this.#encodeCallback('md', { id: entryId, d: 0 }) },
      { text: '📆 Yesterday', callback_data: this.#encodeCallback('md', { id: entryId, d: 1 }) },
    ]);

    // Row 2: Past 3 days
    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: dayName, callback_data: this.#encodeCallback('md', { id: entryId, d: i }) });
    }
    keyboard.push(row2);

    // Row 3: Cancel
    keyboard.push([{ text: '↩️ Cancel', callback_data: this.#encodeCallback('bi') }]);

    return keyboard;
  }
}

export default MoveItemToDate;
