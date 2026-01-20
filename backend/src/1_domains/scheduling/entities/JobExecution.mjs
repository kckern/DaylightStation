/**
 * JobExecution Entity - Represents a single execution of a job
 */
export class JobExecution {
  constructor({
    jobId,
    executionId,
    startTime = null,
    endTime = null,
    status = 'pending',
    error = null,
    durationMs = 0,
    manual = false
  }) {
    this.jobId = jobId;
    this.executionId = executionId;
    this.startTime = startTime;
    this.endTime = endTime;
    this.status = status; // pending, running, success, failed, timeout
    this.error = error;
    this.durationMs = durationMs;
    this.manual = manual;
  }

  /**
   * Mark execution as started
   */
  start() {
    this.startTime = new Date().toISOString();
    this.status = 'running';
    return this;
  }

  /**
   * Mark execution as successful
   */
  succeed() {
    this.endTime = new Date().toISOString();
    this.status = 'success';
    this.durationMs = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  /**
   * Mark execution as failed
   */
  fail(error) {
    this.endTime = new Date().toISOString();
    this.status = 'failed';
    this.error = error?.message || error;
    this.durationMs = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  /**
   * Mark execution as timed out
   */
  timeout() {
    this.endTime = new Date().toISOString();
    this.status = 'timeout';
    this.error = 'Job execution timed out';
    this.durationMs = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  /**
   * Check if execution is still running
   */
  isRunning() {
    return this.status === 'running';
  }

  /**
   * Check if execution completed successfully
   */
  isSuccess() {
    return this.status === 'success';
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      jobId: this.jobId,
      executionId: this.executionId,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      error: this.error,
      durationMs: this.durationMs,
      manual: this.manual
    };
  }

  /**
   * Create a new execution for a job
   */
  static create(jobId, executionId, manual = false) {
    return new JobExecution({
      jobId,
      executionId,
      manual
    });
  }
}

export default JobExecution;
