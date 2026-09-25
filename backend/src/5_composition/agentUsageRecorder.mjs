/**
 * Agent usage recorder — prices one Mastra agent turn and appends it to the AI
 * usage ledger. Built here, not in the adapter, because 1_adapters/agents may
 * not import 1_adapters/ai (pricing). Every MastraAdapter receives it as
 * `usageRecorder`; without it agent spend never reached the ledger (2026-09-25:
 * ~$21 of gpt-4o in 13 days, zero ledger rows).
 */
import { estimateCostUsd } from '#adapters/ai/aiPricing.mjs';
import { currentOrigin } from '#system/runtime/aiContext.mjs';

/**
 * Which app and feature each Mastra agent's spend belongs to. Agents are the
 * one AI path that does not go through a scoped gateway view, so this map is
 * their attribution. An agent missing here records app null and its own id as
 * the feature — visible as untagged, never guessed.
 */
export const AGENT_ATTRIBUTION = Object.freeze({
  'nutrition-auditor': { app: 'health', feature: 'auditor' },
  'health-coach': { app: 'health', feature: 'coach' },
  'health-coach-commentary': { app: 'health', feature: 'coach-commentary' },
  'newsreporter-consolidator': { app: 'news', feature: 'consolidator' },
  'lifeplan-guide': { app: 'lifeplan', feature: 'guide' },
  'card-ladder-tuner': { app: 'school', feature: 'card-ladder-tuner' },
  concierge: { app: 'concierge', feature: 'assistant' },
  'concierge.media-judge': { app: 'concierge', feature: 'media-judge' },
  'paged-media-toc': { app: 'media', feature: 'paged-media-toc' },
  echo: { app: 'dev', feature: 'echo' },
});

/** @returns {{ app: string|null, feature: string|null }} */
export function attributeAgent(agentId) {
  const known = AGENT_ATTRIBUTION[agentId];
  if (known) return { ...known };
  return { app: null, feature: agentId ?? null };
}

/**
 * @param {Object} [options]
 * @param {{ app: string, feature: string }} [options.attribution] - overrides
 *   AGENT_ATTRIBUTION for every turn this recorder sees; for a caller that runs
 *   a known agent on someone else's behalf (a CLI preview of the auditor is not
 *   the auditor's spend).
 */
export function createAgentUsageRecorder({ ledger = null, logger = console, pricing = null, attribution = null } = {}) {
  return function recordAgentUsage({ agentId, runId = null, turnId = null, model, usage = null, durationMs = null, status = 'ok', error = null }) {
    try {
      const promptTokens = usage?.inputTokens ?? null;
      const completionTokens = usage?.outputTokens ?? null;
      const cachedTokens = usage?.cachedInputTokens ?? null;
      const costUsd = usage ? estimateCostUsd(model?.name, { promptTokens, completionTokens, cachedTokens }, pricing) : 0;
      const entry = {
        provider: model?.provider || 'unknown', endpoint: 'agent', model: model?.name || null, requestedModel: model?.name || null,
        agentId, ...(attribution ? { app: attribution.app ?? null, feature: attribution.feature ?? null } : attributeAgent(agentId)), origin: currentOrigin() ?? null,
        runId, turnId, promptTokens, completionTokens,
        totalTokens: usage ? (promptTokens || 0) + (completionTokens || 0) : null,
        ...(cachedTokens != null ? { cachedTokens } : {}),
        ...(usage?.reasoningTokens ? { reasoningTokens: usage.reasoningTokens } : {}),
        costUsd, durationMs, status, ...(error ? { error } : {}),
      };
      logger.info?.('agent.usage', entry);
      ledger?.record(entry);
      return entry;
    } catch (recordError) {
      logger.warn?.('agent.usage.record-failed', { agentId, error: recordError.message });
      return null;
    }
  };
}
