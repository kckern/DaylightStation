import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/agents';

/**
 * Hook for managing agents via the admin agents API.
 *
 * Provides listing, assignment fetching, and assignment triggering operations,
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

  const fetchAssignments = useCallback(async (agentId) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/assignments`);
      logger.info('admin.agents.assignments.fetched', { agentId, count: result.assignments?.length });
      return result.assignments || [];
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const triggerAssignment = useCallback(async (agentId, assignmentId, userId) => {
    try {
      const result = await DaylightAPI(
        `${API_BASE}/${agentId}/assignments/${assignmentId}/run`,
        { userId },
        'POST'
      );
      logger.info('admin.agents.assignment.triggered', { agentId, assignmentId, userId });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    agents, loading, error,
    fetchAgents, fetchAssignments, triggerAssignment, clearError,
  };
}

export default useAdminAgents;
