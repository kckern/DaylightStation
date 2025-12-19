/**
 * Confirm All Pending Use Case
 * @module nutribot/application/usecases/ConfirmAllPending
 * 
 * Confirms all pending food logs at once.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Confirm all pending use case
 */
export class ConfirmAllPending {
  #messagingGateway;
  #nutriLogRepository;
  #nutriListRepository;
  #generateDailyReport;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.nutriListRepository) throw new Error('nutriListRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#nutriListRepository = deps.nutriListRepository;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId } = input;

    this.#logger.debug('command.confirmAll', { userId });

    try {
      // 1. Load all pending logs
      const pendingLogs = await this.#nutriLogRepository.findPending(userId);

      if (pendingLogs.length === 0) {
        return { success: true, confirmed: 0 };
      }

      // 2. Accept each log
      const confirmedDates = new Set();
      for (const log of pendingLogs) {
        const acceptedLog = log.accept();
        await this.#nutriLogRepository.save(acceptedLog);
        await this.#nutriListRepository.syncFromLog(acceptedLog);
        
        if (acceptedLog.meal?.date) {
          confirmedDates.add(acceptedLog.meal.date);
        }
      }

      // 3. Send confirmation
      const itemCount = pendingLogs.reduce((sum, log) => sum + log.itemCount, 0);
      await this.#messagingGateway.sendMessage(
        conversationId,
        `✅ Confirmed ${pendingLogs.length} log(s) with ${itemCount} item(s)`,
        {}
      );

      // 4. Regenerate reports for affected dates
      if (this.#generateDailyReport) {
        for (const date of confirmedDates) {
          await this.#generateDailyReport.execute({
            userId,
            conversationId,
            date,
            forceRegenerate: true,
          });
        }
      }

      this.#logger.info('command.confirmAll.done', { userId, logCount: pendingLogs.length, itemCount });

      return { success: true, confirmed: pendingLogs.length, itemCount };
    } catch (error) {
      this.#logger.error('command.confirmAll.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ConfirmAllPending;
