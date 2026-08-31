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

import { JobState } from '#domains/scheduling/entities/JobState.mjs';
import { JobExecution } from '#domains/scheduling/entities/JobExecution.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export class SchedulerOrchestrator {
  constructor({
    schedulerService,
    timestampCodec,
    newExecutionId,
    scheduler,
    jobStore,
    stateStore,
    moduleLoader = null,
    harvesterExecutor = null,
    applicationExecutor = null,
    mediaExecutor = null,
    newsReporterExecutor = null,
    schoolExecutor = null
  }) {
    this.schedulerService = schedulerService;
    if (!timestampCodec || typeof timestampCodec.format !== 'function') throw new Error('SchedulerOrchestrator requires timestampCodec');
    if (typeof newExecutionId !== 'function') throw new Error('SchedulerOrchestrator requires newExecutionId');
    if (!scheduler?.withDeadline) throw new Error('SchedulerOrchestrator requires scheduler');
    this.timestampCodec = timestampCodec;
    this.newExecutionId = newExecutionId;
    this.scheduler = scheduler;
    this.jobStore = jobStore;
    this.stateStore = stateStore;
    this.moduleLoader = moduleLoader || {
      resolve: (moduleRef) => moduleRef,
      load: (moduleRef) => import(moduleRef),
    };
    this.harvesterExecutor = harvesterExecutor;
    this.applicationExecutor = applicationExecutor;
    this.mediaExecutor = mediaExecutor;
    this.newsReporterExecutor = newsReporterExecutor;
    this.schoolExecutor = schoolExecutor;
    this.runningJobs = new Map();
  }

  /**
   * Resolve a legacy module reference through the injected loader.
   * Only used for legacy jobs without executors (fitsync, archive-rotation, media-memory-validator).
   * @param {string} modulePath - Path from job config (e.g., "../lib/fitsync.mjs")
   * @returns {string} Absolute path or file URL for dynamic import
   */
  resolveModulePath(modulePath) {
    return this.moduleLoader.resolve(modulePath);
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
        state.nextRun = this.timestampCodec.format(nextRun);
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
      // Check newsreporter executor FIRST. Reporter jobs have no `module`, so if
      // they fell through to the legacy dynamic-import branch they would throw
      // INVALID_MODULE.
      if (this.newsReporterExecutor?.canHandle(job.id)) {
        await this.#runWithinDeadline(this.newsReporterExecutor.execute(job.id, job.options || {}, { executionId }), job);

        execution.succeed(timestamp);
      } else if (this.harvesterExecutor?.canHandle(job.id)) {
        await this.#runWithinDeadline(this.harvesterExecutor.execute(job.id, job.options || {}, { executionId }), job);

        execution.succeed(timestamp);
      } else if (this.applicationExecutor?.canHandle(job.id)) {
        await this.#runWithinDeadline(this.applicationExecutor.execute(job.id, job.options || {}, { executionId }), job);

        execution.succeed(timestamp);
      } else if (this.schoolExecutor?.canHandle(job.id)) {
        // School housekeeping (the stale-session sweep). Its own slot rather
        // than a registration on `mediaExecutor`: that registry is generic
        // enough to have accepted it, and naming a school job "media" is the
        // kind of small lie that makes the next person hunt.
        await this.#runWithinDeadline(this.schoolExecutor.execute(job.id, job.options || {}, { executionId }), job);

        execution.succeed(timestamp);
      } else if (this.mediaExecutor?.canHandle(job.id)) {
        // Check if media executor can handle this job (youtube, etc.)
        await this.#runWithinDeadline(this.mediaExecutor.execute(job.id, job.options || {}, { executionId }), job);

        execution.succeed(timestamp);
      } else {
        // Fall back to dynamic module import (legacy)
        const resolvedPath = this.resolveModulePath(job.module);
        const module = await this.moduleLoader.load(job.module);
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

        await this.#runWithinDeadline(promise, job);

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

  #runWithinDeadline(work, job) {
    return this.scheduler.withDeadline(work, {
      milliseconds: job.timeout,
      errorFactory: () => new Error(`Job timeout after ${job.timeout}ms`),
    });
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
    const executionId = this.newExecutionId();
    const timestamp = this.timestampCodec.format(now);

    const execution = await this.executeJob(job, executionId, manual, timestamp);

    // Compute next run time
    const nextRun = this.schedulerService.computeNextRun(job, now);

    // Update state
    state.updateAfterExecution(execution, this.timestampCodec.format(nextRun));
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

  /** Allocate the acknowledgement id used by legacy bucket endpoints. */
  createExecutionId() {
    return this.newExecutionId();
  }

  /** Run every configured job assigned to a legacy scheduling bucket. */
  async runBucket(bucketName) {
    const jobs = await this.jobStore.loadJobs();
    const bucketJobs = jobs.filter(job => job.bucket === bucketName);
    const now = new Date();
    const executions = [];
    for (const job of bucketJobs) {
      const states = await this.stateStore.loadStates();
      // Preserve the legacy bucket endpoint's fallback exactly. runJob expects
      // a JobState, so a missing stored state is surfaced and logged by the
      // delivery adapter after its acknowledgement has already been sent.
      const state = states.get(job.id) || { jobId: job.id };
      executions.push(await this.runJob(job, state, true, now));
    }
    return executions;
  }

  /** List configured jobs without exposing the datastore to delivery code. */
  listJobs() {
    return this.jobStore.loadJobs();
  }

  /** Snapshot currently running job/execution pairs. */
  listRunningJobs() {
    return Array.from(this.runningJobs.entries()).map(([jobId, executionId]) => ({ jobId, executionId }));
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
      timestamp: this.timestampCodec.format(now),
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
