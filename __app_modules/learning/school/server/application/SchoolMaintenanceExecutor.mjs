/**
 * SchoolMaintenanceExecutor — the scheduler's handle on school housekeeping.
 *
 * Exists because the stale-session sweep had no way to run. `listStale` was
 * reachable only through a manual, teacher-gated `GET /sessions/stale`, so the
 * threshold written into that route was never once consulted: a session issued
 * on 2026-08-14 was still live eight days later and resumed as if it were that
 * morning's work.
 *
 * Deliberately thin. It owns no policy — WHICH sessions may be swept and at
 * what age is `MarkSessionAbandoned.sweepUntouched`'s business — and exists
 * only to translate between the scheduler's `canHandle`/`execute` shape and a
 * use case. Same posture as `MediaJobExecutor`/`HarvesterJobExecutor`.
 *
 * A sweep that throws must not take the scheduler's job loop with it: the run
 * is logged and the error rethrown for the orchestrator's own execution record,
 * which is what marks the job failed and retries on its normal cadence.
 */

export const SCHOOL_STALE_SWEEP_JOB = 'school-stale-sweep';

export class SchoolMaintenanceExecutor {
  #markSessionAbandoned; #sweepAnswerSheets; #defaultOlderThanDays; #logger;

  /**
   * @param {object} deps
   * @param {{sweepUntouched: Function}} deps.markSessionAbandoned
   * @param {{execute: Function}} [deps.sweepAnswerSheets] - the OMR card pass
   *   (`SweepAnswerSheets`), run after the session sweep so windows it just
   *   freed are counted.
   * @param {number} [deps.olderThanDays=14] - household default; a job may
   *   override it per-run through its own `options`.
   * @param {object} [deps.logger]
   */
  constructor({ markSessionAbandoned, sweepAnswerSheets = null, olderThanDays = 14, logger = console } = {}) {
    if (!markSessionAbandoned?.sweepUntouched) {
      throw new Error('SchoolMaintenanceExecutor requires markSessionAbandoned with sweepUntouched');
    }
    this.#markSessionAbandoned = markSessionAbandoned;
    this.#sweepAnswerSheets = sweepAnswerSheets;
    this.#defaultOlderThanDays = olderThanDays;
    this.#logger = logger;
  }

  /** @param {string} jobId */
  canHandle(jobId) {
    return jobId === SCHOOL_STALE_SWEEP_JOB;
  }

  /**
   * @param {string} jobId
   * @param {{olderThanDays?: number, leakAfterHours?: number, dryRun?: boolean}} [options] - from the job's own config
   * @param {{executionId?: string}} [context]
   */
  async execute(jobId, options = {}, context = {}) {
    if (!this.canHandle(jobId)) {
      throw new Error(`SchoolMaintenanceExecutor cannot handle job: ${jobId}`);
    }
    const olderThanDays = Number.isInteger(options?.olderThanDays) && options.olderThanDays > 0
      ? options.olderThanDays
      : this.#defaultOlderThanDays;
    const leakAfterHours = Number.isFinite(options?.leakAfterHours) && options.leakAfterHours > 0
      ? options.leakAfterHours
      : undefined;
    const dryRun = options?.dryRun === true;

    let result;
    let sessionError = null;
    try {
      result = await this.#markSessionAbandoned.sweepUntouched({ olderThanDays, dryRun });
    } catch (error) {
      sessionError = error;
    }
    // A broken session sweep must not also leave leaked card rows in place.
    const answerSheets = this.#sweepAnswerSheets
      ? await this.#sweepAnswerSheets.execute({ dryRun, ...(leakAfterHours ? { leakAfterHours } : {}) })
      : null;
    if (sessionError) throw sessionError;
    this.#logger.info?.('school.maintenance.sweep-ran', {
      executionId: context?.executionId ?? null,
      olderThanDays,
      dryRun,
      swept: result.swept.length,
      skipped: result.skipped.length,
      ...(answerSheets ? {
        leaksRecovered: answerSheets.leaksRecovered?.length ?? 0,
        writtenOff: answerSheets.writtenOff?.length ?? 0,
        gapsAccepted: answerSheets.gapsAccepted?.length ?? 0,
      } : {}),
    });
    return answerSheets ? { ...result, answerSheets } : result;
  }
}

export default SchoolMaintenanceExecutor;
