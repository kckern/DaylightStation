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

export class SchedulerService {
  constructor({
    jobStore,
    stateStore,
    timezone = 'America/Los_Angeles',
    moduleBasePath = null,
    logger = console
  }) {
    this.jobStore = jobStore;
    this.stateStore = stateStore;
    this.timezone = timezone;
    this.moduleBasePath = moduleBasePath;
    this.logger = logger;
    this.runningJobs = new Map();
  }

  /**
   * Resolve a module path from jobs.yml to an absolute path.
   * Module paths in jobs.yml are relative to the legacy cron router location.
   * @param {string} modulePath - Path from job config (e.g., "../lib/weather.mjs")
   * @returns {string} Absolute path or file URL for dynamic import
   */
  resolveModulePath(modulePath) {
    if (!this.moduleBasePath) {
      // No base path configured - use as-is (will likely fail)
      this.logger.warn?.('scheduler.module.no_base_path', {
        modulePath,
        message: 'moduleBasePath not configured, using path as-is'
      });
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
   * @param {Date} fromDate
   * @returns {Date}
   */
  computeNextRun(job, fromDate = new Date()) {
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
      this.logger.error?.('scheduler.computeNextRun.error', {
        jobId: job.id,
        schedule: job.schedule,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Format date for persistence (YYYY-MM-DD HH:mm:ss in timezone)
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
      hour12: false
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
   */
  async initializeStates(jobsWithState, now = new Date()) {
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
   * @returns {Promise<Array<{job: Job, state: JobState}>>}
   */
  async getJobsDueToRun(now = new Date()) {
    const jobsWithState = await this.loadJobsWithState();
    const states = new Map(jobsWithState.map(j => [j.job.id, j.state]));

    const due = [];
    for (const { job, state } of jobsWithState) {
      if (!job.enabled) continue;
      if (!state.needsToRun(now)) continue;

      const deps = this.checkDependencies(job, states);
      if (!deps.satisfied) {
        this.logger.warn?.('scheduler.job.dependencies_unmet', {
          jobId: job.id,
          unmet: deps.unmet
        });
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
   * @returns {Promise<JobExecution>}
   */
  async executeJob(job, executionId, manual = false) {
    const execution = JobExecution.create(job.id, executionId, manual);

    // Check if already running
    if (this.runningJobs.has(job.id)) {
      this.logger.warn?.('scheduler.job.already_running', { jobId: job.id });
      execution.fail(new Error('Job already running'));
      return execution;
    }

    this.runningJobs.set(job.id, executionId);
    execution.start();

    const scopedLogger = this.logger.child?.({ jobId: executionId, job: job.id }) || this.logger;

    try {
      // Resolve and import the job module
      const resolvedPath = this.resolveModulePath(job.module);
      const module = await import(resolvedPath);
      const handler = module.default;

      if (typeof handler !== 'function') {
        throw new Error(`Job module ${job.module} (resolved: ${resolvedPath}) does not export a default function`);
      }

      // Execute with timeout
      const promise = handler.length >= 2
        ? handler(scopedLogger, executionId)
        : handler.length === 1
          ? handler(executionId)
          : handler(scopedLogger, executionId);

      await Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
        )
      ]);

      execution.succeed();
      this.logger.info?.('scheduler.job.success', {
        jobId: job.id,
        executionId,
        durationMs: execution.durationMs
      });
    } catch (err) {
      if (err.message?.includes('timeout')) {
        execution.timeout();
      } else {
        execution.fail(err);
      }
      this.logger.error?.('scheduler.job.failed', {
        jobId: job.id,
        executionId,
        error: err.message,
        status: execution.status
      });
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
   * @returns {Promise<JobExecution>}
   */
  async runJob(job, state, manual = false) {
    const executionId = this.generateExecutionId();
    this.logger.info?.('scheduler.job.started', { jobId: job.id, executionId, manual });

    const execution = await this.executeJob(job, executionId, manual);

    // Compute next run time
    const now = new Date();
    const nextRun = this.computeNextRun(job, now);

    // Update state
    state.updateAfterExecution(execution, this.formatDate(nextRun));
    await this.stateStore.saveState(job.id, state);

    return execution;
  }

  /**
   * Run all jobs that are due
   * @returns {Promise<JobExecution[]>}
   */
  async runDueJobs() {
    const dueJobs = await this.getJobsDueToRun();

    if (dueJobs.length === 0) {
      return [];
    }

    const executions = [];
    for (const { job, state } of dueJobs) {
      const execution = await this.runJob(job, state, false);
      executions.push(execution);
    }

    // Backup state after batch
    await this.stateStore.backup();

    return executions;
  }

  /**
   * Manually trigger a specific job
   * @param {string} jobId
   * @returns {Promise<{execution: JobExecution, executionId: string}>}
   */
  async triggerJob(jobId) {
    const job = await this.jobStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const states = await this.stateStore.loadStates();
    const state = states.get(jobId) || new JobState({ jobId });

    const execution = await this.runJob(job, state, true);
    return { execution, executionId: execution.executionId };
  }

  /**
   * Get status of all jobs
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const jobsWithState = await this.loadJobsWithState();
    const now = new Date();

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
      timestamp: new Date().toISOString(),
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
