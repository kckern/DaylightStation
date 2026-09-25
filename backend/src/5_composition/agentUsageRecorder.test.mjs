import { describe, it, expect, vi } from 'vitest';
import { createAgentUsageRecorder } from './agentUsageRecorder.mjs';

describe('agent usage recorder', () => {
  it('prices Mastra usage and writes one ledger row per agent turn', () => {
    const ledger = { record: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const record = createAgentUsageRecorder({ ledger, logger });
    const entry = record({ agentId: 'nutrition-auditor', runId: 'audit_1', turnId: 't1',
      model: { provider: 'openai', name: 'gpt-4o' }, durationMs: 900, status: 'ok',
      usage: { inputTokens: 40_000, cachedInputTokens: 10_000, outputTokens: 500, reasoningTokens: 0 } });
    expect(entry.costUsd).toBeCloseTo((30_000 * 2.5 + 10_000 * 1.25 + 500 * 10) / 1e6, 9);
    expect(ledger.record).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai', endpoint: 'agent', model: 'gpt-4o', agentId: 'nutrition-auditor', runId: 'audit_1',
      promptTokens: 40_000, cachedTokens: 10_000, completionTokens: 500, totalTokens: 40_500, status: 'ok' }));
    expect(logger.info).toHaveBeenCalledWith('agent.usage', expect.objectContaining({ agentId: 'nutrition-auditor' }));
  });

  it('records a failed turn with no usage at zero cost and never throws', () => {
    const ledger = { record: vi.fn(() => { throw new Error('disk'); }) };
    const record = createAgentUsageRecorder({ ledger, logger: { info() {}, warn: vi.fn() } });
    expect(() => record({ agentId: 'a', model: { provider: 'openai', name: 'gpt-4o' }, status: 'error', error: 'boom' })).not.toThrow();
  });
});
