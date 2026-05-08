// backend/src/3_applications/agents/framework/buildAgentRuntime.mjs
import { MastraAdapter } from '#adapters/agents/index.mjs';

/**
 * Per-agent MastraAdapter (runtime) factory. Each agent that opts into Memory
 * gets its own runtime instance so its Memory state stays isolated. Agents
 * without Memory get a runtime with `memory: null` (back-compat with cron,
 * OpenAI-compat callers, internal invocations).
 *
 * MediaJudge already constructs its own MastraAdapter directly in bootstrap;
 * this helper generalizes that pattern.
 *
 * @param {Memory|null} memory — from buildAgentMemory, or null for stateless.
 * @param {object} sharedDeps — { logger, mediaDir, model?, agentClass?, ... }
 * @param {{ inputProcessors?: Array, outputProcessors?: Array }|null} [processors]
 *   Optional processor arrays (e.g. ObservationalMemory). Null/omitted = no processors.
 * @returns {MastraAdapter}
 */
export function buildAgentRuntime(memory, sharedDeps = {}, processors = null) {
  return new MastraAdapter({
    logger: sharedDeps.logger,
    mediaDir: sharedDeps.mediaDir,
    model: sharedDeps.model,
    agentClass: sharedDeps.agentClass,
    memory,
    inputProcessors: processors?.inputProcessors || null,
    outputProcessors: processors?.outputProcessors || null,
  });
}

export default buildAgentRuntime;
