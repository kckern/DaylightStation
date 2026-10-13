import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * Scheduling Router - API endpoints for cron/task management
 *
 * Endpoints:
 * - GET /status - Get status of all jobs
 * - POST /run/:jobId - Manually trigger a job
 * - GET /cron10Mins - Run 10-minute bucket jobs
 * - GET /cronHourly - Run hourly bucket jobs
 * - GET /cronDaily - Run daily bucket jobs
 * - GET /cronWeekly - Run weekly bucket jobs
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

function serializeJob(job) {
  return {
    id: job.id,
    name: job.name,
    module: job.module,
    schedule: job.schedule,
    window: job.window,
    timeout: job.timeout,
    dependencies: job.dependencies,
    enabled: job.enabled,
    bucket: job.bucket
  };
}

/**
 * Create scheduling router
 * @param {Object} config
 * @param {import('#apps/scheduling/SchedulerOrchestrator.mjs').SchedulerOrchestrator} config.schedulerOrchestrator
 * @param {Function} config.readSchedulerStatus Runtime-status capability
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createSchedulingRouter(config) {
  const { schedulerOrchestrator, readSchedulerStatus = () => ({ enabled: false }), logger = console } = config;
  const router = express.Router();

  /**
   * GET /status
   * Get status of all jobs with runtime state
   */
  router.get('/status', asyncHandler(async (req, res) => {
    const now = new Date();
    const status = await schedulerOrchestrator.getStatus(now);
    status.scheduler = readSchedulerStatus();
    res.json(status);
  }));

  /**
   * POST /run/:jobId
   * Manually trigger a specific job
   */
  router.post('/run/:jobId', async (req, res) => {
    const { jobId } = req.params;

    try {
      logger.info?.('scheduling.job.manual_trigger', { jobId });

      // Return immediately with execution ID
      const now = new Date();
      const { execution, executionId } = await schedulerOrchestrator.triggerJob(jobId, now);

      res.json({
        status: execution.status === 'success' ? 'completed' : execution.status,
        jobId,
        executionId,
        durationMs: execution.durationMs,
        error: execution.error
      });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      logger.error?.('scheduling.job.manual_failed', { jobId, error: err.message });
      sendInternalError(res, { error: err.message });
    }
  });

  /**
   * Bucket endpoint factory
   * Runs all jobs in a specific bucket
   */
  const createBucketEndpoint = (bucketName) => {
    return async (req, res) => {
      try {
        const executionId = schedulerOrchestrator.createExecutionId();
        logger.info?.('scheduling.bucket.called', { bucket: bucketName, executionId });

        // Respond immediately
        res.json({
          time: nowTs24(),
          message: `Called endpoint for ${bucketName}`,
          executionId
        });

        // Get all jobs in this bucket and run them
        await schedulerOrchestrator.runBucket(bucketName);
      } catch (err) {
        logger.error?.('scheduling.bucket.error', { bucket: bucketName, error: err.message });
        // Response already sent, just log
      }
    };
  };

  // Bucket endpoints for legacy compatibility
  router.get('/cron10Mins', createBucketEndpoint('cron10Mins'));
  router.get('/cronHourly', createBucketEndpoint('cronHourly'));
  router.get('/cronDaily', createBucketEndpoint('cronDaily'));
  router.get('/cronWeekly', createBucketEndpoint('cronWeekly'));

  /**
   * GET /jobs
   * List all registered jobs
   */
  router.get('/jobs', asyncHandler(async (req, res) => {
    const jobs = await schedulerOrchestrator.listJobs();
    res.json({
      count: jobs.length,
      jobs: jobs.map(serializeJob)
    });
  }));

  /**
   * GET /running
   * Get currently running jobs
   */
  router.get('/running', (req, res) => {
    const running = schedulerOrchestrator.listRunningJobs().map(({ jobId, executionId }) => ({
      jobId, executionId,
      startedAt: nowTs24() // Approximate
    }));

    res.json({
      count: running.length,
      jobs: running
    });
  });

  return router;
}

export default createSchedulingRouter;
