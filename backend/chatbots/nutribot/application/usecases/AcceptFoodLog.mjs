/**
 * Accept Food Log Use Case
 * @module nutribot/application/usecases/AcceptFoodLog
 * 
 * Confirms a pending food log and adds items to daily list.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Accept food log use case
 */
export class AcceptFoodLog {
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
   * @param {string} input.logUuid
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, logUuid, messageId } = input;

    this.#logger.debug('acceptLog.start', { conversationId, logUuid });

    try {
      // 1. Load the log
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
      }

      if (!nutriLog) {
        this.#logger.warn('acceptLog.notFound', { logUuid });
        return { success: false, error: 'Log not found' };
      }

      // 2. Check status
      if (nutriLog.status !== 'pending') {
        this.#logger.warn('acceptLog.invalidStatus', { logUuid, status: nutriLog.status });
        return { success: false, error: 'Log already processed' };
      }

      // 3. Update log status to CONFIRMED
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateStatus(logUuid, 'accepted');
      }

      // 4. Add items to nutrilist
      if (this.#nutrilistRepository && nutriLog.items?.length > 0) {
        // Use the date from the nutriLog (parsed from user input like "yesterday")
        // Fall back to today if no date was specified
        const fallbackDate = new Date().toISOString().split('T')[0];
        const logDate = nutriLog.date || fallbackDate;
        
        const listItems = nutriLog.items.map(item => ({
          ...item,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutrilistRepository.saveMany(listItems);
      }

      // 5. Clear conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.delete(conversationId);
      }

      // 6. Delete the confirmation message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 7. Generate daily report
      if (this.#generateDailyReport) {
        await this.#generateDailyReport.execute({
          userId,
          conversationId,
        });
      } else {
        // Simple confirmation
        const itemCount = nutriLog.items?.length || 0;
        const totalCals = nutriLog.items?.reduce((sum, i) => sum + (i.calories || 0), 0) || 0;
        await this.#messagingGateway.sendMessage(
          conversationId,
          `✅ Logged ${itemCount} item${itemCount !== 1 ? 's' : ''} (${totalCals} cal)`,
          {}
        );
      }

      this.#logger.info('acceptLog.complete', { 
        conversationId, 
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      });

      return {
        success: true,
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      };
    } catch (error) {
      this.#logger.error('acceptLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default AcceptFoodLog;
