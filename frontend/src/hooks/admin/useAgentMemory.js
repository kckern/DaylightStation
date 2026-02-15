import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/agents';

/**
 * Hook for reading and deleting agent working memory entries.
 *
 * Provides memory fetching, single-entry deletion, and bulk clearing,
 * with structured logging and error handling.
 *
 * @returns {object} Memory state and actions
 */
export function useAgentMemory() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentMemory' }), []);

  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMemory = useCallback(async (agentId, userId) => {
    if (!agentId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}`);
      setEntries(result.entries || {});
      logger.info('admin.agents.memory.fetched', { agentId, userId, count: Object.keys(result.entries || {}).length });
      return result;
    } catch (err) {
      // 501 means memory not configured — treat as empty, not error
      if (err.message && err.message.includes('HTTP 501')) {
        setEntries({});
        return { entries: {} };
      }
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const deleteEntry = useCallback(async (agentId, userId, key) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}/${key}`, {}, 'DELETE');
      logger.info('admin.agents.memory.entry.deleted', { agentId, userId, key });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearAll = useCallback(async (agentId, userId) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}`, {}, 'DELETE');
      logger.info('admin.agents.memory.cleared', { agentId, userId });
      setEntries({});
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    entries, loading, error,
    fetchMemory, deleteEntry, clearAll, clearError,
  };
}

export default useAgentMemory;
