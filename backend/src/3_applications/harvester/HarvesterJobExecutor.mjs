/**
 * HarvesterJobExecutor - Scheduler-compatible job execution for harvesters
 *
 * Provides an adapter between the scheduler's job execution pattern and
 * HarvesterService. This allows harvest jobs to be scheduled and executed
 * through the unified scheduler while using HarvesterService for the actual
 * harvesting logic.
 *
 * The scheduler expects modules to export a default function that takes
 * (logger, executionId). This executor creates compatible handlers that
 * delegate to HarvesterService.
 *
 * @module 3_applications/harvester/HarvesterJobExecutor
 */

export class HarvesterJobExecutor {
  /** @type {import('./HarvesterService.mjs').HarvesterService} */
  #harvesterService;

  /** @type {Object} */
  #configService;

  /** @type {Object} */
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {import('./HarvesterService.mjs').HarvesterService} deps.harvesterService - HarvesterService instance
   * @param {Object} deps.configService - ConfigService for user resolution
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ harvesterService, configService, logger }) {
    if (!harvesterService) {
      throw new Error('HarvesterJobExecutor requires harvesterService');
    }
    if (!configService) {
      throw new Error('HarvesterJobExecutor requires configService');
    }
    this.#harvesterService = harvesterService;
    this.#configService = configService;
    this.#logger = logger || console;
  }

  /**
   * Execute a harvest operation for a given serviceId
   *
   * This method is the core execution logic. It resolves the username,
   * executes the harvest, and logs the operation with execution context.
   *
   * @param {string} serviceId - The harvester service ID (e.g., 'strava', 'lastfm')
   * @param {Object} [options] - Harvest options
   * @param {string} [options.username] - Override username (resolved from config if not provided)
   * @param {Object} [context] - Execution context
   * @param {Object} [context.logger] - Scoped logger for this execution
   * @param {string} [context.executionId] - Unique execution identifier
   * @returns {Promise<Object>} Result from the harvester
   */
  async execute(serviceId, options = {}, context = {}) {
    const { logger: scopedLogger, executionId } = context;
    const log = scopedLogger || this.#logger;

    // Resolve username: use provided, or head of household from config
    const username = options.username || this.#configService?.getHeadOfHousehold?.();

    log.info?.('harvester.executor.start', {
      serviceId,
      executionId,
      username: username || '(default)',
    });

    try {
      const result = await this.#harvesterService.harvest(serviceId, username, options);

      log.info?.('harvester.executor.complete', {
        serviceId,
        executionId,
        status: result?.status,
        count: result?.count,
      });

      return result;
    } catch (error) {
      log.error?.('harvester.executor.error', {
        serviceId,
        executionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a scheduler-compatible handler function for a serviceId
   *
   * The returned function matches the scheduler's expected signature:
   * async (logger, executionId) => void
   *
   * This allows harvest jobs to be registered with the scheduler while
   * delegating execution to HarvesterService.
   *
   * @param {string} serviceId - The harvester service ID
   * @param {Object} [options] - Default options to pass to each execution
   * @returns {Function} Async handler function (logger, executionId) => Promise<void>
   */
  createHandler(serviceId, options = {}) {
    return async (logger, executionId) => {
      await this.execute(serviceId, options, { logger, executionId });
    };
  }

  /**
   * Check if this executor can handle a given serviceId
   *
   * @param {string} serviceId - The harvester service ID to check
   * @returns {boolean} True if the harvester is registered
   */
  canHandle(serviceId) {
    return this.#harvesterService.has(serviceId);
  }

  /**
   * Get a list of all serviceIds this executor can handle
   *
   * @returns {string[]} Array of registered service IDs
   */
  getHandleableServices() {
    return this.#harvesterService.listHarvesters().map(h => h.serviceId);
  }
}

export default HarvesterJobExecutor;
