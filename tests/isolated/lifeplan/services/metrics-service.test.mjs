import { describe, it, expect, beforeEach } from '@jest/globals';
import { MetricsService } from '#apps/lifeplan/services/MetricsService.mjs';

describe('MetricsService', () => {
  let service;
  let mockAggregator;
  let mockMetricsStore;
  let mockPlanStore;
  let savedSnapshots;

  beforeEach(() => {
    savedSnapshots = [];

    mockAggregator = {
      aggregateRange: async (username, start, end) => ({
        startDate: start,
        endDate: end,
        days: {
          '2025-06-01': {
            sources: {
              strava: [
                { title: 'Morning Run', type: 'Run', duration: 45, sufferScore: 80 },
                { title: 'Evening Ride', type: 'Ride', duration: 90, sufferScore: 120 },
              ],
              calendar: [
                { summary: 'Workshop', duration: 5, time: '9:00 AM' },
                { summary: 'Standup', duration: 0.5, time: '10:00 AM' },
              ],
            },
            categories: {
              fitness: { strava: [{ duration: 45 }, { duration: 90 }] },
              calendar: { calendar: [{ duration: 300 }, { duration: 30 }] },
            },
            summaries: [],
          },
          '2025-06-02': {
            sources: {
              strava: [
                { title: 'Long Run', type: 'Run', duration: 120, sufferScore: 150 },
              ],
            },
            categories: {
              fitness: { strava: [{ duration: 120 }] },
            },
            summaries: [],
          },
          '2025-06-03': {
            sources: {},
            categories: {},
            summaries: [],
          },
        },
        _meta: { username: 'testuser', dayCount: 3, availableSources: ['strava', 'calendar'] },
      }),
    };

    mockMetricsStore = {
      saveSnapshot: (username, snapshot) => savedSnapshots.push({ username, ...snapshot }),
      getHistory: () => savedSnapshots,
    };

    mockPlanStore = {
      load: () => ({
        values: [
          { id: 'v1', name: 'Health', rank: 1, tracked_categories: ['fitness'] },
          { id: 'v2', name: 'Growth', rank: 2, tracked_categories: ['calendar'] },
        ],
      }),
    };

    service = new MetricsService({
      aggregator: mockAggregator,
      metricsStore: mockMetricsStore,
      planStore: mockPlanStore,
      clock: { now: () => new Date('2025-07-01T00:00:00Z') },
    });
  });

  it('computes monthly rollup with category minutes', async () => {
    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    expect(rollup.month).toBe('2025-06');
    expect(rollup.startDate).toBe('2025-06-01');
    expect(rollup.endDate).toBe('2025-06-30');
    expect(rollup.dayCount).toBe(3);
    expect(rollup.activeDays).toBe(2);
  });

  it('aggregates source minutes', async () => {
    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    expect(rollup.sourceMinutes.strava).toBe(255); // 45 + 90 + 120
    expect(rollup.sourceMinutes.calendar).toBe(5.5); // 5 + 0.5 (duration in hours for calendar)
  });

  it('extracts highlights sorted by metric', async () => {
    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    expect(rollup.highlights.length).toBeGreaterThan(0);
    // Long Run (120min) and Evening Ride (90min, sufferScore 120) should be highlighted
    const longRun = rollup.highlights.find(h => h.text.includes('Long Run'));
    expect(longRun).toBeDefined();
    expect(longRun.date).toBe('2025-06-02');
  });

  it('computes value allocation from plan', async () => {
    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    expect(rollup.valueAllocation.v1).toBeDefined();
    expect(rollup.valueAllocation.v1.rank).toBe(1);
    expect(rollup.valueAllocation.v1.minutes).toBeGreaterThan(0);
  });

  it('saves rollup to metrics store', async () => {
    await service.computeMonthlyRollup('testuser', '2025-06');

    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0].type).toBe('monthly_rollup');
    expect(savedSnapshots[0].month).toBe('2025-06');
  });

  it('retrieves latest rollup', async () => {
    await service.computeMonthlyRollup('testuser', '2025-06');

    const latest = service.getLatestRollup('testuser');
    expect(latest).toBeDefined();
    expect(latest.month).toBe('2025-06');
  });

  it('retrieves rollup for specific month', async () => {
    await service.computeMonthlyRollup('testuser', '2025-06');

    const rollup = service.getRollupForMonth('testuser', '2025-06');
    expect(rollup).toBeDefined();
    expect(rollup.month).toBe('2025-06');

    const missing = service.getRollupForMonth('testuser', '2025-07');
    expect(missing).toBeNull();
  });

  it('handles empty lifelog data gracefully', async () => {
    mockAggregator.aggregateRange = async () => ({
      startDate: '2025-07-01', endDate: '2025-07-31',
      days: {},
      _meta: { dayCount: 0, availableSources: [] },
    });

    const rollup = await service.computeMonthlyRollup('testuser', '2025-07');

    expect(rollup.dayCount).toBe(0);
    expect(rollup.activeDays).toBe(0);
    expect(rollup.highlights).toHaveLength(0);
    expect(Object.keys(rollup.categoryMinutes)).toHaveLength(0);
  });

  it('handles missing plan gracefully', async () => {
    mockPlanStore.load = () => null;

    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    expect(rollup.valueAllocation).toEqual({});
  });

  it('highlights include long calendar events', async () => {
    const rollup = await service.computeMonthlyRollup('testuser', '2025-06');

    const workshop = rollup.highlights.find(h => h.text.includes('Workshop'));
    expect(workshop).toBeDefined();
    expect(workshop.source).toBe('calendar');
  });
});
