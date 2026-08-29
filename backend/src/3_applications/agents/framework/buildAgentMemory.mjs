// backend/src/3_applications/agents/framework/buildAgentMemory.mjs
import { isAgentMemoryFactory } from '../ports/IAgentMemoryFactory.mjs';

/**
 * Per-agent memory builder with friendly error handling. Returns null + logs
 * warn instead of throwing, so a single
 * agent's Memory failure doesn't cascade through bootstrap.
 *
 * @param {object|null} memoryConfig — what AgentClass.getMemoryConfig(deps)
 *   returned. Shape: { lastMessages, workingMemory? }.
 * @param {object} sharedDeps — { dataPath, logger, agentId?, memoryFactory }
 * @returns {object|null}
 */
export function buildAgentMemory(memoryConfig, sharedDeps = {}) {
  if (!memoryConfig) return null;
  const { dataPath, logger = console, agentId, memoryFactory } = sharedDeps;
  if (dataPath == null) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: 'dataPath required' });
    return null;
  }
  if (!isAgentMemoryFactory(memoryFactory)) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: 'memoryFactory required' });
    return null;
  }
  try {
    return memoryFactory.createMemory({ dataPath, ...memoryConfig });
  } catch (err) {
    logger.warn?.('agent.memory.init_failed', { agentId, error: err?.message });
    return null;
  }
}

export default buildAgentMemory;
