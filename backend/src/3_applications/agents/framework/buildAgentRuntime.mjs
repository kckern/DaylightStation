// backend/src/3_applications/agents/framework/buildAgentRuntime.mjs

/**
 * Per-agent runtime factory. Each agent that opts into Memory gets its own
 * runtime instance so its Memory state stays isolated. Agents without Memory
 * get a runtime with `memory: null` (back-compat with cron, OpenAI-compat
 * callers, internal invocations).
 *
 * The concrete runtime class (MastraAdapter) is injected by the composition
 * root via `sharedDeps.AgentRuntime` — this module holds no adapter imports.
 *
 * @param {Memory|null} memory — from buildAgentMemory, or null for stateless.
 * @param {object} sharedDeps — { AgentRuntime, logger, mediaDir, model?, agentClass?, ... }
 *   `AgentRuntime` is the runtime class to instantiate (e.g. MastraAdapter),
 *   supplied at bootstrap.
 * @param {{ inputProcessors?: Array, outputProcessors?: Array }|null} [processors]
 *   Optional processor arrays (e.g. ObservationalMemory). Null/omitted = no processors.
 * @returns {object} runtime instance
 */
export function buildAgentRuntime(memory, sharedDeps = {}, processors = null) {
  const AgentRuntime = sharedDeps.AgentRuntime;
  if (typeof AgentRuntime !== 'function') {
    throw new Error('buildAgentRuntime: sharedDeps.AgentRuntime (runtime class) is required — inject it from the composition root');
  }
  return new AgentRuntime({
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
