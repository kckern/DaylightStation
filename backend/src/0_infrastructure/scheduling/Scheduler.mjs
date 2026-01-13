/**
 * Scheduler - Infrastructure component that runs the scheduling loop
 *
 * This runs the continuous scheduler that checks for and executes due jobs.
 * Only runs in production (Docker) unless ENABLE_CRON=true.
 */

import { existsSync } from 'fs';

export class Scheduler {
  constructor({
    schedulerService,
    intervalMs = 5000,
    logger = console
  }) {
    this.schedulerService = schedulerService;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.intervalId = null;
    this.running = false;
    this.enabled = false;
  }

  /**
   * Check if scheduler should be enabled
   */
  static shouldEnable() {
    const isDocker = existsSync('/.dockerenv');
    return isDocker || process.env.ENABLE_CRON === 'true';
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.intervalId) {
      this.logger.warn?.('scheduler.already_started');
      return;
    }

    this.enabled = Scheduler.shouldEnable();

    if (!this.enabled) {
      this.logger.info?.('scheduler.disabled', {
        reason: 'Not running in Docker (dev mode). Set ENABLE_CRON=true to override.',
        isDocker: existsSync('/.dockerenv')
      });
      return;
    }

    // Initialize job states
    this.initialize().then(() => {
      this.intervalId = setInterval(() => this.tick(), this.intervalMs);
      this.logger.info?.('scheduler.started', {
        intervalMs: this.intervalMs
      });
    }).catch(err => {
      this.logger.error?.('scheduler.init_failed', { error: err.message });
    });
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info?.('scheduler.stopped');
    }
  }

  /**
   * Initialize job states
   */
  async initialize() {
    try {
      const jobsWithState = await this.schedulerService.loadJobsWithState();
      await this.schedulerService.initializeStates(jobsWithState);
      this.logger.info?.('scheduler.initialized', {
        jobCount: jobsWithState.length
      });
    } catch (err) {
      this.logger.error?.('scheduler.init_error', { error: err.message });
      throw err;
    }
  }

  /**
   * Single tick of the scheduler loop
   */
  async tick() {
    if (this.running) {
      this.logger.debug?.('scheduler.tick_skipped', { reason: 'already running' });
      return;
    }

    this.running = true;

    try {
      const executions = await this.schedulerService.runDueJobs();
      if (executions.length > 0) {
        this.logger.debug?.('scheduler.tick_complete', {
          jobsRun: executions.map(e => e.jobId)
        });
      }
    } catch (err) {
      this.logger.error?.('scheduler.tick_error', { error: err.message });
    } finally {
      this.running = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      active: !!this.intervalId
    };
  }
}

export default Scheduler;
