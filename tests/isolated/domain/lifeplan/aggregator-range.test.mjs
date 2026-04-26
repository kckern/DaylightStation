import { describe, it, expect, beforeEach } from 'vitest';
import { LifelogAggregator } from '#apps/lifelog/LifelogAggregator.mjs';

describe('LifelogAggregator.aggregateRange', () => {
  let aggregator;

  const mockLoadFile = (username, filename) => {
    if (filename === 'strava') {
      return {
        '2025-06-01': [{ title: 'Morning Run', type: 'Run', duration: 30 }],
        '2025-06-02': [{ title: 'Bike Ride', type: 'Ride', duration: 45 }],
        '2025-06-03': [],
      };
    }
    if (filename === 'weight') {
      return {
        '2025-06-01': { lbs: 180 },
        '2025-06-02': { lbs: 179.5 },
      };
    }
    return null;
  };

  beforeEach(() => {
    aggregator = new LifelogAggregator({ userLoadFile: mockLoadFile });
  });

  it('returns data for each day in range', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-03');
    expect(result.startDate).toBe('2025-06-01');
    expect(result.endDate).toBe('2025-06-03');
    expect(Object.keys(result.days)).toHaveLength(3);
    expect(result.days['2025-06-01']).toBeTruthy();
    expect(result.days['2025-06-02']).toBeTruthy();
    expect(result.days['2025-06-03']).toBeTruthy();
  });

  it('each day has sources, categories, summaries structure', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-01');
    const day = result.days['2025-06-01'];
    expect(day).toHaveProperty('sources');
    expect(day).toHaveProperty('categories');
    expect(day).toHaveProperty('summaries');
  });

  it('includes source data per day when extractor returns data', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-02');
    const day1 = result.days['2025-06-01'];
    // Should have at least one source populated from mock data
    expect(Object.keys(day1.sources).length).toBeGreaterThan(0);
  });

  it('reports metadata', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-03');
    expect(result._meta.username).toBe('testuser');
    expect(result._meta.dayCount).toBe(3);
  });

  it('handles single-day range', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-01');
    expect(Object.keys(result.days)).toHaveLength(1);
    expect(result._meta.dayCount).toBe(1);
  });

  it('handles range with no data gracefully', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-12-01', '2025-12-03');
    expect(Object.keys(result.days)).toHaveLength(3);
    // Days should still exist but with empty sources
    for (const date of Object.keys(result.days)) {
      expect(result.days[date]).toHaveProperty('sources');
    }
  });
});
