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

import { createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class SchedulerService {
  constructor({ timezone = 'America/Los_Angeles' } = {}) {
    this.timezone = timezone;
  }

  /**
   * Compute MD5 hash for window offset
   */
  md5(str) {
    return createHash('md5').update(str).digest('hex');
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
