import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/scheduler';

/**
 * Hook for managing scheduler jobs via the admin scheduler API.
 *
 * Provides CRUD operations for jobs plus a "run now" trigger,
 * with structured logging and error handling.
 *
 * @returns {object} Scheduler state and actions
 */
export function useAdminScheduler() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminScheduler' }), []);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/jobs`);
      setJobs(result.jobs || []);
      logger.info('admin.scheduler.jobs.fetched', { count: result.jobs?.length });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.scheduler.jobs.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const createJob = useCallback(async (jobData) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/jobs`, jobData, 'POST');
      logger.info('admin.scheduler.job.created', { id: jobData.id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const updateJob = useCallback(async (id, updates) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/jobs/${id}`, updates, 'PUT');
      logger.info('admin.scheduler.job.updated', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const deleteJob = useCallback(async (id) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/jobs/${id}`, {}, 'DELETE');
      logger.info('admin.scheduler.job.deleted', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const triggerJob = useCallback(async (id) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/jobs/${id}/run`, {}, 'POST');
      logger.info('admin.scheduler.job.triggered', { id });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    jobs, loading, error,
    fetchJobs, createJob, updateJob, deleteJob, triggerJob, clearError
  };
}

export default useAdminScheduler;
