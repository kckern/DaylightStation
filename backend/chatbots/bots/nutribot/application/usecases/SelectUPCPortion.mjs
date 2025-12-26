/**
 * Select UPC Portion Use Case
 * @module nutribot/application/usecases/SelectUPCPortion
 * 
 * Applies portion selection to a UPC-based food log.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Select UPC portion use case (stateless - UUID in callback data)
 */
export class SelectUPCPortion {
  #messagingGateway;
  #nutrilogRepository;
  #nutrilistRepository;
  #generateDailyReport;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#nutrilistRepository = deps.nutrilistRepository;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.logUuid - UUID of the food log (from callback data)
   * @param {number} input.portionFactor - e.g., 0.5, 1, 1.5, 2
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { conversationId, logUuid, portionFactor, messageId } = input;

    this.#logger.debug('selectPortion.start', { conversationId, logUuid, portionFactor });

    try {
      // Validate logUuid was provided (stateless - no session required)
      if (!logUuid) {
        this.#logger.warn('selectPortion.missingLogUuid', { conversationId });
        return { success: false, error: 'Missing log UUID' };
      }

      // Load the log (extract userId from conversationId)
      const userId = conversationId.split('_').pop();
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid, userId);
      }

      if (!nutriLog || !nutriLog.items?.length) {
        this.#logger.warn('selectPortion.logNotFound', { logUuid, userId, hasLog: !!nutriLog, itemCount: nutriLog?.items?.length });
        return { success: false, error: 'Log not found' };
      }

      // Check if already processed
      if (nutriLog.status !== 'pending') {
        this.#logger.info('selectPortion.alreadyProcessed', { logUuid, status: nutriLog.status });
        return { success: false, error: 'Log already processed' };
      }

      // Apply portion factor to items
      // Use toJSON() to convert FoodItem instances to plain objects
      const scaledItems = nutriLog.items.map(item => {
        const itemData = typeof item.toJSON === 'function' ? item.toJSON() : item;
        return {
          ...itemData,
          quantity: (itemData.quantity || 1) * portionFactor,
          grams: Math.round((itemData.grams || 100) * portionFactor),
          calories: Math.round((itemData.calories || 0) * portionFactor),
          protein: Math.round((itemData.protein || 0) * portionFactor * 10) / 10,
          carbs: Math.round((itemData.carbs || 0) * portionFactor * 10) / 10,
          fat: Math.round((itemData.fat || 0) * portionFactor * 10) / 10,
        };
      });

      // Update nutrilog status to accepted
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateStatus(logUuid, 'accepted', userId);
      }

      // Add to nutrilist
      if (this.#nutrilistRepository) {
        // Use the date from the nutriLog.meal, fall back to today (local date)
        const now = new Date();
        const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const logDate = nutriLog.meal?.date || nutriLog.date || fallbackDate;
        
        this.#logger.debug('selectPortion.savingToNutrilist', { logUuid, logDate, mealDate: nutriLog.meal?.date });
        
        const listItems = scaledItems.map(item => ({
          ...item,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutrilistRepository.saveMany(listItems);
      }

      // 6. Delete the portion selection message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 8. Generate daily report (if available, skipped in CLI mode)
      // Check for other pending items first
      if (this.#generateDailyReport && this.#nutrilogRepository) {
        try {
          const pending = await this.#nutrilogRepository.findPending(userId);
          this.#logger.debug('selectPortion.autoreport.pendingCheck', { userId, pendingCount: pending.length });
          if (pending.length === 0) {
            // Small delay to allow concurrent events to settle
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
            });
          } else {
            this.#logger.debug('selectPortion.autoreport.skipped', { userId, pendingCount: pending.length });
          }
        } catch (e) {
          this.#logger.warn('selectPortion.autoreport.error', { error: e.message });
        }
      } else if (this.#generateDailyReport) {
        // Fallback if no repository available
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
