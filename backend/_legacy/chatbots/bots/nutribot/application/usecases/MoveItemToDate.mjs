/**
 * Move Item to Date Use Case
 * @module nutribot/application/usecases/MoveItemToDate
 * 
 * Moves a food item to a different date.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { NutriLog } from '../../domain/NutriLog.mjs';

/**
 * Move item to date use case
 */
export class MoveItemToDate {
  #messagingGateway;
  #conversationStateStore;
  #nutriLogRepository;
  #nutriListRepository;
  #generateDailyReport;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.nutriListRepository) throw new Error('nutriListRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#nutriListRepository = deps.nutriListRepository;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, newDate, itemId: inputItemId } = input;

    this.#logger.debug('adjustment.move', { userId, newDate, itemId: inputItemId });

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
      if (!logId) {
        const listItem = await this.#nutriListRepository.findByUuid(userId, itemId);
        logId = listItem?.logId || listItem?.log_uuid;
        oldDate = oldDate || listItem?.date;
      }

      if (!logId) {
        throw new Error('Log not found for item');
      }

      // 2. Load the original log
      const originalLog = await this.#nutriLogRepository.findById(userId, logId);
      if (!originalLog) {
        throw new Error('Log not found');
      }

      // 3. Find the item
      const item = originalLog.items.find(i => i.id === itemId);
      if (!item) {
        throw new Error('Item not found in log');
      }

      // 4. Remove item from original log
      const updatedOriginalLog = originalLog.removeItem(itemId);
      
      // 5. Save or delete original log
      if (updatedOriginalLog.items.length === 0) {
        await this.#nutriLogRepository.hardDelete(userId, logId);
      } else {
        await this.#nutriLogRepository.save(updatedOriginalLog);
        await this.#nutriListRepository.syncFromLog(updatedOriginalLog);
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
      }).accept();

      await this.#nutriLogRepository.save(newLog);
      await this.#nutriListRepository.syncFromLog(newLog);

      // 7. Clear adjustment state
      await this.#conversationStateStore.clear(conversationId);

      // 8. Delete adjustment message
      try {
        await this.#messagingGateway.deleteMessage(conversationId, messageId);
      } catch (e) {
        // Ignore delete errors
      }

      // 9. Send confirmation
      await this.#messagingGateway.sendMessage(
        conversationId,
        `📅 <b>${item.label}</b> moved\n${oldDate} → ${newDate}`,
        { parseMode: 'HTML' }
      );

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

      this.#logger.info('adjustment.moved', { userId, itemId, oldDate, newDate });

      return { success: true, oldDate, newDate, item };
    } catch (error) {
      this.#logger.error('adjustment.move.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default MoveItemToDate;
