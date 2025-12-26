/**
 * Delete List Item Use Case
 * Deletes a food item from a log and syncs nutrilist.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

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
   * Execute delete
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} [input.messageId]
   * @param {string} [input.itemId] - Prefer from callback; fallback to state
   */
  async execute(input) {
    const { userId, conversationId, messageId, itemId: inputItemId } = input;

    this.#logger.debug('adjustment.delete', { userId, inputItemId });

    try {
      // Prefer itemId from callback; fallback to state (legacy)
      let itemId = inputItemId;
      let state = null;
      if (!itemId && this.#conversationStateStore?.get) {
        state = await this.#conversationStateStore.get(conversationId);
        itemId = state?.flowState?.itemId;
      }

      if (!itemId) {
        throw new Error('No item selected');
      }

      // Find item in nutrilist to get logId
      const listItem = await this.#nutriListRepository.findByUuid(userId, itemId);
      const logId = listItem?.logId || listItem?.log_uuid || state?.flowState?.logId;
      if (!logId) {
        throw new Error('Log not found for item');
      }

      // Load log
      const log = await this.#nutriLogRepository.findById(userId, logId);
      if (!log) {
        throw new Error('Log not found');
      }

      // Find the item in the log
      const item = log.items.find(i => i.id === itemId || i.uuid === itemId);
      if (!item) {
        throw new Error('Item not found in log');
      }

      // Remove item from log
      const removeId = item.id || item.uuid || itemId;
      const updatedLog = log.removeItem(removeId);
      
      // If log is now empty, delete it; otherwise save updated
      if (updatedLog.items.length === 0) {
        await this.#nutriLogRepository.hardDelete(userId, logId);
      } else {
        await this.#nutriLogRepository.save(updatedLog);
      }

      // Sync to nutrilist (will remove items for this log)
      await this.#nutriListRepository.syncFromLog(updatedLog);

      // Update message with confirmation and follow-up options
      const confirmationText = `🗑️ <b>${item.label || item.name || 'item'}</b> deleted`;
      
      if (messageId) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          text: confirmationText,
          parseMode: 'HTML',
          choices: [
            [
              { text: '↩️ Back to items', callback_data: 'adj_back_items' },
              { text: '✅ Done', callback_data: 'adj_done' },
            ],
          ],
        });
      } else {
        await this.#messagingGateway.sendMessage(
          conversationId,
          confirmationText,
          { 
            parseMode: 'HTML',
            choices: [
              [
                { text: '↩️ Back to items', callback_data: 'adj_back_items' },
                { text: '✅ Done', callback_data: 'adj_done' },
              ],
            ],
          }
        );
      }

      this.#logger.info('adjustment.deleted', { userId, logId, itemId: removeId });
      return { success: true };
    } catch (error) {
      this.#logger.error('adjustment.delete.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default DeleteListItem;
