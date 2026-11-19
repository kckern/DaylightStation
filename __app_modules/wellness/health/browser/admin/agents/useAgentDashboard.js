import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from "../../../../../../frontend/src/lib/api.mjs";
import { useApiResource } from "../../../../../../frontend/src/lib/hooks/useApiResource.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

/**
 * Hook for reading, deleting, and regenerating agent-generated dashboards.
 *
 * Provides dashboard fetching, deletion, and regeneration via the
 * health-dashboard and agents assignment APIs, with structured logging
 * and error handling.
 *
 * @returns {object} Dashboard state and actions
 */
export function useAgentDashboard(userId, date) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentDashboard' }), []);
  const path = userId && date ? `/api/v1/health-dashboard/${userId}/${date}` : null;
  const { data, loading, error: readError, reload } = useApiResource(path, { label: 'Agent dashboard' });
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);
  const [dismissedReadError, setDismissedReadError] = useState(null);
  const dashboard = readError?.status === 404 ? null : data?.dashboard || null;
  const visibleError = error || (readError?.status === 404 || readError === dismissedReadError ? null : readError);

  const fetchDashboard = useCallback(async (userId, date) => {
    reload();
  }, [reload]);

  const deleteDashboard = useCallback(async (userId, date) => {
    try {
      const result = await DaylightAPI(`/api/v1/health-dashboard/${userId}/${date}`, {}, 'DELETE');
      logger.info('admin.dashboard.deleted', { userId, date });
      reload();
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger, userId, date, reload]);

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

  const clearError = useCallback(() => {
    setError(null);
    setDismissedReadError(readError);
  }, [readError]);

  return {
    dashboard, loading, regenerating, error: visibleError,
    fetchDashboard, deleteDashboard, regenerate, clearError,
  };
}

export default useAgentDashboard;
