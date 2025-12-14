/**
 * Select UPC Portion Use Case
 * @module nutribot/application/usecases/SelectUPCPortion
 * 
 * Applies portion selection to a UPC-based food log.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Select UPC portion use case
 */
export class SelectUPCPortion {
  #messagingGateway;
  #nutrilogRepository;
  #nutrilistRepository;
  #conversationStateStore;
  #generateDailyReport;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#nutrilistRepository = deps.nutrilistRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {number} input.portionFactor - e.g., 0.5, 1, 1.5, 2
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, portionFactor, messageId } = input;

    this.#logger.debug('selectPortion.start', { conversationId, portionFactor });

    try {
      // 1. Get current state
      let state = null;
      if (this.#conversationStateStore) {
        state = await this.#conversationStateStore.get(conversationId);
      }

      if (!state || state.flow !== 'upc_portion') {
        return { success: false, error: 'Not in portion selection mode' };
      }

      const logUuid = state.pendingLogUuid;

      // 2. Load the log
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
      }

      if (!nutriLog || !nutriLog.items?.length) {
        return { success: false, error: 'Log not found' };
      }

      // 3. Apply portion factor to items
      const scaledItems = nutriLog.items.map(item => ({
        ...item,
        quantity: (item.quantity || 1) * portionFactor,
        grams: Math.round((item.grams || 100) * portionFactor),
        calories: Math.round((item.calories || 0) * portionFactor),
        protein: Math.round((item.protein || 0) * portionFactor * 10) / 10,
        carbs: Math.round((item.carbs || 0) * portionFactor * 10) / 10,
        fat: Math.round((item.fat || 0) * portionFactor * 10) / 10,
      }));

      // 4. Update log with scaled items and confirm
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateItems(logUuid, scaledItems);
        await this.#nutrilogRepository.updateStatus(logUuid, 'accepted');
      }

      // 5. Add to nutrilist
      if (this.#nutrilistRepository) {
        const today = new Date().toISOString().split('T')[0];
        const listItems = scaledItems.map(item => ({
          ...item,
          chatId: conversationId,
          logUuid: logUuid,
          date: today,
        }));
        await this.#nutrilistRepository.saveMany(listItems);
      }

      // 6. Clear conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.delete(conversationId);
      }

      // 7. Delete the portion selection message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 8. Generate daily report
      if (this.#generateDailyReport) {
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
        });
      } else {
        // Simple confirmation
        const item = scaledItems[0];
        const portionLabel = portionFactor === 1 ? '1 serving' : `${portionFactor} servings`;
        await this.#messagingGateway.sendMessage(
          conversationId,
          `✅ Logged ${portionLabel} of ${item.name} (${item.calories} cal)`,
          {}
        );
      }

      this.#logger.info('selectPortion.complete', { 
        conversationId, 
        logUuid,
        portionFactor,
      });

      return {
        success: true,
        logUuid,
        portionFactor,
        scaledItems,
      };
    } catch (error) {
      this.#logger.error('selectPortion.error', { conversationId, error: error.message });
      throw error;
    }
  }
}

export default SelectUPCPortion;
