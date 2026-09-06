/**
 * Accept Food Log Use Case
 * @module nutribot/usecases/AcceptFoodLog
 *
 * Confirms a pending food log and adds items to daily list.
 */

import { deriveLogDate } from '../lib/deriveLogDate.mjs';
import { serializeFoodItem, serializeNutriLog } from '../nutriLogRecords.mjs';

/**
 * Accept food log use case
 */
export class AcceptFoodLog {
  #receipts;
  #messagingGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #generateDailyReport;
  #agentOrchestrator;
  #config;
  #logger;
  #pause;
  #reviewService;

  constructor(deps) {
    this.#receipts = deps.receipts || (() => null);
    this.#reviewService = deps.reviewService;
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#agentOrchestrator = deps.agentOrchestrator || null;
    this.#config = deps.config || null;
    this.#logger = deps.logger || console;
    this.#pause = deps.pause || (async () => {});
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
   * @param {boolean} [input.autoReport=true] - Generate the daily report when no pending logs
   *   remain. The auto-commit seam passes `false`: with the pending gate retired, `findPending`
   *   is essentially always empty, so this would render an image, send messages and kick the
   *   coaching orchestrator after EVERY capture — inline, inside the capture request.
   */
  async execute(input) {
    if (this.#reviewService) {
      const result = input.provisional ? await this.#reviewService.capture(input)
        : await this.#reviewService.execute({ ...input, action: "confirm" });
      await this.#receipts()?.refresh(input.userId, input.logUuid);
      return result;
    }
    const { userId, conversationId, logUuid, messageId, responseContext } = input;
    const autoReport = input.autoReport !== false;

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
        const timezone = this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
        const logDate = deriveLogDate(
          serializeNutriLog(nutriLog),
          timezone,
        );

        this.#logger.debug?.('acceptLog.savingToNutrilist', { logUuid, logDate });

        const listItems = nutriLog.items.map(item => ({
          ...serializeFoodItem(item),
          userId,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
          // Mirrors YamlNutriListDatastore.syncFromLog's stamping — this path
          // (AcceptFoodLog -> nutriListStore.saveMany) is a separate write
          // from syncFromLog and was dropping meal.time, landing rows as
          // mealTime:null (UNGROUPED) instead of their bucket.
          mealTime: nutriLog.meal?.time ?? null,
        }));
        await this.#nutriListStore.saveMany(listItems);
      }

      // 5. Clear revision state if any
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.clear(conversationId);
      }

      await this.#receipts()?.refresh(userId, logUuid);

      this.#logger.info?.('acceptLog.complete', {
        conversationId,
        logUuid,
        itemCount: nutriLog.items?.length || 0,
      });

      // 7. If no pending logs remain, auto-generate today's report
      if (!autoReport) {
        this.#logger.debug?.('acceptLog.autoreport.suppressed', { userId, logUuid });
      } else if (this.#foodLogStore?.findPending && this.#generateDailyReport?.execute) {
        try {
          const pending = await this.#foodLogStore.findPending(userId);
          this.#logger.debug?.('acceptLog.autoreport.pendingCheck', { userId, pendingCount: pending.length });
          if (pending.length === 0) {
            await this.#pause(300);
            const timezone = this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
            let reportDate;
            try {
              reportDate = deriveLogDate(
                serializeNutriLog(nutriLog),
                timezone,
              );
            } catch {
              reportDate = undefined;
            }
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: reportDate,
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
