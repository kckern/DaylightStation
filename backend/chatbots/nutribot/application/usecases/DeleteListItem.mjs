/**
 * Delete List Item Use Case
 * @module nutribot/application/usecases/DeleteListItem
 * 
 * Deletes a food item from a log.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Delete list item use case
 */
export class DeleteListItem {
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
    const { userId, conversationId, messageId } = input;

    this.#logger.debug('adjustment.delete', { userId });

    try {
      // 1. Get current state
      const state = await this.#conversationStateStore.get(conversationId);
      const { date, itemId, logId } = state?.data || {};

      if (!itemId || !logId) {
        throw new Error('No item selected in adjustment state');
      }

      // 2. Load the log
      const log = await this.#nutriLogRepository.findById(userId, logId);
      if (!log) {
        throw new Error('Log not found');
      }

      // 3. Find the item
      const item = log.items.find(i => i.id === itemId);
      if (!item) {
        throw new Error('Item not found in log');
      }

      // 4. Remove item from log
      const updatedLog = log.removeItem(itemId);
      
      // 5. If log is now empty, delete it; otherwise save updated
      if (updatedLog.items.length === 0) {
        await this.#nutriLogRepository.hardDelete(userId, logId);
      } else {
        await this.#nutriLogRepository.save(updatedLog);
      }

      // 6. Sync to nutrilist (will remove items for this log)
      await this.#nutriListRepository.syncFromLog(updatedLog);

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
        `🗑️ <b>${item.label}</b> deleted`,
        { parseMode: 'HTML' }
      );

      // 10. Regenerate report if available
      if (this.#generateDailyReport) {
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
          date,
          forceRegenerate: true,
        });
      }

      this.#logger.info('adjustment.deleted', { userId, itemId, label: item.label });

      return { success: true, deletedItem: item };
    } catch (error) {
      this.#logger.error('adjustment.delete.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default DeleteListItem;
