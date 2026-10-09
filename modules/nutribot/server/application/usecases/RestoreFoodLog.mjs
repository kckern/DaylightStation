/**
 * Restore Food Log Use Case
 * @module nutribot/usecases/RestoreFoodLog
 *
 * The reverse of an Undo (DiscardFoodLog): brings a discarded log's rows back
 * from the ledger's tombstones and marks the log accepted again. Backs the
 * ↩️ Restore button on a "Removed from food log" receipt, so a mis-tapped
 * Undo costs one tap, not a meal.
 */
export class RestoreFoodLog {
  #nutriListStore;
  #foodLogStore;
  #receipts;
  #logger;

  constructor(deps) {
    if (!deps.nutriListStore) throw new Error('nutriListStore is required');
    this.#nutriListStore = deps.nutriListStore;
    this.#foodLogStore = deps.foodLogStore || null;
    this.#receipts = deps.receipts || (() => null);
    this.#logger = deps.logger || console;
  }

  /**
   * @param {{userId: string, conversationId: string, logUuid: string, responseContext?: Object}} input
   * @returns {Promise<{restored: number, dates: string[]}>} `restored` 0 = nothing to restore
   */
  async execute({ userId, conversationId, logUuid, responseContext }) {
    const result = await this.#nutriListStore.restoreByLogId(userId, logUuid);
    const restored = result.items?.length || 0;
    if (!restored) {
      this.#logger.info?.('restoreLog.nothing', { conversationId, logUuid });
      await responseContext?.sendMessage?.('Nothing to restore — that entry is already back, or no longer available.', {});
      return { restored: 0, dates: [] };
    }
    try {
      const log = await this.#foodLogStore?.findByUuid?.(logUuid, userId);
      if (log && log.status === 'deleted') await this.#foodLogStore.save(log.with({ status: 'accepted' }, new Date()));
    } catch (error) {
      // The ledger rows are what count; a stale capture status is cosmetic.
      this.#logger.warn?.('restoreLog.statusFailed', { logUuid, error: error.message });
    }
    await this.#receipts()?.refresh(userId, logUuid);
    this.#logger.info?.('restoreLog.done', { conversationId, logUuid, restored, dates: result.affectedDates });
    return { restored, dates: result.affectedDates || [] };
  }
}

export default RestoreFoodLog;
