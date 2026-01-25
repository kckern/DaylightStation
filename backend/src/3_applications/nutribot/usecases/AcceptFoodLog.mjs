/**
 * Accept Food Log Use Case
 * @module nutribot/usecases/AcceptFoodLog
 *
 * Confirms a pending food log and adds items to daily list.
 */

import { formatFoodList, formatDateHeader } from '../../../1_domains/nutrition/entities/formatters.mjs';

/**
 * Accept food log use case
 */
export class AcceptFoodLog {
  #messagingGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #generateDailyReport;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.logUuid
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, logUuid, messageId, responseContext } = input;

    this.#logger.debug?.('acceptLog.start', { conversationId, logUuid, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Load the log
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      if (!nutriLog) {
        this.#logger.warn?.('acceptLog.notFound', { logUuid });
        return { success: false, error: 'Log not found' };
      }

      // 2. Check status
      if (nutriLog.status !== 'pending') {
        this.#logger.warn?.('acceptLog.invalidStatus', { logUuid, status: nutriLog.status });
        return { success: false, error: 'Log already processed' };
      }

      // 3. Update log status to accepted
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateStatus(userId, logUuid, 'accepted');
      }

      // 4. Add items to nutrilist
      if (this.#nutriListStore && nutriLog.items?.length > 0) {
        const now = new Date();
        const fallbackDate = now.toISOString().split('T')[0];
        const logDate = nutriLog.meal?.date || nutriLog.date || fallbackDate;

        this.#logger.debug?.('acceptLog.savingToNutrilist', { logUuid, logDate });

        const listItems = nutriLog.items.map(item => ({
          ...(typeof item.toJSON === 'function' ? item.toJSON() : item),
          userId,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutriListStore.saveMany(listItems);
      }

      // 5. Clear revision state if any
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        if (state) {
          await this.#conversationStateStore.set(conversationId, state.clearFlow());
        }
      }

      // 6. Update message to show accepted status
      if (messageId) {
        try {
          const logDate = nutriLog.meal?.date || nutriLog.date;
          const dateHeader = logDate ? formatDateHeader(logDate).replace('🕒', '✅') : '';
          const foodList = formatFoodList(nutriLog.items || []);

          const acceptedText = `${dateHeader}\n\n${foodList}`;

          await messaging.updateMessage(messageId, {
            text: acceptedText,
            choices: [],
            inline: true,
          });
        } catch (e) {
          this.#logger.warn?.('acceptLog.updateMessageFailed', { error: e.message });
        }
      }

      this.#logger.info?.('acceptLog.complete', {
        conversationId,
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      });

      // 7. If no pending logs remain, auto-generate today's report
      if (this.#foodLogStore?.findPending && this.#generateDailyReport) {
        try {
          const pending = await this.#foodLogStore.findPending(userId);
          this.#logger.debug?.('acceptLog.autoreport.pendingCheck', { userId, pendingCount: pending.length });
          if (pending.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: nutriLog.meal?.date || nutriLog.date,
              responseContext,
            });
          }
        } catch (e) {
          this.#logger.warn?.('acceptLog.autoreport.error', { error: e.message });
        }
      }

      return {
        success: true,
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      };
    } catch (error) {
      this.#logger.error?.('acceptLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default AcceptFoodLog;
