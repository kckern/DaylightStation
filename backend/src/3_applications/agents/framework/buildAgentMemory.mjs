// backend/src/3_applications/agents/framework/buildAgentMemory.mjs
import { buildMastraMemory } from '#system/memory/buildMastraMemory.mjs';

/**
 * Per-agent Memory factory. Wraps buildMastraMemory with friendlier error
 * handling — returns null + logs warn instead of throwing — so a single
 * agent's Memory failure doesn't cascade through bootstrap.
 *
 * @param {object|null} memoryConfig — what AgentClass.getMemoryConfig(deps)
 *   returned. Shape: { lastMessages, workingMemory? }.
 * @param {object} sharedDeps — { dataPath, logger, agentId? }
 * @returns {Memory|null}
 */
export function buildAgentMemory(memoryConfig, sharedDeps = {}) {
  if (!memoryConfig) return null;
  const { dataPath, logger = console, agentId } = sharedDeps;
  if (dataPath == null) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: 'dataPath required' });
    return null;
  }
  // v1: shared db file across agents at data/agents/memory.db. Per-agent
  // sub-files can come later if write contention surfaces.
  const dbPath = dataPath === ':memory:' ? ':memory:' : `${dataPath}/agents/memory.db`;
  try {
    return buildMastraMemory({ dbPath, ...memoryConfig });
  } catch (err) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: err?.message });
    return null;
  }
}

export default buildAgentMemory;
