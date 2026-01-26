/**
 * Confirm All Pending Use Case
 * @module nutribot/usecases/ConfirmAllPending
 *
 * Confirms all pending food logs for a user.
 */

/**
 * Confirm all pending logs use case
 */
export class ConfirmAllPending {
  #foodLogStore;
  #nutriListStore;
  #logger;
  #generateDailyReport;
  #config;

  constructor(deps) {
    if (!deps.foodLogStore) throw new Error('foodLogStore is required');
    if (!deps.nutriListStore) throw new Error('nutriListStore is required');

    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   */
  async execute(input) {
    const { userId, conversationId } = input;

    this.#logger.debug?.('confirmAllPending.start', { userId, conversationId });

    try {
      // 1. Get all pending logs
      const pendingLogs = await this.#foodLogStore.findPending(userId);

      if (pendingLogs.length === 0) {
        this.#logger.info?.('confirmAllPending.noPending', { userId });
        return {
          success: true,
          confirmedCount: 0,
        };
      }

      // 2. Accept each pending log
      let confirmedCount = 0;
      const now = new Date();
      for (const log of pendingLogs) {
        try {
          const acceptedLog = log.accept(now);
          await this.#foodLogStore.save(acceptedLog);

          // Sync to nutrilist
          if (this.#nutriListStore?.syncFromLog) {
            await this.#nutriListStore.syncFromLog(acceptedLog);
          }

          confirmedCount++;
        } catch (e) {
          this.#logger.warn?.('confirmAllPending.logFailed', { logId: log.id, error: e.message });
        }
      }

      this.#logger.info?.('confirmAllPending.complete', { userId, confirmedCount });

      return {
        success: true,
        confirmedCount,
      };
    } catch (error) {
      this.#logger.error?.('confirmAllPending.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ConfirmAllPending;
