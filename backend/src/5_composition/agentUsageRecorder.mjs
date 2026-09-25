/**
 * Agent usage recorder — prices one Mastra agent turn and appends it to the AI
 * usage ledger. Built here, not in the adapter, because 1_adapters/agents may
 * not import 1_adapters/ai (pricing). Every MastraAdapter receives it as
 * `usageRecorder`; without it agent spend never reached the ledger (2026-09-25:
 * ~$21 of gpt-4o in 13 days, zero ledger rows).
 */
import { estimateCostUsd } from '#adapters/ai/aiPricing.mjs';

export function createAgentUsageRecorder({ ledger = null, logger = console, pricing = null } = {}) {
  return function recordAgentUsage({ agentId, runId = null, turnId = null, model, usage = null, durationMs = null, status = 'ok', error = null }) {
    try {
      const promptTokens = usage?.inputTokens ?? null;
      const completionTokens = usage?.outputTokens ?? null;
      const cachedTokens = usage?.cachedInputTokens ?? null;
      const costUsd = usage ? estimateCostUsd(model?.name, { promptTokens, completionTokens, cachedTokens }, pricing) : 0;
      const entry = {
        provider: model?.provider || 'unknown', endpoint: 'agent', model: model?.name || null, requestedModel: model?.name || null,
        agentId, runId, turnId, promptTokens, completionTokens,
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
