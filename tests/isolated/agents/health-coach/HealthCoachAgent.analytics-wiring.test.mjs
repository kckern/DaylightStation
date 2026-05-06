import { describe, it, expect, vi } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

function buildAgentRuntime() {
  return { execute: vi.fn(async () => ({ output: '{}' })) };
}

function buildWorkingMemory() {
  return {
    load: vi.fn(async () => ({ serialize: () => '', pruneExpired: () => {}, set: () => {} })),
    save: vi.fn(async () => {}),
  };
}

function buildBaseDeps(extra = {}) {
  return {
    agentRuntime: buildAgentRuntime(),
    workingMemory: buildWorkingMemory(),
    healthStore: { loadHealthData: vi.fn(), loadWeightData: vi.fn(), loadNutritionData: vi.fn() },
    healthService: { getHealthForRange: vi.fn() },
    fitnessPlayableService: { listPlayables: vi.fn() },
    dataService: {},
    messagingGateway: null,
    conversationId: null,
    ...extra,
  };
}

describe('HealthCoachAgent — analytics wiring (Plan 1)', () => {
  it('registers HealthAnalyticsToolFactory when healthAnalyticsService is provided', () => {
    const agent = new HealthCoachAgent(buildBaseDeps({
      healthAnalyticsService: {
        aggregate: vi.fn(), aggregateSeries: vi.fn(),
        distribution: vi.fn(), percentile: vi.fn(), snapshot: vi.fn(),
      },
    }));
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).toContain('aggregate_metric');
    expect(names).toContain('aggregate_series');
    expect(names).toContain('metric_distribution');
    expect(names).toContain('metric_percentile');
    expect(names).toContain('metric_snapshot');
  });

  it('skips analytics tools cleanly when healthAnalyticsService is absent', () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).not.toContain('aggregate_metric');
  });
});
