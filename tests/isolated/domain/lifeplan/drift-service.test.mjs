import { describe, it, expect, beforeEach } from 'vitest';
import { DriftService } from '#apps/lifeplan/services/DriftService.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';
import { frozenClock } from '../../../_lib/clock-helper.mjs';

describe('DriftService', () => {
  let service;
  let mockStore;
  let mockMetrics;
  let mockAggregator;

  const plan = new LifePlan({
    values: [
      { id: 'health', name: 'Health', rank: 1 },
      { id: 'family', name: 'Family', rank: 2 },
      { id: 'craft', name: 'Craft', rank: 3 },
    ],
  });

  beforeEach(() => {
    mockStore = {
      load: vi.fn().mockReturnValue(plan),
      save: vi.fn(),
    };

    mockMetrics = {
      getLatest: vi.fn().mockReturnValue({ alignment_score: 0.85 }),
      saveSnapshot: vi.fn(),
      getHistory: vi.fn().mockReturnValue([
        { date: '2025-06-01', correlation: 0.9 },
        { date: '2025-06-08', correlation: 0.85 },
      ]),
    };

    mockAggregator = {
      aggregateRange: vi.fn().mockResolvedValue({
        days: {
          '2025-06-15': {
            sources: {
              strava: [{ duration: 60, category: 'fitness' }],
              todoist: [{ category: 'productivity' }, { category: 'productivity' }],
            },
          },
        },
      }),
    };

    service = new DriftService({
      lifePlanStore: mockStore,
      metricsStore: mockMetrics,
      aggregator: mockAggregator,
      cadenceService: new CadenceService(),
      clock: frozenClock('2025-06-15'),
    });
  });

  describe('computeAndSave()', () => {
    it('computes drift snapshot and saves to metrics store', async () => {
      const snapshot = await service.computeAndSave('testuser');

      expect(snapshot).toBeTruthy();
      expect(snapshot.date).toBe('2025-06-15');
      expect(snapshot.correlation).toBeDefined();
      expect(snapshot.status).toBeDefined();
      expect(snapshot.allocation).toBeDefined();
      expect(snapshot.period_id).toBeTruthy();
      expect(mockMetrics.saveSnapshot).toHaveBeenCalledWith('testuser', snapshot);
    });

    it('returns null when no plan exists', async () => {
      mockStore.load.mockReturnValue(null);
      const result = await service.computeAndSave('testuser');
      expect(result).toBeNull();
    });

    it('calls aggregator with cycle date range', async () => {
      await service.computeAndSave('testuser');
      expect(mockAggregator.aggregateRange).toHaveBeenCalledWith(
        'testuser',
        expect.any(String),
        '2025-06-15'
      );
    });
  });

  describe('getLatestSnapshot()', () => {
    it('returns latest from metrics store', () => {
      const latest = service.getLatestSnapshot('testuser');
      expect(latest.alignment_score).toBe(0.85);
      expect(mockMetrics.getLatest).toHaveBeenCalledWith('testuser');
    });
  });

  describe('getHistory()', () => {
    it('returns cycle-over-cycle history', () => {
      const history = service.getHistory('testuser');
      expect(history).toHaveLength(2);
      expect(mockMetrics.getHistory).toHaveBeenCalledWith('testuser');
    });
  });
});
