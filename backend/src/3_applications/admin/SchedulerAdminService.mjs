/**
 * SchedulerAdminService - Application service for the admin cron-job editor.
 *
 * Owns the jobs.yml read/write, runtime-state merge, id rules, and ordered job
 * construction that the admin scheduler router used to inline. The router becomes
 * a thin HTTP shell that extracts params, calls a method, and shapes the response.
 * Error cases throw typed errors that the router's P1.3 string error-middleware
 * maps to HTTP status:
 *   ValidationError → 400 (missing/invalid fields)
 *   NotFoundError   → 404 (job not found)
 *   ConflictError   → 409 (duplicate id)
 *
 * Data sources (relative to data root):
 * - system/config/jobs.yml          -- job definitions
 * - system/state/cron-runtime.yml   -- runtime state map (jobId → state)
 *
 * Manual "run now" is delegated to the injected SchedulerOrchestrator
 * (`triggerJob`) when available — the real scheduler execution path used by the
 * scheduling loop. When no orchestrator is wired, `runJob` throws a 501-mapped
 * error rather than faking a 202.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  ValidationError,
  NotFoundError,
  ConflictError
} from '#system/utils/errors/index.mjs';

const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true };

export class SchedulerAdminService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for data directory paths
   * @param {Object} [deps.schedulerOrchestrator] - SchedulerOrchestrator for manual runs.
   *   When present, `runJob` calls its `triggerJob(jobId, now)`. When absent, `runJob`
   *   throws a NOT_IMPLEMENTED error (mapped to 501) instead of a fake 202.
   * @param {Object} [deps.logger=console] - Logger instance
   */
  constructor({ configService, schedulerOrchestrator = null, logger = console }) {
    if (!configService) {
      throw new Error('SchedulerAdminService requires a configService dependency');
    }
    this.configService = configService;
    this.schedulerOrchestrator = schedulerOrchestrator;
    this.logger = logger;
  }

  /** Get the resolved data root directory */
  #getDataRoot() {
    return path.resolve(this.configService.getDataDir());
  }

  /** Read the jobs array from system/config/jobs.yml */
  #readJobsFile() {
    const absPath = path.join(this.#getDataRoot(), 'system/config/jobs.yml');
    if (!fs.existsSync(absPath)) return [];
    const raw = fs.readFileSync(absPath, 'utf8');
    return yaml.load(raw) || [];
  }

  /** Write the jobs array to system/config/jobs.yml */
  #writeJobsFile(jobs) {
    const absPath = path.join(this.#getDataRoot(), 'system/config/jobs.yml');
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const content = yaml.dump(jobs, YAML_DUMP_OPTS);
    fs.writeFileSync(absPath, content, 'utf8');
  }

  /** Read the runtime state map from system/state/cron-runtime.yml */
  #readRuntimeState() {
    const absPath = path.join(this.#getDataRoot(), 'system/state/cron-runtime.yml');
    if (!fs.existsSync(absPath)) return {};
    const raw = fs.readFileSync(absPath, 'utf8');
    return yaml.load(raw) || {};
  }

  /**
   * List all jobs merged with their runtime state.
   * @returns {{ jobs: Array<Object> }}
   */
  listJobs() {
    const jobs = this.#readJobsFile();
    const runtime = this.#readRuntimeState();
    const merged = jobs.map(job => ({
      ...job,
      runtime: runtime[job.id] || null,
    }));
    this.logger.info?.('admin.scheduler.jobs.listed', { count: merged.length });
    return { jobs: merged };
  }

  /**
   * Create a new job.
   * @param {Object} body
   * @returns {{ job: Object }}
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
    return { job: newJob };
  }

  /**
   * Get a single job merged with runtime state.
   * @param {string} jobId
   * @returns {{ job: Object }}
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
    return { job: merged };
  }

  /**
   * Update job fields (id cannot change).
   * @param {string} jobId
   * @param {Object} body
   * @returns {{ job: Object }}
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
    return { job: jobs[index] };
  }

  /**
   * Remove a job.
   * @param {string} jobId
   * @returns {{ id: string }}
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
    return { id: jobId };
  }

  /**
   * Trigger immediate execution of a job via the real scheduler orchestrator.
   * @param {string} jobId
   * @returns {Promise<{ id: string, executionId: string, execution: Object }>}
   * @throws {NotFoundError} job not defined in jobs.yml
   * @throws {ValidationError} NOT_IMPLEMENTED (mapped to 501) when no orchestrator wired
   */
  async runJob(jobId) {
    // Confirm the job exists in the editor's own source of truth first, so a
    // typo yields a clean 404 rather than an orchestrator-shaped error.
    const jobs = this.#readJobsFile();
    if (!jobs.some(j => j.id === jobId)) {
      throw new NotFoundError(`Job "${jobId}" not found`);
    }

    if (!this.schedulerOrchestrator?.triggerJob) {
      // Honest signal: no runnable scheduler wired in this process (e.g. dev
      // without the orchestrator). 501 Not Implemented, never a fake 202.
      // The string error-middleware maps by explicit `statusCode`.
      const err = new Error('Manual job execution is not available in this environment');
      err.name = 'NotImplementedError';
      err.statusCode = 501;
      err.code = 'NOT_IMPLEMENTED';
      throw err;
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
