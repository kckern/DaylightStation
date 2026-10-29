/**
 * CourseSequenceJobHandler - Scheduler-compatible handler for the course
 * watchlist (see CourseSequenceService).
 *
 * @module applications/media/CourseSequenceJobHandler
 */

/**
 * @param {Object} config
 * @param {import('./CourseSequenceService.mjs').CourseSequenceService} config.service
 * @param {Object} [config.logger]
 * @returns {Function} Async handler (logger, executionId) => Promise<Object>
 */
export function createCourseSequenceJobHandler({ service, logger }) {
  return async (scopedLogger, executionId) => {
    const log = scopedLogger || logger || console;
    log.info?.('media.courses.job.start', { executionId });
    try {
      const result = await service.run();
      log.info?.('media.courses.job.complete', {
        executionId, retired: result.retired.length, picked: result.picked.length, unfinished: result.unfinished,
      });
      return result;
    } catch (error) {
      log.error?.('media.courses.job.error', { executionId, error: error.message });
      throw error;
    }
  };
}
