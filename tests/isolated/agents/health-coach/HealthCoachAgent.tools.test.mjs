import { describe, it, expect, vi } from 'vitest';

import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

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
 * Build a HealthCoachAgent wired with enough deps to register all surviving
 * factories after Task 13. Omits deps for deleted factories (HealthToolFactory,
 * ReconciliationToolFactory, ComplianceToolFactory, HealthAnalyticsToolFactory).
 */
function buildAgent() {
  const dataRoot = '/tmp/data';

  return new HealthCoachAgent({
    agentRuntime: buildAgentRuntime(),
    workingMemory: buildWorkingMemory(),
    logger: buildLogger(),
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({}),
      loadHealthData: async () => ({}),
    },
    healthService: {
      getHealthForRange: async () => ({}),
      getHealthForDate: async () => null,
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async () => ({ items: [], containerItem: {} }),
    },
    mediaProgressMemory: {},
    dataService: { user: { read: () => null, write: () => true } },
    configService: { getHeadOfHousehold: () => 'test-user' },
    personalContextLoader: { loadPlaybook: async () => null, load: async () => '' },
    dataRoot,
  });
}

describe('HealthCoachAgent — longitudinal tools registered', () => {
  it('exposes longitudinal tools (query_named_period + read_notes_file) after registration', () => {
    const agent = buildAgent();
    const toolNames = agent.getTools().map((t) => t.name);

    // Surviving tools from LongitudinalToolFactory (Task 13 trimmed the bulk
    // historical query tools; these two remain).
    const longitudinalToolNames = [
      'query_named_period',
      'read_notes_file',
    ];
    for (const name of longitudinalToolNames) {
      expect(toolNames).toContain(name);
    }
  });

  it('keeps fitness + dashboard tools registered (regression guard)', () => {
    const agent = buildAgent();
    const toolNames = agent.getTools().map((t) => t.name);

    // Tools from factories that survived Task 13.
    const existingTools = [
      // FitnessContentToolFactory
      'get_fitness_content',
      'get_program_state',
      // DashboardToolFactory
      'write_dashboard',
      'get_user_goals',
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
