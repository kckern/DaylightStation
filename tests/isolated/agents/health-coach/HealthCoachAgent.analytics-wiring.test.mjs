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

describe('HealthCoachAgent — PeriodToolFactory wiring (Task 13)', () => {
  it('registers period vocabulary tools when healthAnalyticsService is provided', () => {
    const agent = new HealthCoachAgent(buildBaseDeps({
      healthAnalyticsService: {
        listPeriods: vi.fn(),
        deducePeriod: vi.fn(),
        rememberPeriod: vi.fn(),
        forgetPeriod: vi.fn(),
      },
    }));
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).toContain('list_periods');
    expect(names).toContain('deduce_period');
    expect(names).toContain('remember_period');
    expect(names).toContain('forget_period');
  });

  it('skips period tools cleanly when healthAnalyticsService is absent', () => {
    const agent = new HealthCoachAgent(buildBaseDeps());
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).not.toContain('list_periods');
    expect(names).not.toContain('remember_period');
  });

  it('retired analytics tools are no longer registered', () => {
    const agent = new HealthCoachAgent(buildBaseDeps({
      healthAnalyticsService: {
        listPeriods: vi.fn(),
        deducePeriod: vi.fn(),
        rememberPeriod: vi.fn(),
        forgetPeriod: vi.fn(),
      },
    }));
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    // These were in HealthAnalyticsToolFactory (now deleted).
    expect(names).not.toContain('aggregate_metric');
    expect(names).not.toContain('aggregate_series');
    expect(names).not.toContain('metric_distribution');
    expect(names).not.toContain('metric_percentile');
    expect(names).not.toContain('metric_snapshot');
  });
});
