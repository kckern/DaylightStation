/**
 * Executor for scheduled application workflows that already exist in the
 * running composition root. This replaces scheduler imports of deleted
 * `../lib/*.mjs` wrappers without teaching the scheduler about each domain.
 */
export class ApplicationJobExecutor {
  constructor({ handlers = {}, logger = console } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.logger = logger;
    for (const [jobId, handler] of this.handlers) {
      if (typeof handler !== 'function') {
        throw new TypeError(`Scheduled application handler must be a function: ${jobId}`);
      }
    }
  }

  canHandle(jobId) {
    return this.handlers.has(jobId);
  }

  async execute(jobId, options = {}, context = {}) {
    const handler = this.handlers.get(jobId);
    if (!handler) throw new Error(`No scheduled application handler registered for: ${jobId}`);
    this.logger.info?.('scheduler.application.started', { jobId, executionId: context.executionId });
    const result = await handler(options, context);
    this.logger.info?.('scheduler.application.completed', { jobId, executionId: context.executionId });
    return result;
  }
}

export default ApplicationJobExecutor;
