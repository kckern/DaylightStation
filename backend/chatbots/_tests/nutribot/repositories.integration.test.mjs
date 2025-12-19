/**
 * Integration tests for NutriBot repositories
 * Tests actual data persistence with test mode isolation
 * @group nutribot
 * @group integration
 */

import fs from 'fs';
import path from 'path';
import { NutriLogRepository } from '../../bots/nutribot/repositories/NutriLogRepository.mjs';
import { NutriListRepository } from '../../bots/nutribot/repositories/NutriListRepository.mjs';
import { NutriBotConfig } from '../../bots/nutribot/config/NutriBotConfig.mjs';
import { NutriLog } from '../../bots/nutribot/domain/NutriLog.mjs';
import { TestContext } from '../../_lib/testing/TestContext.mjs';

// Test configuration
const testConfig = {
  bot: { name: 'nutribot', displayName: 'NutriBot' },
  telegram: { botId: '6898194425', botToken: 'test-token' },
  users: [
    {
      telegram: { botId: '6898194425', chatId: '575596036' },
      systemUser: 'testuser',
      displayName: 'Test User',
      timezone: 'America/Los_Angeles',
    },
  ],
  storage: {
    basePath: 'nutribot',
    paths: {
      nutrilog: '{userId}/nutrilog.yml',
      nutrilist: '{userId}/nutrilist.yml',
    },
  },
};

/**
 * Clean up test data directory
 */
function cleanupTestData() {
  const testDir = path.join(process.env.path.data, '_test');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe('NutriBot: Repository Integration', () => {
  let config;
  let nutriLogRepo;
  let nutriListRepo;
  const userId = 'testuser';

  beforeEach(() => {
    // Clean up before each test for isolation
    cleanupTestData();
    TestContext.enableTestMode();
    config = NutriBotConfig.from(testConfig);
    nutriLogRepo = new NutriLogRepository({ config });
    nutriListRepo = new NutriListRepository({ config });
  });

  afterEach(() => {
    cleanupTestData();
    TestContext.disableTestMode();
    TestContext.clearTrackedPaths();
  });

  describe('Path transformation', () => {
    it('should prefix paths with _test in test mode', () => {
      expect(TestContext.isTestMode()).toBe(true);
      
      const nutrilogPath = config.getNutrilogPath(userId);
      const nutrilistPath = config.getNutrilistPath(userId);
      
      expect(nutrilogPath).toBe('_test/nutribot/testuser/nutrilog.yml');
      expect(nutrilistPath).toBe('_test/nutribot/testuser/nutrilist.yml');
    });

    it('should use normal paths when test mode disabled', () => {
      TestContext.disableTestMode();
      
      const nutrilogPath = config.getNutrilogPath(userId);
      expect(nutrilogPath).toBe('nutribot/testuser/nutrilog.yml');
    });
  });

  describe('NutriLogRepository', () => {
    describe('save and findById', () => {
      it('should save and retrieve a NutriLog', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:b6898194425_c575596036',
          text: 'Oatmeal with berries for breakfast',
          meal: { date: '2025-06-01', time: 'morning' },
          items: [
            { label: 'Oatmeal', icon: 'oatmeal', grams: 100, unit: 'g', amount: 100, color: 'green' },
            { label: 'Mixed Berries', icon: 'berry', grams: 120, unit: 'g', amount: 120, color: 'green' },
          ],
        });

        await nutriLogRepo.save(log);

        const retrieved = await nutriLogRepo.findById(userId, log.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved.id).toBe(log.id);
        expect(retrieved.text).toBe('Oatmeal with berries for breakfast');
        expect(retrieved.items).toHaveLength(2);
        expect(retrieved.status).toBe('pending');
      });
    });

    describe('findAll with filters', () => {
      beforeEach(async () => {
        // Create multiple logs for testing filters
        const logs = [
          NutriLog.create({
            userId,
            conversationId: 'telegram:test',
            text: 'Breakfast day 1',
            meal: { date: '2025-06-01', time: 'morning' },
            items: [{ label: 'Toast', icon: 'toast', grams: 50, unit: 'g', amount: 2, color: 'yellow' }],
          }),
          NutriLog.create({
            userId,
            conversationId: 'telegram:test',
            text: 'Lunch day 1',
            meal: { date: '2025-06-01', time: 'afternoon' },
            items: [{ label: 'Salad', icon: 'salad', grams: 200, unit: 'g', amount: 200, color: 'green' }],
          }),
          NutriLog.create({
            userId,
            conversationId: 'telegram:test',
            text: 'Breakfast day 2',
            meal: { date: '2025-06-02', time: 'morning' },
            items: [{ label: 'Eggs', icon: 'egg', grams: 150, unit: 'g', amount: 150, color: 'yellow' }],
          }),
        ];

        for (const log of logs) {
          await nutriLogRepo.save(log);
        }
      });

      it('should find all logs for user', async () => {
        const logs = await nutriLogRepo.findAll(userId);
        expect(logs).toHaveLength(3);
      });

      it('should filter by date', async () => {
        const logs = await nutriLogRepo.findByDate(userId, '2025-06-01');
        expect(logs).toHaveLength(2);
      });

      it('should filter by date range', async () => {
        const logs = await nutriLogRepo.findByDateRange(userId, '2025-06-01', '2025-06-01');
        expect(logs).toHaveLength(2);
      });

      it('should filter by status', async () => {
        const pending = await nutriLogRepo.findPending(userId);
        expect(pending).toHaveLength(3);
        
        const accepted = await nutriLogRepo.findAccepted(userId);
        expect(accepted).toHaveLength(0);
      });
    });

    describe('status transitions', () => {
      it('should accept a log and update storage', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Test meal',
          items: [{ label: 'Apple', icon: 'apple', grams: 150, unit: 'g', amount: 1, color: 'green' }],
        });

        await nutriLogRepo.save(log);
        
        // Accept the log
        const accepted = log.accept();
        await nutriLogRepo.save(accepted);

        // Verify it's accepted
        const retrieved = await nutriLogRepo.findById(userId, log.id);
        expect(retrieved.isAccepted).toBe(true);
        expect(retrieved.acceptedAt).toBeTruthy();
      });
    });

    describe('delete', () => {
      it('should soft delete a log', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'To be deleted',
          items: [],
        });

        await nutriLogRepo.save(log);
        await nutriLogRepo.delete(userId, log.id);

        const retrieved = await nutriLogRepo.findById(userId, log.id);
        expect(retrieved.isDeleted).toBe(true);
      });

      it('should hard delete a log', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'To be hard deleted',
          items: [],
        });

        await nutriLogRepo.save(log);
        const result = await nutriLogRepo.hardDelete(userId, log.id);
        
        expect(result).toBe(true);
        
        const retrieved = await nutriLogRepo.findById(userId, log.id);
        expect(retrieved).toBeNull();
      });
    });

    describe('getDailySummary', () => {
      it('should summarize daily nutrition', async () => {
        // Create and accept logs for one day
        const log1 = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Breakfast',
          meal: { date: '2025-06-01', time: 'morning' },
          items: [
            { label: 'Oatmeal', icon: 'oatmeal', grams: 100, unit: 'g', amount: 100, color: 'green' },
            { label: 'Yogurt', icon: 'yogurt', grams: 200, unit: 'g', amount: 200, color: 'yellow' },
          ],
        }).accept();

        const log2 = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Lunch',
          meal: { date: '2025-06-01', time: 'afternoon' },
          items: [
            { label: 'Chicken', icon: 'chicken', grams: 150, unit: 'g', amount: 150, color: 'yellow' },
            { label: 'Oil', icon: 'oil', grams: 15, unit: 'ml', amount: 15, color: 'orange' },
          ],
        }).accept();

        await nutriLogRepo.save(log1);
        await nutriLogRepo.save(log2);

        const summary = await nutriLogRepo.getDailySummary(userId, '2025-06-01');

        expect(summary.date).toBe('2025-06-01');
        expect(summary.logCount).toBe(2);
        expect(summary.itemCount).toBe(4);
        expect(summary.totalGrams).toBe(465); // 100+200+150+15
        expect(summary.colorCounts).toEqual({ green: 1, yellow: 2, orange: 1 });
        expect(summary.meals.morning).toHaveLength(1);
        expect(summary.meals.afternoon).toHaveLength(1);
      });
    });
  });

  describe('NutriListRepository', () => {
    describe('syncFromLog', () => {
      it('should add items when log is accepted', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Breakfast',
          items: [
            { label: 'Oatmeal', icon: 'oatmeal', grams: 100, unit: 'g', amount: 100, color: 'green' },
            { label: 'Berries', icon: 'berry', grams: 120, unit: 'g', amount: 120, color: 'green' },
          ],
        }).accept();

        await nutriListRepo.syncFromLog(log);

        const items = await nutriListRepo.findAll(userId);
        expect(items).toHaveLength(2);
        expect(items[0].logId).toBe(log.id);
        expect(items[0].label).toBe('Oatmeal');
      });

      it('should not add items for pending logs', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Pending meal',
          items: [
            { label: 'Toast', icon: 'toast', grams: 50, unit: 'g', amount: 50, color: 'yellow' },
          ],
        });

        await nutriListRepo.syncFromLog(log);

        const items = await nutriListRepo.findAll(userId);
        expect(items).toHaveLength(0);
      });

      it('should update items when log changes', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Meal',
          items: [
            { label: 'Apple', icon: 'apple', grams: 150, unit: 'g', amount: 1, color: 'green' },
          ],
        }).accept();

        await nutriListRepo.syncFromLog(log);

        // Modify and re-sync
        const updated = log.addItem({
          id: '00000000-0000-0000-0000-000000000001',
          label: 'Banana',
          icon: 'banana',
          grams: 120,
          unit: 'g',
          amount: 1,
          color: 'green',
        });

        await nutriListRepo.syncFromLog(updated);

        const items = await nutriListRepo.findAll(userId);
        expect(items).toHaveLength(2);
      });
    });

    describe('queries', () => {
      beforeEach(async () => {
        // Create accepted logs with various items
        const log1 = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Healthy meal',
          items: [
            { label: 'Broccoli', icon: 'broccoli', grams: 100, unit: 'g', amount: 100, color: 'green' },
            { label: 'Chicken', icon: 'chicken', grams: 200, unit: 'g', amount: 200, color: 'yellow' },
          ],
        }).accept();

        const log2 = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Snack',
          items: [
            { label: 'Nuts', icon: 'nuts', grams: 30, unit: 'g', amount: 30, color: 'orange' },
          ],
        }).accept();

        await nutriListRepo.syncFromLog(log1);
        await nutriListRepo.syncFromLog(log2);
      });

      it('should find all accepted items', async () => {
        const items = await nutriListRepo.findAccepted(userId);
        expect(items).toHaveLength(3);
      });

      it('should find items by color', async () => {
        const greenItems = await nutriListRepo.findByColor(userId, 'green');
        expect(greenItems).toHaveLength(1);
        expect(greenItems[0].label).toBe('Broccoli');
      });

      it('should get grams by color', async () => {
        const grams = await nutriListRepo.getGramsByColor(userId);
        expect(grams.green).toBe(100);
        expect(grams.yellow).toBe(200);
        expect(grams.orange).toBe(30);
      });

      it('should get count by color', async () => {
        const counts = await nutriListRepo.getCountByColor(userId);
        expect(counts.green).toBe(1);
        expect(counts.yellow).toBe(1);
        expect(counts.orange).toBe(1);
      });
    });

    describe('removeByLogId', () => {
      it('should remove all items for a log', async () => {
        const log = NutriLog.create({
          userId,
          conversationId: 'telegram:test',
          text: 'Meal',
          items: [
            { label: 'Item1', icon: 'default', grams: 100, unit: 'g', amount: 100, color: 'green' },
            { label: 'Item2', icon: 'default', grams: 100, unit: 'g', amount: 100, color: 'green' },
          ],
        }).accept();

        await nutriListRepo.syncFromLog(log);
        expect(await nutriListRepo.findAll(userId)).toHaveLength(2);

        const removed = await nutriListRepo.removeByLogId(userId, log.id);
        expect(removed).toBe(2);
        expect(await nutriListRepo.findAll(userId)).toHaveLength(0);
      });
    });
  });

  describe('End-to-end workflow', () => {
    it('should handle complete food logging workflow', async () => {
      // 1. User logs a meal
      const log = NutriLog.create({
        userId,
        conversationId: 'telegram:b6898194425_c575596036',
        text: 'Had oatmeal with berries and coffee for breakfast',
        meal: { date: '2025-06-15', time: 'morning' },
        items: [
          { label: 'Oatmeal', icon: 'oatmeal', grams: 100, unit: 'g', amount: 100, color: 'green' },
          { label: 'Mixed Berries', icon: 'berry', grams: 150, unit: 'g', amount: 150, color: 'green' },
          { label: 'Black Coffee', icon: 'coffee', grams: 250, unit: 'ml', amount: 250, color: 'green' },
        ],
      });

      // 2. Save pending log
      await nutriLogRepo.save(log);
      
      // Verify pending state
      const pending = await nutriLogRepo.findPending(userId);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(log.id);

      // 3. User confirms (accepts) the log
      const accepted = log.accept();
      await nutriLogRepo.save(accepted);
      
      // 4. Sync to nutrilist
      await nutriListRepo.syncFromLog(accepted);

      // 5. Verify final state
      const allLogs = await nutriLogRepo.findAll(userId);
      expect(allLogs).toHaveLength(1);
      expect(allLogs[0].isAccepted).toBe(true);

      const allItems = await nutriListRepo.findAll(userId);
      expect(allItems).toHaveLength(3);

      const summary = await nutriLogRepo.getDailySummary(userId, '2025-06-15');
      expect(summary.logCount).toBe(1);
      expect(summary.itemCount).toBe(3);
      expect(summary.colorCounts.green).toBe(3);
      expect(summary.totalGrams).toBe(500);
    });
  });
});
