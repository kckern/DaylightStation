import { describe, it, expect, vi } from 'vitest';
import { createAgentUsageRecorder, attributeAgent, AGENT_ATTRIBUTION } from './agentUsageRecorder.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';

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

  it('attributes each known agent to its app and feature', () => {
    expect(attributeAgent('nutrition-auditor')).toEqual({ app: 'health', feature: 'auditor' });
    expect(attributeAgent('health-coach')).toEqual({ app: 'health', feature: 'coach' });
    expect(attributeAgent('health-coach-commentary')).toEqual({ app: 'health', feature: 'coach-commentary' });
    expect(attributeAgent('newsreporter-consolidator')).toEqual({ app: 'news', feature: 'consolidator' });
    expect(attributeAgent('lifeplan-guide')).toEqual({ app: 'lifeplan', feature: 'guide' });
    expect(attributeAgent('card-ladder-tuner')).toEqual({ app: 'school', feature: 'card-ladder-tuner' });
    expect(attributeAgent('concierge.media-judge')).toEqual({ app: 'concierge', feature: 'media-judge' });
    expect(attributeAgent('paged-media-toc')).toEqual({ app: 'media', feature: 'paged-media-toc' });
    expect(attributeAgent('echo')).toEqual({ app: 'dev', feature: 'echo' });
    // the map is not mutable through the returned object
    attributeAgent('echo').app = 'x';
    expect(AGENT_ATTRIBUTION.echo.app).toBe('dev');
  });

  it('leaves an unknown agent untagged with its id as the feature', () => {
    expect(attributeAgent('brand-new-agent')).toEqual({ app: null, feature: 'brand-new-agent' });
  });

  it('stamps app, feature and the current origin on the ledger row', () => {
    const ledger = { record: vi.fn() };
    const record = createAgentUsageRecorder({ ledger, logger: { info() {}, warn() {} } });
    runWithOrigin('job:nutrition-audit', () => record({ agentId: 'nutrition-auditor', model: { provider: 'openai', name: 'gpt-4o' } }));
    record({ agentId: 'mystery', model: { provider: 'openai', name: 'gpt-4o' } });
    expect(ledger.record.mock.calls[0][0]).toMatchObject({ app: 'health', feature: 'auditor', origin: 'job:nutrition-audit' });
    expect(ledger.record.mock.calls[1][0]).toMatchObject({ app: null, feature: 'mystery', origin: null });
  });

  it('an attribution override tags every turn with the caller, not the agent', () => {
    const ledger = { record: vi.fn() };
    const record = createAgentUsageRecorder({ ledger, logger: { info() {} }, attribution: { app: 'health', feature: 'reconciliation-preview' } });
    const entry = runWithOrigin('cli:health-reconciliation-preview', () => record({ agentId: 'nutrition-auditor', model: { provider: 'openai', name: 'gpt-4o' },
      usage: { inputTokens: 10, outputTokens: 1 } }));
    expect(entry).toMatchObject({ agentId: 'nutrition-auditor', app: 'health', feature: 'reconciliation-preview', origin: 'cli:health-reconciliation-preview' });
    expect(ledger.record).toHaveBeenCalledWith(expect.objectContaining({ feature: 'reconciliation-preview' }));
  });
});
