/**
 * MediaJobExecutor - Scheduler-compatible job execution for media services
 *
 * Provides an adapter between the scheduler's job execution pattern and
 * media services (YouTube downloads, etc.). Similar to HarvesterJobExecutor
 * but for media operations.
 *
 * @module applications/media/MediaJobExecutor
 */

import { ValidationError } from '#system/utils/errors/index.mjs';
import { ServiceNotFoundError } from '../common/errors/index.mjs';

export class MediaJobExecutor {
  /** @type {Map<string, Function>} */
  #handlers = new Map();

  /** @type {Object} */
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ logger } = {}) {
    this.#logger = logger || console;
  }

  /**
   * Register a job handler
   *
   * @param {string} jobId - Job ID (e.g., 'youtube')
   * @param {Function} handler - Async handler (logger, executionId) => Promise<void>
   */
  register(jobId, handler) {
    if (typeof handler !== 'function') {
      throw new ValidationError(`Handler for ${jobId} must be a function`, {
        field: 'handler',
        jobId
      });
    }
    this.#handlers.set(jobId, handler);
    this.#logger.debug?.('mediaExecutor.registered', { jobId });
  }

  /**
   * Check if this executor can handle a given jobId
   *
   * @param {string} jobId - The job ID to check
   * @returns {boolean}
   */
  canHandle(jobId) {
    return this.#handlers.has(jobId);
  }

  /**
   * Execute a job
   *
   * @param {string} jobId - Job ID
   * @param {Object} [options] - Job options (unused, for interface compatibility)
   * @param {Object} [context] - Execution context
   * @param {Object} [context.logger] - Scoped logger
   * @param {string} [context.executionId] - Execution identifier
   * @returns {Promise<Object>} Job result
   */
  async execute(jobId, options = {}, context = {}) {
    const { logger: scopedLogger, executionId } = context;
    const log = scopedLogger || this.#logger;

    const handler = this.#handlers.get(jobId);
    if (!handler) {
      throw new ServiceNotFoundError('MediaJobHandler', jobId);
    }

    log.info?.('mediaExecutor.start', { jobId, executionId });

    try {
      const result = await handler(log, executionId);

      log.info?.('mediaExecutor.complete', { jobId, executionId });

      return result;
    } catch (error) {
      log.error?.('mediaExecutor.error', { jobId, executionId, error: error.message });
      throw error;
    }
  }

  /**
   * Get list of registered job IDs
   *
   * @returns {string[]}
   */
  getRegisteredJobs() {
    return Array.from(this.#handlers.keys());
  }
}

export default MediaJobExecutor;
