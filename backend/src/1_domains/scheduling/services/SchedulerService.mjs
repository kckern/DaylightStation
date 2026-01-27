/**
 * SchedulerService - Core scheduling domain logic
 *
 * Handles:
 * - Computing next run times with cron expressions
 * - Window offset/jitter for load spreading
 * - Dependency checking
 * - Job execution with timeout
 */

import crypto from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';
import { CronExpressionParser } from 'cron-parser';
import { Job } from '../entities/Job.mjs';
import { JobState } from '../entities/JobState.mjs';
import { JobExecution } from '../entities/JobExecution.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

export class SchedulerService {
  constructor({
    jobStore,
    stateStore,
    timezone = 'America/Los_Angeles',
    moduleBasePath = null,
    harvesterExecutor = null,
    mediaExecutor = null
  }) {
    this.jobStore = jobStore;
    this.stateStore = stateStore;
    this.timezone = timezone;
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
   * Generate a short unique execution ID
   */
  generateExecutionId() {
    return crypto.randomUUID().split('-').pop();
  }

  /**
   * Compute MD5 hash for window offset
   */
  md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /**
   * Calculate window offset for jitter (-0.5 to +0.5 of window)
   */
  windowOffset(str) {
    const hash = this.md5(str);
    const numeric = parseInt(hash.replace(/[^0-9]/g, '').slice(-3)) || 0;
    return 0.5 - numeric / 999;
  }

  /**
   * Compute next run time for a job
   * @param {Job} job
   * @param {Date} fromDate - Date to compute from (required)
   * @returns {Date}
   */
  computeNextRun(job, fromDate) {
    if (!fromDate) {
      throw new ValidationError('fromDate timestamp required', { code: 'MISSING_TIMESTAMP', field: 'fromDate' });
    }
    try {
      const interval = CronExpressionParser.parse(job.schedule, {
        currentDate: fromDate,
        tz: this.timezone
      });
      const rawNext = interval.next().toDate();

      // Apply window offset if configured
      if (job.window > 0) {
        const offsetMinutes = Math.round(this.windowOffset(rawNext.toString()) * job.window);
        return new Date(rawNext.getTime() + offsetMinutes * 60 * 1000);
      }

      return rawNext;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Format date for persistence (YYYY-MM-DD HH:mm:ss in timezone)
   * Uses hourCycle: 'h23' to prevent hour 24 bug with hour12: false
   */
  formatDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'  // Use h23 (0-23) instead of hour12: false which can produce hour 24
    }).format(date).replace(',', '');
  }

  /**
   * Parse date string back to Date
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    // Handle ISO format or YYYY-MM-DD HH:mm:ss format
    return new Date(dateStr);
  }

  /**
   * Load all jobs with their current states
   * @returns {Promise<Array<{job: Job, state: JobState}>>}
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
   * @param {Array<{job: Job, state: JobState}>} jobsWithState
   * @param {Date} now - Current timestamp (required)
   */
  async initializeStates(jobsWithState, now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    for (const { job, state } of jobsWithState) {
      if (!state.nextRun) {
        const nextRun = this.computeNextRun(job, now);
        state.nextRun = this.formatDate(nextRun);
        await this.stateStore.saveState(job.id, state);
      }
    }
  }

  /**
   * Check if job dependencies are satisfied
   * @param {Job} job
   * @param {Map<string, JobState>} allStates
   * @returns {{satisfied: boolean, unmet: string[]}}
   */
  checkDependencies(job, allStates) {
    if (!job.hasDependencies()) {
      return { satisfied: true, unmet: [] };
    }

    const unmet = job.dependencies.filter(depId => {
      const depState = allStates.get(depId);
      return !depState || depState.status !== 'success';
    });

    return {
      satisfied: unmet.length === 0,
      unmet
    };
  }

  /**
   * Get jobs that need to run now
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<Array<{job: Job, state: JobState}>>}
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

      const deps = this.checkDependencies(job, states);
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
   * @param {Job} job
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
      execution.fail(new Error('Job already running'));
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
   * @param {Job} job
   * @param {JobState} state
   * @param {boolean} manual
   * @param {Date} now - Current timestamp (required)
   * @returns {Promise<JobExecution>}
   */
  async runJob(job, state, manual = false, now) {
    if (!now) {
      throw new ValidationError('now timestamp required', { code: 'MISSING_TIMESTAMP', field: 'now' });
    }
    const executionId = this.generateExecutionId();
    const timestamp = this.formatDate(now);

    const execution = await this.executeJob(job, executionId, manual, timestamp);

    // Compute next run time
    const nextRun = this.computeNextRun(job, now);

    // Update state
    state.updateAfterExecution(execution, this.formatDate(nextRun));
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
      timestamp: this.formatDate(now),
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

export default SchedulerService;
