import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
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
  const { data, loading, error, reload } = useApiResource(API_BASE, { label: 'Admin agents' });
  return { agents: data?.agents || [], loading, error, reload };
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
