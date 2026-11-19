import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

const API_BASE = '/api/v1/agents';

/**
 * Hook for managing agents via the admin agents API.
 *
 * Provides agent listing,
 * with structured logging and error handling.
 *
 * @returns {object} Agents state and actions
 */
export function useAdminAgents() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminAgents' }), []);

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(API_BASE);
      setAgents(result.agents || []);
      logger.info('admin.agents.fetched', { count: result.agents?.length });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.agents.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    agents, loading, error,
    fetchAgents, clearError,
  };
}

export async function triggerAssignment(agentId, assignmentId, userId) {
  const result = await DaylightAPI(
    `${API_BASE}/${encodeURIComponent(agentId)}/assignments/${encodeURIComponent(assignmentId)}/run`,
    { userId }, 'POST',
  );
  getLogger().child({ hook: 'useAdminAgents' }).info('admin.agents.assignment.triggered', { agentId, assignmentId, userId });
  return result;
}

export default useAdminAgents;
