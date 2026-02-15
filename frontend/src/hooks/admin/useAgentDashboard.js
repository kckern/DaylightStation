import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Hook for reading, deleting, and regenerating agent-generated dashboards.
 *
 * Provides dashboard fetching, deletion, and regeneration via the
 * health-dashboard and agents assignment APIs, with structured logging
 * and error handling.
 *
 * @returns {object} Dashboard state and actions
 */
export function useAgentDashboard() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentDashboard' }), []);

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async (userId, date) => {
    if (!userId || !date) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/health-dashboard/${userId}/${date}`);
      setDashboard(result.dashboard || null);
      logger.info('admin.dashboard.fetched', { userId, date });
      return result;
    } catch (err) {
      // 404 means no dashboard generated — treat as null, not error
      if (err.message?.includes('404')) {
        setDashboard(null);
        return null;
      }
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const deleteDashboard = useCallback(async (userId, date) => {
    try {
      const result = await DaylightAPI(`/api/v1/health-dashboard/${userId}/${date}`, {}, 'DELETE');
      setDashboard(null);
      logger.info('admin.dashboard.deleted', { userId, date });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const regenerate = useCallback(async (agentId, userId) => {
    setRegenerating(true);
    setError(null);
    try {
      const result = await DaylightAPI(
        `/api/v1/agents/${agentId}/assignments/daily-dashboard/run`,
        { userId },
        'POST'
      );
      logger.info('admin.dashboard.regenerated', { agentId, userId });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setRegenerating(false);
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    dashboard, loading, regenerating, error,
    fetchDashboard, deleteDashboard, regenerate, clearError,
  };
}

export default useAgentDashboard;
