// tests/unit/domains/nutrition/services/FoodLogService.test.mjs
import { jest } from '@jest/globals';
import { FoodLogService } from '../../../../../backend/src/1_domains/nutrition/services/FoodLogService.mjs';
import { NutriLog } from '../../../../../backend/src/1_domains/nutrition/entities/NutriLog.mjs';

describe('FoodLogService', () => {
  let service;
  let mockStore;

  // Helper to create test NutriLog
  const createTestLog = (overrides = {}) => {
    return NutriLog.create({
      userId: 'user-1',
      text: 'Test food',
      items: [
        {
          label: 'Apple',
          grams: 150,
          color: 'green',
          icon: 'apple',
          unit: 'g',
          amount: 150,
        },
      ],
      meal: {
        date: '2026-01-11',
        time: 'morning',
      },
      ...overrides,
    });
  };

  beforeEach(() => {
    mockStore = {
      save: jest.fn((log) => Promise.resolve(log)),
      findById: jest.fn(),
      findAll: jest.fn(),
      findByDate: jest.fn(),
      findByDateRange: jest.fn(),
      findPending: jest.fn(),
      findAccepted: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      getDailySummary: jest.fn(),
    };

    service = new FoodLogService({ foodLogStore: mockStore });
  });

  describe('getLogsByDate', () => {
    test('returns logs for a specific date', async () => {
      const testLog = createTestLog();
      mockStore.findByDate.mockResolvedValue([testLog]);

      const logs = await service.getLogsByDate('user-1', '2026-01-11');

      expect(logs).toHaveLength(1);
      expect(mockStore.findByDate).toHaveBeenCalledWith('user-1', '2026-01-11');
    });

    test('returns empty array for date with no logs', async () => {
      mockStore.findByDate.mockResolvedValue([]);

      const logs = await service.getLogsByDate('user-1', '2026-01-11');

      expect(logs).toEqual([]);
    });
  });

  describe('getLogById', () => {
    test('returns log by ID', async () => {
      const testLog = createTestLog();
      mockStore.findById.mockResolvedValue(testLog);

      const log = await service.getLogById('user-1', testLog.id);

      expect(log).toBe(testLog);
      expect(mockStore.findById).toHaveBeenCalledWith('user-1', testLog.id);
    });

    test('returns null for nonexistent log', async () => {
      mockStore.findById.mockResolvedValue(null);

      const log = await service.getLogById('user-1', 'nonexistent');

      expect(log).toBeNull();
    });
  });

  describe('createLog', () => {
    test('creates and saves a new log', async () => {
      const props = {
        userId: 'user-1',
        text: 'Breakfast: eggs and toast',
        items: [
          { label: 'Eggs', grams: 100, color: 'yellow', icon: 'egg', unit: 'g', amount: 100 },
        ],
      };

      const log = await service.createLog(props);

      expect(log.userId).toBe('user-1');
      expect(log.status).toBe('pending');
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('acceptLog', () => {
    test('accepts a pending log', async () => {
      const testLog = createTestLog();
      mockStore.findById.mockResolvedValue(testLog);
      mockStore.save.mockImplementation((log) => Promise.resolve(log));

      const accepted = await service.acceptLog('user-1', testLog.id);

      expect(accepted.status).toBe('accepted');
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('throws for nonexistent log', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(
        service.acceptLog('user-1', 'nonexistent')
      ).rejects.toThrow('NutriLog not found');
    });
  });

  describe('rejectLog', () => {
    test('rejects a pending log', async () => {
      const testLog = createTestLog();
      mockStore.findById.mockResolvedValue(testLog);
      mockStore.save.mockImplementation((log) => Promise.resolve(log));

      const rejected = await service.rejectLog('user-1', testLog.id);

      expect(rejected.status).toBe('rejected');
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('deleteLog', () => {
    test('soft deletes a log', async () => {
      const testLog = createTestLog();
      mockStore.findById.mockResolvedValue(testLog);
      mockStore.save.mockImplementation((log) => Promise.resolve(log));

      const deleted = await service.deleteLog('user-1', testLog.id);

      expect(deleted.status).toBe('deleted');
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('getPendingLogs', () => {
    test('returns pending logs', async () => {
      const testLog = createTestLog();
      mockStore.findPending.mockResolvedValue([testLog]);

      const logs = await service.getPendingLogs('user-1');

      expect(logs).toHaveLength(1);
      expect(mockStore.findPending).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getAcceptedLogs', () => {
    test('returns accepted logs', async () => {
      const testLog = createTestLog();
      const accepted = testLog.accept();
      mockStore.findAccepted.mockResolvedValue([accepted]);

      const logs = await service.getAcceptedLogs('user-1');

      expect(logs).toHaveLength(1);
      expect(mockStore.findAccepted).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getLogsInRange', () => {
    test('returns logs in date range', async () => {
      const log1 = createTestLog({ meal: { date: '2026-01-10', time: 'morning' } });
      const log2 = createTestLog({ meal: { date: '2026-01-11', time: 'morning' } });
      mockStore.findByDateRange.mockResolvedValue([log1, log2]);

      const logs = await service.getLogsInRange('user-1', '2026-01-10', '2026-01-11');

      expect(logs).toHaveLength(2);
      expect(mockStore.findByDateRange).toHaveBeenCalledWith('user-1', '2026-01-10', '2026-01-11');
    });
  });

  describe('getDailySummary', () => {
    test('delegates to store', async () => {
      const summary = {
        date: '2026-01-11',
        logCount: 2,
        itemCount: 5,
        totalGrams: 500,
      };
      mockStore.getDailySummary.mockResolvedValue(summary);

      const result = await service.getDailySummary('user-1', '2026-01-11');

      expect(result).toEqual(summary);
      expect(mockStore.getDailySummary).toHaveBeenCalledWith('user-1', '2026-01-11');
    });
  });

  describe('getWeeklySummary', () => {
    test('calculates weekly summary', async () => {
      const log1 = createTestLog({ meal: { date: '2026-01-06', time: 'morning' } });
      const log2 = createTestLog({ meal: { date: '2026-01-07', time: 'morning' } });
      // Accept both logs for the summary
      const accepted1 = log1.accept();
      const accepted2 = log2.accept();
      mockStore.findByDateRange.mockResolvedValue([accepted1, accepted2]);

      const summary = await service.getWeeklySummary('user-1', '2026-01-06');

      expect(summary.weekStart).toBe('2026-01-06');
      expect(summary.daysLogged).toBe(2);
      expect(summary.totalLogs).toBe(2);
      expect(summary.totalItems).toBe(2);
    });
  });

  describe('updateLogItems', () => {
    test('updates log items', async () => {
      const testLog = createTestLog();
      mockStore.findById.mockResolvedValue(testLog);
      mockStore.save.mockImplementation((log) => Promise.resolve(log));

      const newItems = [
        { id: 'aBcDeFgHiJ', uuid: '550e8400-e29b-41d4-a716-446655440000', label: 'Banana', grams: 120, color: 'yellow', icon: 'banana', unit: 'g', amount: 120 },
      ];

      const updated = await service.updateLogItems('user-1', testLog.id, newItems);

      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].label).toBe('Banana');
      expect(mockStore.save).toHaveBeenCalled();
    });
  });
});
