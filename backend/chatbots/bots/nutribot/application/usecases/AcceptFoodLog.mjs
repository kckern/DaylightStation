/**
 * Accept Food Log Use Case
 * @module nutribot/application/usecases/AcceptFoodLog
 * 
 * Confirms a pending food log and adds items to daily list.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

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
      // 1. Load the log (pass conversationId for user resolution)
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid, conversationId);
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
        await this.#nutrilogRepository.updateStatus(logUuid, 'accepted', conversationId);
      }

      // 4. Add items to nutrilist
      if (this.#nutrilistRepository && nutriLog.items?.length > 0) {
        // Use the date from the nutriLog (parsed from user input like "yesterday")
        // Fall back to today (local date) if no date was specified
        const now = new Date();
        const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const logDate = nutriLog.date || fallbackDate;
        
        const listItems = nutriLog.items.map(item => ({
          // FoodItem instances need toJSON() to get plain object
          ...(typeof item.toJSON === 'function' ? item.toJSON() : item),
          userId,
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

      // 6. Update message to show accepted status (remove buttons, replace clock with checkmark)
      if (messageId) {
        try {
          // Build the updated message with checkmark instead of clock
          const { formatFoodList, formatDateHeader } = await import('../../domain/formatters.mjs');
          const logDate = nutriLog.meal?.date || nutriLog.date;
          // Use formatDateHeader but replace the clock emoji with checkmark
          const dateHeader = logDate ? formatDateHeader(logDate).replace('🕒', '✅') : '';
          const foodList = formatFoodList(nutriLog.items || []);
          
          const acceptedText = `${dateHeader}\n\n${foodList}`;
          
          await this.#messagingGateway.updateMessage(conversationId, messageId, {
            text: acceptedText,
            choices: [], // Remove buttons
            inline: true,
          });
        } catch (e) {
          this.#logger.warn('acceptLog.updateMessageFailed', { error: e.message });
        }
      }

      this.#logger.info('acceptLog.complete', { 
        conversationId, 
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      });

      // 7. If no pending logs remain, auto-generate today's report
      if (this.#nutrilogRepository?.findPending && this.#generateDailyReport) {
        try {
          const pending = await this.#nutrilogRepository.findPending(userId);
          if (pending.length === 0) {
            this.#logger.debug('acceptLog.autoreport.start', { userId, conversationId });
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: nutriLog.meal?.date || nutriLog.date,
              forceRegenerate: true,
            });
            this.#logger.debug('acceptLog.autoreport.done', { userId, conversationId });
          }
        } catch (e) {
          this.#logger.warn('acceptLog.autoreport.error', { error: e.message });
        }
      }

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
