import { useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

export function useAgentMemory(agentId, userId) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentMemory' }), []);
  const path = agentId && userId
    ? `/api/v1/agents/${encodeURIComponent(agentId)}/memory/${encodeURIComponent(userId)}` : null;
  const { data, loading, error, reload } = useApiResource(path, { label: 'Agent working memory' });
  const [clearedSnapshot, setClearedSnapshot] = useState(null);
  const unconfigured = error?.status === 501 || error?.message?.includes('HTTP 501');

  useEffect(() => {
    if (data) logger.info('admin.agents.memory.fetched', { agentId, userId, count: Object.keys(data.entries || {}).length });
  }, [data, agentId, userId, logger]);

  async function deleteEntry(key) {
    await DaylightAPI(`${path}/${encodeURIComponent(key)}`, {}, 'DELETE');
    logger.info('admin.agents.memory.entry.deleted', { agentId, userId, key });
    reload();
  }

  async function clearAll() {
    await DaylightAPI(path, {}, 'DELETE');
    logger.info('admin.agents.memory.cleared', { agentId, userId });
    setClearedSnapshot(data);
  }

  return {
    entries: unconfigured || clearedSnapshot === data ? {} : data?.entries || {},
    loading, error: unconfigured ? null : error, deleteEntry, clearAll,
  };
}

export default useAgentMemory;
