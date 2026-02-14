// backend/tests/unit/agents/health-coach/DashboardToolFactory.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DashboardToolFactory } from '../../../../src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs';

describe('DashboardToolFactory', () => {
  let factory;
  let mockDataService;
  let mockHealthStore;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: (path, userId) => {
          if (path.includes('goals')) {
            return { weight: { target_lbs: 175 }, nutrition: { daily_calories: 2200, daily_protein: 145 } };
          }
          return null;
        },
        write: () => true,
      },
    };

    mockHealthStore = {
      loadCoachingData: async () => ({}),
      saveCoachingData: async () => {},
    };

    factory = new DashboardToolFactory({ dataService: mockDataService, healthStore: mockHealthStore });
  });

  describe('createTools', () => {
    it('should return 3 tools', () => {
      const tools = factory.createTools();
      assert.strictEqual(tools.length, 3);

      const names = tools.map(t => t.name);
      assert.ok(names.includes('write_dashboard'));
      assert.ok(names.includes('get_user_goals'));
      assert.ok(names.includes('log_coaching_note'));
    });
  });

  describe('write_dashboard', () => {
    it('should write dashboard data via DataService', async () => {
      let writtenPath, writtenData, writtenUser;
      mockDataService.user.write = (path, data, userId) => {
        writtenPath = path;
        writtenData = data;
        writtenUser = userId;
        return true;
      };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'write_dashboard');
      const dashboard = { generated_at: '2026-02-14T04:00:00Z', curated: {}, coach: { briefing: 'hi' } };

      const result = await tool.execute({ userId: 'kckern', date: '2026-02-14', dashboard });

      assert.ok(result.success);
      assert.ok(writtenPath.includes('health-dashboard/2026-02-14'));
      assert.strictEqual(writtenUser, 'kckern');
      assert.strictEqual(writtenData.generated_at, '2026-02-14T04:00:00Z');
    });
  });

  describe('get_user_goals', () => {
    it('should return goals from DataService', async () => {
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_user_goals');
      const result = await tool.execute({ userId: 'kckern' });

      assert.ok(result.goals);
      assert.strictEqual(result.goals.weight.target_lbs, 175);
    });

    it('should return null when no goals set', async () => {
      mockDataService.user.read = () => null;
      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'get_user_goals');
      const result = await tool.execute({ userId: 'kckern' });

      assert.strictEqual(result.goals, null);
    });
  });

  describe('log_coaching_note', () => {
    it('should save coaching note via healthStore', async () => {
      let savedData;
      mockHealthStore.saveCoachingData = async (userId, data) => { savedData = data; };

      const tools = factory.createTools();
      const tool = tools.find(t => t.name === 'log_coaching_note');
      const result = await tool.execute({
        userId: 'kckern',
        date: '2026-02-14',
        note: { type: 'observation', text: 'Consistent workout pattern this week' },
      });

      assert.ok(result.success);
    });
  });
});
