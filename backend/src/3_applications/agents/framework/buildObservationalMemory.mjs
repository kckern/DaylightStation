// backend/src/3_applications/agents/framework/buildObservationalMemory.mjs
import { ObservationalMemory } from '@mastra/memory/processors';

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
 * Storage note: ObservationalMemory requires a MemoryStorage instance
 * (not the MastraCompositeStore). Pass `memory.storage.stores?.memory` from
 * the per-agent Memory instance, NOT `memory.storage` directly.
 *
 * @param {object|null} config — YAML `memory.observational` block:
 *   { enabled, observer_model, reflector_model,
 *     message_tokens_threshold, observation_tokens_threshold, scope }
 * @param {{ storage: import('@mastra/core/storage').MemoryStorage|null }} deps
 * @returns {ObservationalMemory|null}
 */
export function buildObservationalMemory(config, { storage } = {}) {
  if (!config?.enabled) return null;
  if (!storage) return null;
  try {
    return new ObservationalMemory({
      storage,
      observation: {
        model: config.observer_model || 'google/gemini-2.5-flash',
        messageTokens: config.message_tokens_threshold || 30000,
      },
      reflection: {
        model: config.reflector_model || 'google/gemini-2.5-flash',
        observationTokens: config.observation_tokens_threshold || 40000,
      },
      scope: config.scope || 'resource',
    });
  } catch {
    return null;
  }
}

export default buildObservationalMemory;
