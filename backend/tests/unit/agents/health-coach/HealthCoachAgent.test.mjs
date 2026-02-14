// backend/tests/unit/agents/health-coach/HealthCoachAgent.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HealthCoachAgent } from '../../../../src/3_applications/agents/health-coach/HealthCoachAgent.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('HealthCoachAgent', () => {
  let mockRuntime;
  let mockWorkingMemory;
  let mockLogger;
  let mockDeps;

  beforeEach(() => {
    mockRuntime = {
      execute: async () => ({ output: 'response', toolCalls: [] }),
    };

    mockWorkingMemory = {
      load: async () => new WorkingMemoryState(),
      save: async () => {},
    };

    mockLogger = { info: () => {}, error: () => {}, warn: () => {} };

    mockDeps = {
      agentRuntime: mockRuntime,
      workingMemory: mockWorkingMemory,
      logger: mockLogger,
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
      dataService: {
        user: {
          read: () => null,
          write: () => true,
        },
      },
      configService: {
        getHeadOfHousehold: () => 'kckern',
      },
    };
  });

  describe('static properties', () => {
    it('should have correct id', () => {
      assert.strictEqual(HealthCoachAgent.id, 'health-coach');
    });

    it('should have a description', () => {
      assert.ok(HealthCoachAgent.description);
    });
  });

  describe('constructor', () => {
    it('should create with valid dependencies', () => {
      const agent = new HealthCoachAgent(mockDeps);
      assert.ok(agent);
    });
  });

  describe('getTools', () => {
    it('should return tools from all three factories', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const tools = agent.getTools();

      const names = tools.map(t => t.name);
      // Health tools
      assert.ok(names.includes('get_weight_trend'));
      assert.ok(names.includes('get_today_nutrition'));
      // Fitness content tools
      assert.ok(names.includes('get_fitness_content'));
      assert.ok(names.includes('get_program_state'));
      // Dashboard tools
      assert.ok(names.includes('write_dashboard'));
      assert.ok(names.includes('get_user_goals'));
    });

    it('should have 11 total tools', () => {
      const agent = new HealthCoachAgent(mockDeps);
      assert.strictEqual(agent.getTools().length, 11);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const prompt = agent.getSystemPrompt();
      assert.ok(typeof prompt === 'string');
      assert.ok(prompt.length > 100);
    });
  });

  describe('getAssignments', () => {
    it('should include daily-dashboard assignment', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const assignments = agent.getAssignments();

      assert.strictEqual(assignments.length, 1);
      assert.strictEqual(assignments[0].constructor.id, 'daily-dashboard');
    });
  });

  describe('runAssignment', () => {
    it('should inject default userId when not provided', async () => {
      let capturedUserId;

      mockRuntime.execute = async ({ context }) => {
        capturedUserId = context?.userId;
        return {
          output: JSON.stringify({
            generated_at: new Date().toISOString(),
            curated: { up_next: { primary: { content_id: 'plex:1', title: 'Test', duration: 30 } } },
            coach: { briefing: 'Test.' },
          }),
          toolCalls: [],
        };
      };

      const agent = new HealthCoachAgent(mockDeps);

      try {
        await agent.runAssignment('daily-dashboard', {});
      } catch {
        // May fail on write — that's OK, we just check userId was injected
      }

      assert.strictEqual(capturedUserId, 'kckern');
    });
  });
});
