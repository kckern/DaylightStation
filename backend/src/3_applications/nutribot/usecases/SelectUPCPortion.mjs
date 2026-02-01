/**
 * Select UPC Portion Use Case
 * @module nutribot/usecases/SelectUPCPortion
 *
 * Applies portion selection to a UPC-based food log.
 */

/**
 * Select UPC portion use case (stateless - UUID in callback data)
 */
export class SelectUPCPortion {
  #messagingGateway;
  #foodLogStore;
  #nutriListStore;
  #generateDailyReport;
  #logger;

  /**
   * Format confirmation message for accepted food
   * @param {Array} items - Scaled food items
   * @param {string} logDate - Date string YYYY-MM-DD
   * @returns {string}
   */
  #formatConfirmation(items, logDate) {
    // Format date like "Sun, 25 Jan 2026"
    const date = new Date(logDate + 'T12:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear();
    const dateStr = `${dayName}, ${day} ${month} ${year}`;

    // Determine meal period based on current time
    const hour = new Date().getHours();
    let period = 'evening';
    if (hour < 12) period = 'morning';
    else if (hour < 17) period = 'afternoon';

    // Format items
    const itemLines = items.map((item) => {
      const grams = item.grams || 100;
      const name = item.label || item.food || item.name || 'Food';
      return `🟢 ${name} ${grams}g`;
    });

    return `✅ ${dateStr} ${period}\n\n${itemLines.join('\n')}`;
  }

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || console;
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
    const { userId, conversationId, logUuid, portionFactor, messageId, responseContext } = input;

    this.#logger.debug?.('selectPortion.start', { conversationId, logUuid, portionFactor });

    try {
      // Validate logUuid was provided (stateless - no session required)
      if (!logUuid) {
        this.#logger.warn?.('selectPortion.missingLogUuid', { conversationId });
        return { success: false, error: 'Missing log UUID' };
      }

      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      if (!nutriLog || !nutriLog.items?.length) {
        this.#logger.warn?.('selectPortion.logNotFound', { logUuid, userId });
        return { success: false, error: 'Log not found' };
      }

      // Check if already processed
      if (nutriLog.status !== 'pending') {
        this.#logger.info?.('selectPortion.alreadyProcessed', { logUuid, status: nutriLog.status });
        if (messageId) {
          try {
            await this.#messagingGateway.updateMessage(conversationId, messageId, { choices: [] });
          } catch (e) {
            try {
              await this.#messagingGateway.deleteMessage(conversationId, messageId);
            } catch (err) {
              this.#logger.warn?.('selectPortion.uiCleanupFailed', { error: err.message });
            }
          }
        }
        return { success: false, error: 'Log already processed' };
      }

      // Apply portion factor to items
      const scaledItems = nutriLog.items.map((item) => {
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
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateStatus(userId, logUuid, 'accepted');
        this.#logger.debug?.('selectPortion.statusUpdated', { logUuid, userId, newStatus: 'accepted' });
      }

      // Add to nutrilist
      if (this.#nutriListStore) {
        const now = new Date();
        const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const logDate = nutriLog.meal?.date || nutriLog.date || fallbackDate;

        this.#logger.debug?.('selectPortion.savingToNutrilist', { logUuid, logDate });

        const listItems = scaledItems.map((item) => ({
          ...item,
          userId: userId,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutriListStore.saveMany(listItems);

        // Send confirmation message
        const confirmMsg = this.#formatConfirmation(scaledItems, logDate);
        await this.#messagingGateway.sendMessage(conversationId, confirmMsg, { responseContext });
      }

      // Delete the portion selection message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // Generate daily report if no pending items
      this.#logger.debug?.('selectPortion.autoreport.check', {
        hasGenerateReport: !!this.#generateDailyReport,
        hasFoodLogStore: !!this.#foodLogStore,
        userId,
      });

      if (this.#generateDailyReport && this.#foodLogStore) {
        try {
          const pending = await this.#foodLogStore.findPending(userId);
          this.#logger.debug?.('selectPortion.autoreport.pendingCheck', {
            pendingCount: pending.length,
            userId,
          });
          if (pending.length === 0) {
            this.#logger.info?.('selectPortion.autoreport.triggering', { userId, conversationId });
            await new Promise((resolve) => setTimeout(resolve, 300));
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              responseContext,
            });
          } else {
            this.#logger.debug?.('selectPortion.autoreport.skipped', {
              reason: 'pending_items_exist',
              pendingCount: pending.length,
            });
          }
        } catch (e) {
          this.#logger.warn?.('selectPortion.autoreport.error', { error: e.message });
        }
      } else if (this.#generateDailyReport) {
        this.#logger.info?.('selectPortion.autoreport.triggering', {
          userId,
          conversationId,
          reason: 'no_foodLogStore',
        });
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
          responseContext,
        });
      } else {
        this.#logger.debug?.('selectPortion.autoreport.skipped', {
          reason: 'no_generateDailyReport_usecase',
        });
      }

      this.#logger.info?.('selectPortion.complete', {
        conversationId,
        logUuid,
        portionFactor,
      });

      return {
        success: true,
        logUuid,
        portionFactor,
        item: scaledItems[0],
        scaledItems,
      };
    } catch (error) {
      this.#logger.error?.('selectPortion.error', { conversationId, error: error.message });
      throw error;
    }
  }
}

export default SelectUPCPortion;
