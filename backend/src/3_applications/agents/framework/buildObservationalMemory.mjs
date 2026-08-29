// backend/src/3_applications/agents/framework/buildObservationalMemory.mjs
import { isAgentMemoryProcessorFactory } from '../ports/IAgentMemoryProcessorFactory.mjs';

/**
 * Build an ObservationalMemory processor instance for an agent.
 *
 * ObservationalMemory is BOTH an input processor (injects prior observations
 * as compressed context) and an output processor (persists new observations
 * after each turn). The caller should include the same instance in both arrays.
 *
 * Returns null when disabled or storage is missing — the caller conditionally
 * adds it to the processor chain. Construction errors return null and are
 * swallowed so one bad config cannot crash boot.
 *
 * @param {object|null} config — YAML `memory.observational` block:
 *   { enabled, observer_model, reflector_model,
 *     message_tokens_threshold, observation_tokens_threshold, scope }
 * @param {{ memory: object|null, processorFactory: object }} deps
 * @returns {object|null}
 */
export function buildObservationalMemory(config, { memory, processorFactory } = {}) {
  if (!config?.enabled) return null;
  if (!memory) return null;
  if (!isAgentMemoryProcessorFactory(processorFactory)) return null;
  try {
    return processorFactory.createObservationalProcessor({
      memory,
      observerModel: config.observer_model || 'google/gemini-2.5-flash',
      reflectorModel: config.reflector_model || 'google/gemini-2.5-flash',
      messageTokens: config.message_tokens_threshold || 30000,
      observationTokens: config.observation_tokens_threshold || 40000,
      scope: config.scope || 'resource',
    });
  } catch {
    return null;
  }
}

export default buildObservationalMemory;
