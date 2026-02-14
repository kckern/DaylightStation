// backend/tests/unit/agents/health-coach/HealthToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HealthToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs';

describe('HealthToolFactory', () => {
  let factory;
  let mockHealthStore;
  let mockHealthService;

  const sampleWeight = {
    '2026-02-14': {
      date: '2026-02-14', lbs: 182.3, lbs_adjusted_average: 182.0,
      lbs_adjusted_average_7day_trend: -1.2, fat_percent: 15.2, fat_percent_average: 15.1,
    },
    '2026-02-13': {
      date: '2026-02-13', lbs: 182.8, lbs_adjusted_average: 182.5,
      lbs_adjusted_average_7day_trend: -1.0, fat_percent: 15.3, fat_percent_average: 15.2,
    },
  };

  const sampleHealth = {
    '2026-02-14': {
      date: '2026-02-14',
      weight: { lbs: 182.3, fatPercent: 15.2, trend: -1.2 },
      nutrition: { calories: 2100, protein: 140, carbs: 210, fat: 70, foodCount: 8 },
      workouts: [
        { source: 'strava', title: 'Morning Run', type: 'run', duration: 30, calories: 350, avgHr: 145 },
      ],
    },
  };

  beforeEach(() => {
    mockHealthStore = {
      loadWeightData: async () => sampleWeight,
      loadNutritionData: async () => ({
        '2026-02-14': { calories: 2100, protein: 140, carbs: 210, fat: 70, foodCount: 8 },
        '2026-02-13': { calories: 1900, protein: 120, carbs: 200, fat: 65, foodCount: 6 },
      }),
      loadCoachingData: async () => ({}),
      saveCoachingData: async () => {},
    };

    mockHealthService = {
      getHealthForRange: async () => sampleHealth,
      getHealthForDate: async () => sampleHealth['2026-02-14'],
    };

    factory = new HealthToolFactory({ healthStore: mockHealthStore, healthService: mockHealthService });
  });

  describe('createTools', () => {
    it('should return the expected tools', () => {
      const tools = factory.createTools();
      const names = tools.map(t => t.name);

      assert.ok(names.includes('get_weight_trend'));
      assert.ok(names.includes('get_today_nutrition'));
      assert.ok(names.includes('get_nutrition_history'));
      assert.ok(names.includes('get_recent_workouts'));
      assert.ok(names.includes('get_health_summary'));
    });

    it('should have 5 tools', () => {
      assert.strictEqual(factory.createTools().length, 5);
    });
  });

  describe('get_weight_trend', () => {
    it('should return weight data with current and trend', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern', days: 7 });

      assert.ok(result.current, 'Should have current weight');
      assert.ok(result.current.lbs, 'Should have lbs');
      assert.ok(result.history, 'Should have history array');
      assert.ok(Array.isArray(result.history));
    });

    it('should return graceful empty when no data', async () => {
      mockHealthStore.loadWeightData = async () => ({});
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.current, null);
      assert.deepStrictEqual(result.history, []);
    });
  });

  describe('get_today_nutrition', () => {
    it('should return today nutrition data', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_today_nutrition');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.calories !== undefined);
      assert.ok(result.protein !== undefined);
    });
  });

  describe('get_recent_workouts', () => {
    it('should return workouts from health data', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_recent_workouts');
      const result = await tool.execute({ userId: 'kckern', days: 7 });

      assert.ok(Array.isArray(result.workouts));
    });
  });

  describe('error handling', () => {
    it('should return error object when service throws', async () => {
      mockHealthStore.loadWeightData = async () => { throw new Error('Service unavailable'); };
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_weight_trend');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.error, 'Should have error field');
      assert.strictEqual(result.current, null);
    });
  });
});
