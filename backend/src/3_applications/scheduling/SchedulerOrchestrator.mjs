/**
 * SchedulerOrchestrator - I/O orchestration for scheduled job execution
 *
 * Coordinates:
 * - Loading jobs and state from stores
 * - Executing jobs via executors or dynamic module import
 * - Persisting state after execution
 * - Runtime tracking of running jobs
 *
 * Delegates pure computations (cron parsing, dependency checks,
 * date formatting) to SchedulerService in the domain layer.
 */

import path from 'path';
import { pathToFileURL } from 'url';
import { JobState } from '#domains/scheduling/entities/JobState.mjs';
import { JobExecution } from '#domains/scheduling/entities/JobExecution.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export class SchedulerOrchestrator {
  constructor({
    schedulerService,
    jobStore,
    stateStore,
    moduleBasePath = null,
    harvesterExecutor = null,
    mediaExecutor = null
  }) {
    this.schedulerService = schedulerService;
    this.jobStore = jobStore;
    this.stateStore = stateStore;
    this.moduleBasePath = moduleBasePath;
    this.harvesterExecutor = harvesterExecutor;
    this.mediaExecutor = mediaExecutor;
    this.runningJobs = new Map();
  }

  /**
   * Resolve a module path from jobs.yml to an absolute path.
   * Only used for legacy jobs without executors (fitsync, archive-rotation, media-memory-validator).
   * Module paths are relative to moduleBasePath (typically _legacy/routers/).
   * @param {string} modulePath - Path from job config (e.g., "../lib/fitsync.mjs")
   * @returns {string} Absolute path or file URL for dynamic import
   */
  resolveModulePath(modulePath) {
    if (!this.moduleBasePath) {
      // No base path configured - use as-is (will likely fail)
      return modulePath;
    }

    // Resolve relative path against the configured base
    const absolutePath = path.resolve(this.moduleBasePath, modulePath);

    // Convert to file URL for cross-platform dynamic import compatibility
    return pathToFileURL(absolutePath).href;
  }

  /**
   * Load all jobs with their current states
   * @returns {Promise<Array<{job: import('#domains/scheduling/entities/Job.mjs').Job, state: JobState}>>}
   */
  async loadJobsWithState() {
    const jobs = await this.jobStore.loadJobs();
    const states = await this.stateStore.loadStates();

    return jobs.map(job => ({
      job,
      state: states.get(job.id) || new JobState({ jobId: job.id })
    }));
  }

  /**
   * Initialize job states - compute next run for jobs without one
   * @param {Array<{job: import('#domains/scheduling/entities/Job.mjs').Job, state: JobState}>} jobsWithState
   * @param {Date} now - Current timestamp (required)
   */
  async initializeStates(jobsWithState, now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    for (const { job, state } of jobsWithState) {
      if (!state.nextRun) {
        const nextRun = this.schedulerService.computeNextRun(job, now);
        state.nextRun = this.schedulerService.formatDate(nextRun);
        await this.stateStore.saveState(job.id, state);
      }
    }
  }

  /**
   * Get jobs that need to run now
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<Array<{job: import('#domains/scheduling/entities/Job.mjs').Job, state: JobState}>>}
   */
  async getJobsDueToRun(now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const jobsWithState = await this.loadJobsWithState();
    const states = new Map(jobsWithState.map(j => [j.job.id, j.state]));

    const due = [];
    for (const { job, state } of jobsWithState) {
      if (!job.enabled) continue;
      if (!state.needsToRun(now)) continue;

      const deps = this.schedulerService.checkDependencies(job, states);
      if (!deps.satisfied) {
        // Dependencies unmet - skip this job (caller can log if needed)
        continue;
      }

      due.push({ job, state });
    }

    return due;
  }

  /**
   * Execute a job
   * @param {import('#domains/scheduling/entities/Job.mjs').Job} job
   * @param {string} executionId
   * @param {boolean} manual
   * @param {string} timestamp - Current timestamp string (required)
   * @returns {Promise<JobExecution>}
   */
  async executeJob(job, executionId, manual = false, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const execution = JobExecution.create(job.id, executionId, manual);

    // Check if already running
    if (this.runningJobs.has(job.id)) {
      execution.fail(new Error('Job already running'), timestamp);
      return execution;
    }

    this.runningJobs.set(job.id, executionId);
    execution.start(timestamp);

    try {
      // Check if harvester executor can handle this job
      if (this.harvesterExecutor?.canHandle(job.id)) {
        await Promise.race([
          this.harvesterExecutor.execute(job.id, job.options || {}, { executionId }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
          )
        ]);

        execution.succeed(timestamp);
      } else if (this.mediaExecutor?.canHandle(job.id)) {
        // Check if media executor can handle this job (youtube, etc.)
        await Promise.race([
          this.mediaExecutor.execute(job.id, job.options || {}, { executionId }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
          )
        ]);

        execution.succeed(timestamp);
      } else {
        // Fall back to dynamic module import (legacy)
        const resolvedPath = this.resolveModulePath(job.module);
        const module = await import(resolvedPath);
        const handler = module.default;

        if (typeof handler !== 'function') {
          throw new ValidationError(`Job module ${job.module} (resolved: ${resolvedPath}) does not export a default function`, { code: 'INVALID_MODULE', field: 'module' });
        }

        // Execute with timeout - legacy handlers may expect (logger, executionId) or just (executionId)
        // Provide no-op logger to prevent crashes if legacy handlers call logger methods
        const noopLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, child: () => noopLogger };
        const promise = handler.length >= 2
          ? handler(noopLogger, executionId)
          : handler.length === 1
            ? handler(executionId)
            : handler(noopLogger, executionId);

        await Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
          )
        ]);

        execution.succeed(timestamp);
      }
    } catch (err) {
      if (err.message?.includes('timeout')) {
        execution.timeout(timestamp);
      } else {
        execution.fail(err, timestamp);
      }
    } finally {
      this.runningJobs.delete(job.id);
    }

    return execution;
  }

  /**
   * Run a single job and update its state
   * @param {import('#domains/scheduling/entities/Job.mjs').Job} job
   * @param {JobState} state
   * @param {boolean} manual
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<JobExecution>}
   */
  async runJob(job, state, manual = false, now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const executionId = this.schedulerService.generateExecutionId();
    const timestamp = this.schedulerService.formatDate(now);

    const execution = await this.executeJob(job, executionId, manual, timestamp);

    // Compute next run time
    const nextRun = this.schedulerService.computeNextRun(job, now);

    // Update state
    state.updateAfterExecution(execution, this.schedulerService.formatDate(nextRun));
    await this.stateStore.saveState(job.id, state);

    return execution;
  }

  /**
   * Run all jobs that are due
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<JobExecution[]>}
   */
  async runDueJobs(now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const dueJobs = await this.getJobsDueToRun(now);

    if (dueJobs.length === 0) {
      return [];
    }

    const executions = [];
    for (const { job, state } of dueJobs) {
      const execution = await this.runJob(job, state, false, now);
      executions.push(execution);
    }

    // Backup state after batch
    await this.stateStore.backup();

    return executions;
  }

  /**
   * Manually trigger a specific job
   * @param {string} jobId
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<{execution: JobExecution, executionId: string}>}
   */
  async triggerJob(jobId, now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const job = await this.jobStore.getJob(jobId);
    if (!job) {
      throw new EntityNotFoundError('Job', jobId);
    }

    const states = await this.stateStore.loadStates();
    const state = states.get(jobId) || new JobState({ jobId });

    const execution = await this.runJob(job, state, true, now);
    return { execution, executionId: execution.executionId };
  }

  /**
   * Get status of all jobs
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<Object>}
   */
  async getStatus(now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const jobsWithState = await this.loadJobsWithState();

    const jobs = jobsWithState.map(({ job, state }) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled,
      bucket: job.bucket,
      lastRun: state.lastRun,
      nextRun: state.nextRun,
      status: state.status,
      durationMs: state.durationMs,
      secondsUntil: state.secondsUntilNextRun(now),
      needsToRun: state.needsToRun(now),
      running: this.runningJobs.has(job.id)
    }));

    return {
      status: 'ok',
      timestamp: this.schedulerService.formatDate(now),
      runningCount: this.runningJobs.size,
      jobs
    };
  }

  /**
   * Check if a job is currently running
   */
  isJobRunning(jobId) {
    return this.runningJobs.has(jobId);
  }
}

export default SchedulerOrchestrator;
