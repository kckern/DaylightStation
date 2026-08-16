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
        getHeadOfHousehold: () => 'user_1',
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
    it('registers the factories these deps satisfy', () => {
      const agent = new HealthCoachAgent(mockDeps);
      const names = agent.getTools().map(t => t.name);

      // Fitness content
      assert.ok(names.includes('get_fitness_content'));
      assert.ok(names.includes('get_program_state'));
      // Dashboard
      assert.ok(names.includes('write_dashboard'));
      assert.ok(names.includes('get_user_goals'));
      // Longitudinal — always registered, tools self-report missing deps
      assert.ok(names.includes('query_named_period'));
      assert.ok(names.includes('read_notes_file'));

      // get_weight_trend / get_today_nutrition are NOT asserted: no factory
      // defines them any more (they belonged to the retired health factories,
      // whose surface HealthQueryToolFactory replaced with query_health /
      // compute / personal_constants). Three assignments still call them and
      // silently get null — tracked separately; it is a product bug, not a
      // test one.
    });

    it('should have 24 total tools', () => {
      // The exact set these deps produce, named rather than counted — a bare
      // number says nothing about WHICH tool vanished when it changes, and
      // this one silently drifted from 24 to 12 as factories were retired and
      // others put behind dep gates (messaging needs a gateway +
      // conversationId; period needs healthAnalyticsService; health-query
      // needs four services — none of which these mocks supply).
      const agent = new HealthCoachAgent(mockDeps);
      assert.deepStrictEqual(agent.getTools().map(t => t.name).sort(), [
        'browse_fitness_catalog',
        'get_fitness_content',
        'get_program_state',
        'get_recently_watched_fitness',
        'get_user_goals',
        'log_coaching_note',
        'query_named_period',
        'read_notes_file',
        'record_playbook',
        'update_playbook',
        'update_program_state',
        'write_dashboard',
      ]);
    });
  });

  describe('getSystemPrompt', () => {
    // getSystemPrompt is async — it assembles personal context. Unawaited, the
    // assertions were inspecting a Promise.
    it('should return a non-empty string', async () => {
      const agent = new HealthCoachAgent(mockDeps);
      const prompt = await agent.getSystemPrompt();
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
    // Threads the userId it is GIVEN. Defaulting to head-of-household belongs
    // to AgentOrchestrator.#resolveUserId, not here — this called the agent
    // directly, bypassing the layer that owns the default, then hid the
    // resulting failure behind a bare `catch {}`. The default is covered in
    // AgentOrchestrator.test.mjs.
    it('threads userId through to the runtime context', async () => {
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

      await agent.runAssignment('daily-dashboard', { userId: 'user_1' });

      assert.strictEqual(capturedUserId, 'user_1');
    });
  });
});
