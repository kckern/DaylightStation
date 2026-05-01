import { describe, it, expect, vi } from 'vitest';

import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';
import { HealthArchiveScope } from '../../../../backend/src/2_domains/health/services/HealthArchiveScope.mjs';
import { SimilarPeriodFinder } from '../../../../backend/src/2_domains/health/services/SimilarPeriodFinder.mjs';

// ---------------------------------------------------------------------------
// Test doubles
//
// We never invoke any tool (only assert their `name`), so the underlying
// store/service stubs only need to be truthy — but we provide minimal shape
// so future smoke tests can wire actual calls without rebuilding the harness.
// ---------------------------------------------------------------------------

function buildAgentRuntime() {
  return { execute: vi.fn(async () => ({ output: '{}' })) };
}

function buildWorkingMemory() {
  return {
    load: vi.fn(async () => ({ serialize: () => '', pruneExpired: () => {}, set: () => {} })),
    save: vi.fn(async () => {}),
  };
}

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Build a HealthCoachAgent with all dependencies the F-102/103/104 wiring
 * expects. The longitudinal factory takes archiveScope, similarPeriodFinder,
 * personalContextLoader, and dataRoot in addition to the standard health-coach
 * deps.
 */
function buildAgent() {
  const dataRoot = '/tmp/data';
  const mediaRoot = '/tmp/media';

  return new HealthCoachAgent({
    agentRuntime: buildAgentRuntime(),
    workingMemory: buildWorkingMemory(),
    logger: buildLogger(),
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({}),
      loadCoachingData: async () => ({}),
      saveCoachingData: async () => {},
    },
    healthService: {
      getHealthForRange: async () => ({}),
      getHealthForDate: async () => null,
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async () => ({ items: [], containerItem: {} }),
    },
    sessionService: {},
    mediaProgressMemory: {},
    dataService: { user: { read: () => null, write: () => true } },
    configService: { getHeadOfHousehold: () => 'test-user' },
    personalContextLoader: { loadPlaybook: async () => null, load: async () => '' },
    archiveScope: new HealthArchiveScope({ dataRoot, mediaRoot }),
    similarPeriodFinder: new SimilarPeriodFinder({}),
    dataRoot,
  });
}

describe('HealthCoachAgent — longitudinal tools registered', () => {
  it('exposes all F-103 + F-102 + F-104 tools after registration', () => {
    const agent = buildAgent();
    const toolNames = agent.getTools().map((t) => t.name);

    // The 6 longitudinal tools added by LongitudinalToolFactory.
    const longitudinalToolNames = [
      'query_historical_weight',
      'query_historical_nutrition',
      'query_historical_workouts',
      'query_named_period',
      'read_notes_file',
      'find_similar_period',
    ];
    for (const name of longitudinalToolNames) {
      expect(toolNames).toContain(name);
    }
  });

  it('keeps existing health-coach tools registered (regression guard)', () => {
    const agent = buildAgent();
    const toolNames = agent.getTools().map((t) => t.name);

    // Sample of pre-existing tools across the four original factories.
    const existingTools = [
      // HealthToolFactory
      'get_weight_trend',
      'get_today_nutrition',
      'get_nutrition_history',
      // FitnessContentToolFactory
      'get_fitness_content',
      'get_program_state',
      // DashboardToolFactory
      'write_dashboard',
      'get_user_goals',
      // ReconciliationToolFactory
      'get_reconciliation_summary',
    ];
    for (const name of existingTools) {
      expect(toolNames).toContain(name);
    }
  });

  it('exposes a unique tool name set (no duplicate registrations)', () => {
    const agent = buildAgent();
    const toolNames = agent.getTools().map((t) => t.name);
    const uniqueNames = new Set(toolNames);
    expect(uniqueNames.size).toBe(toolNames.length);
  });
});
