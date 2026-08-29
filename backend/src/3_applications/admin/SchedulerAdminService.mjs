/**
 * SchedulerAdminService - Application service for the admin cron-job editor.
 *
 * Owns the jobs.yml read/write, runtime-state merge, id rules, and ordered job
 * construction that the admin scheduler router used to inline. The router becomes
 * a thin HTTP shell that extracts params, calls a method, and shapes the response.
 * Error cases are expressed as transport-neutral semantic categories; the
 * calling adapter decides how to present them.
 *
 * Data sources (relative to data root):
 * - system/config/jobs.yml          -- job definitions
 * - system/state/cron-runtime.yml   -- runtime state map (jobId → state)
 *
 * Manual "run now" is delegated to the injected SchedulerOrchestrator
 * (`triggerJob`) when available — the real scheduler execution path used by the
 * scheduling loop. When no orchestrator is wired, `runJob` reports that the
 * operation is unavailable rather than pretending it was accepted.
 */
import {
  InvalidInputError as ValidationError,
  MissingResourceError as NotFoundError,
  StateConflictError as ConflictError,
  OperationUnavailableError,
} from '#apps/common/errors/SemanticErrors.mjs';

export class SchedulerAdminService {
  #configStore;

  /**
   * @param {Object} deps
   * @param {Object} deps.configStore - Semantic admin configuration store
   * @param {Object} [deps.schedulerOrchestrator] - SchedulerOrchestrator for manual runs.
   *   When present, `runJob` calls its `triggerJob(jobId, now)`. When absent, `runJob`
   *   throws a NOT_IMPLEMENTED error (mapped to 501) instead of a fake 202.
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configStore, schedulerOrchestrator = null, logger = console }) {
    if (!configStore) throw new Error('SchedulerAdminService requires a configStore dependency');
    this.#configStore = configStore;
    this.schedulerOrchestrator = schedulerOrchestrator;
    this.logger = logger;
  }

  /** Read the jobs array from system/config/jobs.yml */
  #readJobsFile() {
    return this.#configStore.readScheduledJobs();
  }

  /** Write the jobs array to system/config/jobs.yml */
  #writeJobsFile(jobs) {
    this.#configStore.writeScheduledJobs(jobs);
  }

  /** Read the runtime state map from system/state/cron-runtime.yml */
  #readRuntimeState() {
    return this.#configStore.readSchedulerRuntime();
  }

  /**
   * List all jobs merged with their runtime state.
   * @returns {Array<Object>}
   */
  listJobs() {
    const jobs = this.#readJobsFile();
    const runtime = this.#readRuntimeState();
    const merged = jobs.map(job => ({
      ...job,
      runtime: runtime[job.id] || null,
    }));
    this.logger.info?.('admin.scheduler.jobs.listed', { count: merged.length });
    return merged;
  }

  /**
   * Create a new job.
   * @param {Object} body
   * @returns {Object}
   * @throws {ValidationError} missing/invalid id/name/schedule
   * @throws {ConflictError} duplicate id
   */
  createJob(body = {}) {
    const { id, name, module, schedule, dependencies, window } = body;

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Field "id" is required and must be a string', { field: 'id' });
    }
    if (/\s/.test(id)) {
      throw new ValidationError('Field "id" must not contain spaces', { field: 'id' });
    }
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Field "name" is required and must be a string', { field: 'name' });
    }
    if (!schedule || typeof schedule !== 'string') {
      throw new ValidationError('Field "schedule" is required and must be a string (cron expression)', { field: 'schedule' });
    }

    const jobs = this.#readJobsFile();

    if (jobs.some(job => job.id === id)) {
      throw new ConflictError(`Job with id "${id}" already exists`);
    }

    // Build the new job object (preserve field ordering from the router)
    const newJob = { id, name };
    if (module !== undefined) newJob.module = module;
    newJob.schedule = schedule;
    if (dependencies !== undefined) newJob.dependencies = dependencies;
    if (window !== undefined) newJob.window = window;

    jobs.push(newJob);
    this.#writeJobsFile(jobs);

    this.logger.info?.('admin.scheduler.job.created', { id, name });
    return newJob;
  }

  /**
   * Get a single job merged with runtime state.
   * @param {string} jobId
   * @returns {Object}
   * @throws {NotFoundError} job not found
   */
  getJob(jobId) {
    const jobs = this.#readJobsFile();
    const job = jobs.find(j => j.id === jobId);

    if (!job) {
      throw new NotFoundError(`Job "${jobId}" not found`);
    }

    const runtime = this.#readRuntimeState();
    const merged = {
      ...job,
      runtime: runtime[jobId] || null,
    };

    this.logger.info?.('admin.scheduler.job.read', { id: jobId });
    return merged;
  }

  /**
   * Update job fields (id cannot change).
   * @param {string} jobId
   * @param {Object} body
   * @returns {Object}
   * @throws {NotFoundError} job not found
   */
  updateJob(jobId, body = {}) {
    const jobs = this.#readJobsFile();
    const index = jobs.findIndex(j => j.id === jobId);

    if (index === -1) {
      throw new NotFoundError(`Job "${jobId}" not found`);
    }

    const { name, module, schedule, dependencies, window } = body;

    if (name !== undefined) jobs[index].name = name;
    if (module !== undefined) jobs[index].module = module;
    if (schedule !== undefined) jobs[index].schedule = schedule;
    if (dependencies !== undefined) jobs[index].dependencies = dependencies;
    if (window !== undefined) jobs[index].window = window;

    this.#writeJobsFile(jobs);

    this.logger.info?.('admin.scheduler.job.updated', { id: jobId });
    return jobs[index];
  }

  /**
   * Remove a job.
   * @param {string} jobId
   * @returns {string} removed job id
   * @throws {NotFoundError} job not found
   */
  deleteJob(jobId) {
    const jobs = this.#readJobsFile();
    const index = jobs.findIndex(j => j.id === jobId);

    if (index === -1) {
      throw new NotFoundError(`Job "${jobId}" not found`);
    }

    jobs.splice(index, 1);
    this.#writeJobsFile(jobs);

    this.logger.info?.('admin.scheduler.job.deleted', { id: jobId });
    return jobId;
  }

  /**
   * Trigger immediate execution of a job via the real scheduler orchestrator.
   * @param {string} jobId
   * @returns {Promise<{ id: string, executionId: string, execution: Object }>}
   * @throws {NotFoundError} job not defined in jobs.yml
   * @throws {OperationUnavailableError} when no orchestrator is wired
   */
  async runJob(jobId) {
    // Confirm the job exists in the editor's own source of truth first, so a
    // typo yields a clean 404 rather than an orchestrator-shaped error.
    const jobs = this.#readJobsFile();
    if (!jobs.some(j => j.id === jobId)) {
      throw new NotFoundError(`Job "${jobId}" not found`);
    }

    if (!this.schedulerOrchestrator?.triggerJob) {
      throw new OperationUnavailableError(
        'Manual job execution is not available in this environment',
        { code: 'NOT_IMPLEMENTED' },
      );
    }

    this.logger.info?.('admin.scheduler.job.run.requested', { id: jobId });
    const { execution, executionId } = await this.schedulerOrchestrator.triggerJob(jobId, new Date());
    this.logger.info?.('admin.scheduler.job.run.completed', {
      id: jobId,
      executionId,
      status: execution?.status,
    });

    return { id: jobId, executionId, execution };
  }
}

export default SchedulerAdminService;
