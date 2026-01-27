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
import { nowTs24 } from '#system/utils/index.mjs';

/**
 * Create scheduling router
 * @param {Object} config
 * @param {import('../../1_domains/scheduling/services/SchedulerService.mjs').SchedulerService} config.schedulerService
 * @param {import('../../0_system/scheduling/Scheduler.mjs').Scheduler} config.scheduler
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createSchedulingRouter(config) {
  const { schedulerService, scheduler, logger = console } = config;
  const router = express.Router();

  /**
   * GET /status
   * Get status of all jobs with runtime state
   */
  router.get('/status', async (req, res) => {
    try {
      const now = new Date();
      const status = await schedulerService.getStatus(now);
      status.scheduler = scheduler?.getStatus() || { enabled: false };
      res.json(status);
    } catch (err) {
      logger.error?.('scheduling.status.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

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
      const { execution, executionId } = await schedulerService.triggerJob(jobId, now);

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
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Bucket endpoint factory
   * Runs all jobs in a specific bucket
   */
  const createBucketEndpoint = (bucketName) => {
    return async (req, res) => {
      try {
        const executionId = schedulerService.generateExecutionId();
        logger.info?.('scheduling.bucket.called', { bucket: bucketName, executionId });

        // Respond immediately
        res.json({
          time: nowTs24(),
          message: `Called endpoint for ${bucketName}`,
          executionId
        });

        // Get all jobs in this bucket and run them
        const jobs = await schedulerService.jobStore.loadJobs();
        const bucketJobs = jobs.filter(j => j.bucket === bucketName);
        const now = new Date();

        for (const job of bucketJobs) {
          const states = await schedulerService.stateStore.loadStates();
          const state = states.get(job.id) || { jobId: job.id };
          await schedulerService.runJob(job, state, true, now);
        }
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
  router.get('/jobs', async (req, res) => {
    try {
      const jobs = await schedulerService.jobStore.loadJobs();
      res.json({
        count: jobs.length,
        jobs: jobs.map(j => j.toJSON())
      });
    } catch (err) {
      logger.error?.('scheduling.jobs.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /running
   * Get currently running jobs
   */
  router.get('/running', (req, res) => {
    const running = Array.from(schedulerService.runningJobs.entries()).map(([jobId, executionId]) => ({
      jobId,
      executionId,
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
