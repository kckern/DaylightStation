/**
 * JobExecution Entity - Represents a single execution of a job
 */
import { ValidationError } from '../../core/errors/index.mjs';

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
   * @param {string} timestamp - Start timestamp (required)
   * @returns {JobExecution}
   * @throws {ValidationError} If timestamp is not provided
   */
  start(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for start');
    }
    this.startTime = timestamp;
    this.status = 'running';
    return this;
  }

  /**
   * Mark execution as successful
   * @param {string} timestamp - End timestamp (required)
   * @returns {JobExecution}
   * @throws {ValidationError} If timestamp is not provided
   */
  succeed(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for succeed');
    }
    this.endTime = timestamp;
    this.status = 'success';
    this.durationMs = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  /**
   * Mark execution as failed
   * @param {Error|string} error - Error that caused failure
   * @param {string} timestamp - End timestamp (required)
   * @returns {JobExecution}
   * @throws {ValidationError} If timestamp is not provided
   */
  fail(error, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for fail');
    }
    this.endTime = timestamp;
    this.status = 'failed';
    this.error = error?.message || error;
    this.durationMs = new Date(this.endTime) - new Date(this.startTime);
    return this;
  }

  /**
   * Mark execution as timed out
   * @param {string} timestamp - End timestamp (required)
   * @returns {JobExecution}
   * @throws {ValidationError} If timestamp is not provided
   */
  timeout(timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for timeout');
    }
    this.endTime = timestamp;
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
