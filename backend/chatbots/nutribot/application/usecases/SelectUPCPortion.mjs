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

      if (!state || state.activeFlow !== 'upc_portion') {
        this.#logger.warn('selectPortion.invalidState', { conversationId, activeFlow: state?.activeFlow });
        return { success: false, error: 'Not in portion selection mode' };
      }

      const logUuid = state.flowState?.pendingLogUuid;

      // 2. Load the log (extract userId from conversationId)
      const userId = conversationId.split('_').pop();
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid, userId);
      }

      if (!nutriLog || !nutriLog.items?.length) {
        this.#logger.warn('selectPortion.logNotFound', { logUuid, userId, hasLog: !!nutriLog, itemCount: nutriLog?.items?.length });
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

      // 4. Update nutrilog status to accepted
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateStatus(logUuid, 'accepted', userId);
      }

      // 5. Add to nutrilist
      if (this.#nutrilistRepository) {
        // Use local date, not UTC
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

      // 8. Generate daily report (if available, skipped in CLI mode)
      if (this.#generateDailyReport) {
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
        });
      }
      // Note: Confirmation message handled by caller (CLI shows its own)

      this.#logger.info('selectPortion.complete', { 
        conversationId, 
        logUuid,
        portionFactor,
      });

      return {
        success: true,
        logUuid,
        portionFactor,
        item: scaledItems[0], // Primary item for confirmation
        scaledItems,
      };
    } catch (error) {
      this.#logger.error('selectPortion.error', { conversationId, error: error.message });
      throw error;
    }
  }
}

export default SelectUPCPortion;
