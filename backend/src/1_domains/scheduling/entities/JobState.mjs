/**
 * JobState Entity - Represents the runtime state of a job
 */
export class JobState {
  constructor({
    jobId,
    lastRun = null,
    nextRun = null,
    status = null,
    durationMs = 0,
    error = null
  }) {
    this.jobId = jobId;
    this.lastRun = lastRun;
    this.nextRun = nextRun;
    this.status = status;
    this.durationMs = durationMs;
    this.error = error;
  }

  /**
   * Update state after execution
   */
  updateAfterExecution(execution, nextRun) {
    this.lastRun = execution.endTime || execution.startTime;
    this.nextRun = nextRun;
    this.status = execution.status;
    this.durationMs = execution.durationMs;
    this.error = execution.error;
    return this;
  }

  /**
   * Calculate seconds until next run
   */
  secondsUntilNextRun(now = new Date()) {
    if (!this.nextRun) return null;
    const nextRunDate = new Date(this.nextRun);
    return Math.floor((nextRunDate - now) / 1000);
  }

  /**
   * Check if job needs to run
   */
  needsToRun(now = new Date()) {
    if (!this.nextRun) return true; // Never run, needs initialization
    const secondsUntil = this.secondsUntilNextRun(now);
    return secondsUntil !== null && secondsUntil <= 0;
  }

  /**
   * Convert to plain object for persistence
   */
  toJSON() {
    return {
      last_run: this.lastRun,
      nextRun: this.nextRun,
      status: this.status,
      duration_ms: this.durationMs,
      error: this.error
    };
  }

  /**
   * Create from persisted state
   */
  static fromObject(jobId, obj) {
    return new JobState({
      jobId,
      lastRun: obj?.last_run || null,
      nextRun: obj?.nextRun || null,
      status: obj?.status || null,
      durationMs: obj?.duration_ms || 0,
      error: obj?.error || null
    });
  }
}

export default JobState;
