import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

export const ADMIN_SCHEDULER_JOBS_PATH = '/api/v1/admin/scheduler/jobs';

/**
 * Hook for managing scheduler jobs via the admin scheduler API.
 *
 * Provides create, update, and delete operations for jobs plus a "run now" trigger,
 * with structured logging and error handling.
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

  const updateJob = useCallback(async (id, updates) => {
    try {
      const result = await DaylightAPI(`${ADMIN_SCHEDULER_JOBS_PATH}/${id}`, updates, 'PUT');
      logger.info('admin.scheduler.job.updated', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const deleteJob = useCallback(async (id) => {
    try {
      const result = await DaylightAPI(`${ADMIN_SCHEDULER_JOBS_PATH}/${id}`, {}, 'DELETE');
      logger.info('admin.scheduler.job.deleted', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const triggerJob = useCallback(async (id) => {
    try {
      const result = await DaylightAPI(`${ADMIN_SCHEDULER_JOBS_PATH}/${id}/run`, {}, 'POST');
      logger.info('admin.scheduler.job.triggered', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    error, createJob, updateJob, deleteJob, triggerJob, clearError
  };
}

export default useAdminScheduler;
