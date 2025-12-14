/**
 * Apply Portion Adjustment Use Case
 * @module nutribot/application/usecases/ApplyPortionAdjustment
 * 
 * Applies a portion scaling factor to a food item.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Apply portion adjustment use case
 */
export class ApplyPortionAdjustment {
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
    this.#generateDailyReport = deps.generateDailyReport; // Optional
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, factor } = input;

    this.#logger.debug('adjustment.applyFactor', { userId, factor });

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

      // 3. Find and scale the item
      const itemIndex = log.items.findIndex(i => i.id === itemId);
      if (itemIndex === -1) {
        throw new Error('Item not found in log');
      }

      const originalItem = log.items[itemIndex];
      const scaledGrams = Math.round(originalItem.grams * factor);
      const scaledAmount = Math.round((originalItem.amount || originalItem.grams) * factor * 100) / 100;

      // 4. Update the log with scaled item
      const updatedItems = [...log.items];
      updatedItems[itemIndex] = {
        ...originalItem,
        grams: scaledGrams,
        amount: scaledAmount,
      };

      const updatedLog = log.updateItems(updatedItems);
      await this.#nutriLogRepository.save(updatedLog);

      // 5. Sync to nutrilist
      await this.#nutriListRepository.syncFromLog(updatedLog);

      // 6. Clear adjustment state
      await this.#conversationStateStore.clear(conversationId);

      // 7. Delete adjustment message
      try {
        await this.#messagingGateway.deleteMessage(conversationId, messageId);
      } catch (e) {
        // Ignore delete errors
      }

      // 8. Send confirmation
      const factorText = factor < 1 ? `reduced to ${Math.round(factor * 100)}%` : `increased to ${Math.round(factor * 100)}%`;
      await this.#messagingGateway.sendMessage(
        conversationId,
        `✅ <b>${originalItem.label}</b> ${factorText}\n${originalItem.grams}g → ${scaledGrams}g`,
        { parseMode: 'HTML' }
      );

      // 9. Regenerate report if available
      if (this.#generateDailyReport) {
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
          date,
          forceRegenerate: true,
        });
      }

      this.#logger.info('adjustment.factorApplied', { userId, itemId, factor, oldGrams: originalItem.grams, newGrams: scaledGrams });

      return { success: true, scaledGrams, originalGrams: originalItem.grams };
    } catch (error) {
      this.#logger.error('adjustment.applyFactor.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ApplyPortionAdjustment;
