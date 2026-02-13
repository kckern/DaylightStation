/**
 * SchedulerService - Pure scheduling domain logic
 *
 * Handles:
 * - Computing next run times with cron expressions
 * - Window offset/jitter for load spreading
 * - Dependency checking
 * - Date formatting/parsing
 * - Execution ID generation
 *
 * No I/O, no stores, no executors. All side-effect-free computations.
 */

import crypto from 'crypto';
import { CronExpressionParser } from 'cron-parser';
import { ValidationError } from '../../core/errors/index.mjs';

export class SchedulerService {
  constructor({ timezone = 'America/Los_Angeles' }) {
    this.timezone = timezone;
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
   * @param {import('../entities/Job.mjs').Job} job
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
   * Check if job dependencies are satisfied
   * @param {import('../entities/Job.mjs').Job} job
   * @param {Map<string, import('../entities/JobState.mjs').JobState>} allStates
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
}

export default SchedulerService;
