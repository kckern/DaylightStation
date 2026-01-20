/**
 * Delete List Item Use Case
 * @module nutribot/usecases/DeleteListItem
 *
 * Deletes a food item from a log and syncs nutrilist.
 */

/**
 * Delete list item use case
 */
export class DeleteListItem {
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
   * Execute delete
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} [input.messageId]
   * @param {string} [input.itemId]
   */
  async execute(input) {
    const { userId, conversationId, messageId, itemId: inputItemId } = input;

    this.#logger.debug?.('adjustment.delete', { userId, inputItemId });

    try {
      // Prefer itemId from callback; fallback to state
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
      const listItem = await this.#nutriListStore.findByUuid(userId, itemId);
      const logId = listItem?.logId || listItem?.log_uuid || state?.flowState?.logId;

      let itemLabel = listItem?.label || listItem?.name || 'item';

      // Load log if available
      const log = logId ? await this.#foodLogStore.findById(userId, logId) : null;

      if (log) {
        const item = log.items.find((i) => i.id === itemId || i.uuid === itemId);
        if (item) {
          itemLabel = item.label || item.name || itemLabel;
          const removeId = item.id || item.uuid || itemId;
          const updatedLog = log.removeItem(removeId);

          if (updatedLog.items.length === 0) {
            await this.#foodLogStore.hardDelete(userId, logId);
          } else {
            await this.#foodLogStore.save(updatedLog);
          }

          await this.#nutriListStore.syncFromLog(updatedLog);
        } else {
          this.#logger.debug?.('adjustment.delete.itemNotInLog', { userId, itemId, logId });
          await this.#nutriListStore.deleteById(userId, itemId);
        }
      } else {
        this.#logger.debug?.('adjustment.delete.noLog', { userId, itemId, logId });
        await this.#nutriListStore.deleteById(userId, itemId);
      }

      // Update message with confirmation
      const confirmationText = `🗑️ <b>${itemLabel}</b> deleted`;

      if (messageId) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          text: confirmationText,
          parseMode: 'HTML',
          choices: [
            [
              { text: '↩️ Back to items', callback_data: this.#encodeCallback('bi') },
              { text: '✅ Done', callback_data: this.#encodeCallback('dn') },
            ],
          ],
        });
      } else {
        await this.#messagingGateway.sendMessage(conversationId, confirmationText, {
          parseMode: 'HTML',
          choices: [
            [
              { text: '↩️ Back to items', callback_data: this.#encodeCallback('bi') },
              { text: '✅ Done', callback_data: this.#encodeCallback('dn') },
            ],
          ],
        });
      }

      this.#logger.info?.('adjustment.deleted', { userId, logId, itemId });
      return { success: true };
    } catch (error) {
      this.#logger.error?.('adjustment.delete.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default DeleteListItem;
