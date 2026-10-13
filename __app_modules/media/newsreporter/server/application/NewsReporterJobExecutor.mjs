/**
 * NewsReporterJobExecutor (3_applications) — scheduler bridge for reporters.
 *
 * Mirrors HarvesterJobExecutor: the SchedulerOrchestrator asks `canHandle(jobId)`
 * and, when true, calls `execute(jobId)`. This executor maps a reporter job id
 * to a NewsReporterService.run(). `reporterIdProvider()` returns the live set of
 * enabled reporter ids, re-read each call so reporters added to newsreporter.yml
 * register without a restart.
 *
 * @module 3_applications/newsreporter/NewsReporterJobExecutor
 */

export class NewsReporterJobExecutor {
  #newsReporterService;
  #reporterIdProvider;
  #logger;

  /**
   * @param {{
   *   newsReporterService: { run: (id: string, overrides?: object) => Promise<object> },
   *   reporterIdProvider: () => (Set<string> | Promise<Set<string>>),
   *   logger?: object,
   * }} deps
   */
  constructor({ newsReporterService, reporterIdProvider, logger } = {}) {
    if (!newsReporterService) throw new Error('NewsReporterJobExecutor requires newsReporterService');
    if (typeof reporterIdProvider !== 'function') {
      throw new Error('NewsReporterJobExecutor requires a reporterIdProvider function');
    }
    this.#newsReporterService = newsReporterService;
    this.#reporterIdProvider = reporterIdProvider;
    this.#logger = logger || console;
  }

  /**
   * @param {string} jobId reporter id
   * @returns {boolean} true when this executor owns the job
   */
  canHandle(jobId) {
    const ids = this.#reporterIdProvider();
    return ids instanceof Set ? ids.has(jobId) : false;
  }

  /**
   * Run one reporter via NewsReporterService. Rethrows on failure so the
   * scheduler records the job as failed (engaging retry/missed-run logic).
   *
   * @param {string} jobId reporter id
   * @param {object} [options] passthrough options (currently unused)
   * @param {{ executionId?: string, logger?: object }} [context]
   * @returns {Promise<object>} the NewsReporterService run result
   */
  async execute(jobId, options = {}, context = {}) {
    const { logger: scopedLogger, executionId } = context;
    const log = scopedLogger || this.#logger;

    log.info?.('newsreporter.executor.start', { reporterId: jobId, executionId });

    try {
      const result = await this.#newsReporterService.run(jobId);
      log.info?.('newsreporter.executor.complete', {
        reporterId: jobId,
        executionId,
        status: result?.status,
      });
      return result;
    } catch (error) {
      log.error?.('newsreporter.executor.error', {
        reporterId: jobId,
        executionId,
        error: error?.message || String(error),
      });
      throw error;
    }
  }
}

export default NewsReporterJobExecutor;
