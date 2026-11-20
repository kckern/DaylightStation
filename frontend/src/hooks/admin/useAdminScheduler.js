import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

export const ADMIN_SCHEDULER_JOBS_PATH = '/api/v1/admin/scheduler/jobs';
export const schedulerJobPath = id => `${ADMIN_SCHEDULER_JOBS_PATH}/${encodeURIComponent(id)}`;
export const triggerSchedulerJob = id => DaylightAPI(`${schedulerJobPath(id)}/run`, {}, 'POST');

/**
 * Hook for managing scheduler jobs via the admin scheduler API.
 *
 * Creates and queues jobs from the roster with shared command feedback.
 *
 * @returns {object} Scheduler commands and command error state
 */
export function useAdminScheduler() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminScheduler' }), []);

  const [error, setError] = useState(null);

  const createJob = useCallback(async (jobData) => {
    try {
      const result = await DaylightAPI(ADMIN_SCHEDULER_JOBS_PATH, jobData, 'POST');
      logger.info('admin.scheduler.job.created', { id: jobData.id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const triggerJob = useCallback(async (id) => {
    try {
      const result = await triggerSchedulerJob(id);
      logger.info('admin.scheduler.job.triggered', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    error, createJob, triggerJob, clearError
  };
}

export default useAdminScheduler;
