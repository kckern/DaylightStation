// backend/tests/unit/agents/health-coach/DailyDashboard.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DailyDashboard } from '../../../../src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('DailyDashboard', () => {
  const validDashboard = {
    generated_at: '2026-02-14T04:00:00Z',
    curated: {
      up_next: {
        primary: { content_id: 'plex:101', title: 'Chest & Back', duration: 60 },
        alternates: [
          { content_id: 'plex:102', title: 'Yoga', duration: 45, reason: 'rest_day_option' },
        ],
      },
    },
    coach: {
      briefing: 'Down 1.2 lbs this week. Solid protein yesterday.',
      cta: [{ type: 'data_gap', message: 'No meals logged yesterday.', action: 'open_nutrition' }],
    },
  };

  let mockTools;

  beforeEach(() => {
    mockTools = [
      { name: 'get_weight_trend', execute: async () => ({ current: { lbs: 182.3 }, trend: { sevenDay: -1.2 }, history: [] }) },
      { name: 'get_today_nutrition', execute: async () => ({ logged: true, calories: 2100, protein: 140 }) },
      { name: 'get_nutrition_history', execute: async () => ({ days: [], averages: { calories: 2050, protein: 135 } }) },
      { name: 'get_recent_workouts', execute: async () => ({ workouts: [{ date: '2026-02-13', title: 'Chest & Back' }], totalThisWeek: 3 }) },
      { name: 'get_fitness_content', execute: async () => ({ show: { id: 'plex:12345' }, episodes: [{ id: 'plex:101', title: 'Chest & Back', duration: 60 }] }) },
      { name: 'get_program_state', execute: async () => ({ program: { id: 'p90x', current_day: 23, status: 'active', content_source: 'plex:12345' } }) },
      { name: 'get_user_goals', execute: async () => ({ goals: { weight: { target_lbs: 175 } } }) },
      { name: 'write_dashboard', execute: async () => ({ success: true }) },
      { name: 'log_coaching_note', execute: async () => ({ success: true }) },
    ];
  });

  describe('static properties', () => {
    it('should have correct id and schedule', () => {
      assert.strictEqual(DailyDashboard.id, 'daily-dashboard');
      assert.strictEqual(DailyDashboard.schedule, '0 4 * * *');
    });
  });

  describe('gather', () => {
    it('should call tools and return gathered data', async () => {
      const assignment = new DailyDashboard();
      const result = await assignment.gather({
        tools: mockTools,
        userId: 'kckern',
        memory: new WorkingMemoryState(),
        logger: { info: () => {} },
      });

      assert.ok(result.weight, 'Should have weight data');
      assert.ok(result.nutrition, 'Should have nutrition data');
      assert.ok(result.workouts, 'Should have workout data');
      assert.ok(result.content, 'Should have fitness content');
      assert.ok(result.programState, 'Should have program state');
      assert.ok(result.goals, 'Should have user goals');
    });

    it('should handle missing tools gracefully', async () => {
      const assignment = new DailyDashboard();
      const result = await assignment.gather({
        tools: [], // no tools
        userId: 'kckern',
        memory: new WorkingMemoryState(),
        logger: { info: () => {}, warn: () => {} },
      });

      // Should not throw, missing tools produce null
      assert.ok(result);
    });
  });

  describe('buildPrompt', () => {
    it('should include gathered data in the prompt', () => {
      const assignment = new DailyDashboard();
      const gathered = {
        weight: { current: { lbs: 182 } },
        nutrition: { calories: 2100 },
        workouts: { workouts: [] },
        content: { episodes: [] },
        programState: { program: null },
        goals: { goals: null },
      };

      const prompt = assignment.buildPrompt(gathered, new WorkingMemoryState());
      assert.ok(prompt.includes('182'), 'Should contain weight data');
      assert.ok(prompt.includes('2100'), 'Should contain nutrition data');
    });
  });

  describe('getOutputSchema', () => {
    it('should return the dashboard schema', () => {
      const assignment = new DailyDashboard();
      const schema = assignment.getOutputSchema();

      assert.strictEqual(schema.type, 'object');
      assert.ok(schema.required.includes('generated_at'));
      assert.ok(schema.required.includes('curated'));
      assert.ok(schema.required.includes('coach'));
    });
  });

  describe('validate', () => {
    it('should accept valid dashboard output', async () => {
      const assignment = new DailyDashboard();
      const raw = { output: JSON.stringify(validDashboard), toolCalls: [] };
      const gathered = { content: { episodes: [{ id: 'plex:101' }, { id: 'plex:102' }] } };

      const result = await assignment.validate(raw, gathered, { warn: () => {} });
      assert.ok(result, 'Should return validated data');
      assert.strictEqual(result.coach.briefing, validDashboard.coach.briefing);
    });

    it('should throw on invalid schema', async () => {
      const assignment = new DailyDashboard();
      const raw = { output: JSON.stringify({ bad: 'data' }), toolCalls: [] };

      await assert.rejects(
        () => assignment.validate(raw, {}, { warn: () => {} }),
        /validation/i
      );
    });
  });

  describe('full lifecycle', () => {
    it('should execute end-to-end with mocked dependencies', async () => {
      const assignment = new DailyDashboard();
      let dashboardWritten = false;

      // Override write_dashboard to track
      const writeTool = mockTools.find(t => t.name === 'write_dashboard');
      writeTool.execute = async ({ dashboard }) => {
        dashboardWritten = true;
        return { success: true };
      };

      const result = await assignment.execute({
        agentRuntime: {
          execute: async () => ({ output: JSON.stringify(validDashboard), toolCalls: [] }),
        },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async () => {},
        },
        tools: mockTools,
        systemPrompt: 'test',
        agentId: 'health-coach',
        userId: 'kckern',
        context: {},
        logger: { info: () => {}, warn: () => {} },
      });

      assert.ok(result);
      // Note: dashboardWritten will be false because act() doesn't call write_dashboard tool directly.
      // The HealthCoachAgent orchestrator handles persistence after execute() returns.
      // We verify the validated result is returned correctly instead.
      assert.strictEqual(result.coach.briefing, validDashboard.coach.briefing);
      assert.strictEqual(result.curated.up_next.primary.content_id, 'plex:101');
    });
  });
});
