/**
 * Integration test: LifelogAggregator range aggregation.
 *
 * Verifies the aggregator produces structured range output
 * with per-day sources, categories, and summaries.
 */
import { describe, it, expect } from '@jest/globals';
import { LifelogAggregator } from '#apps/lifelog/LifelogAggregator.mjs';

describe('LifelogAggregator — range aggregation (integrated)', () => {
  function buildAggregator(fileData = {}) {
    return new LifelogAggregator({
      userLoadFile: (username, filename) => fileData[filename] || null,
    });
  }

  it('aggregates a 3-day range with strava data', async () => {
    const stravaData = {
      '2025-06-01': [{ name: 'Morning Run', type: 'Run', distance: 5000, moving_time: 1800 }],
      '2025-06-02': [{ name: 'Ride', type: 'Ride', distance: 20000, moving_time: 3600 }],
      '2025-06-03': [],
    };

    const agg = buildAggregator({ strava: stravaData });
    const result = await agg.aggregateRange('testuser', '2025-06-01', '2025-06-03');

    expect(result.startDate).toBe('2025-06-01');
    expect(result.endDate).toBe('2025-06-03');
    expect(result._meta).toBeDefined();
    expect(result._meta.dayCount).toBe(3);

    // Each day should exist in result
    expect(result.days['2025-06-01']).toBeDefined();
    expect(result.days['2025-06-02']).toBeDefined();
    expect(result.days['2025-06-03']).toBeDefined();
  });

  it('returns structured day data with sources and categories', async () => {
    const stravaData = {
      '2025-06-01': [{ name: 'Run', type: 'Run', distance: 5000, moving_time: 1800 }],
    };

    const agg = buildAggregator({ strava: stravaData });
    const result = await agg.aggregateRange('testuser', '2025-06-01', '2025-06-01');

    const day = result.days['2025-06-01'];
    expect(day).toBeDefined();
    expect(day.sources).toBeDefined();
    expect(day.categories).toBeDefined();
    expect(day.summaries).toBeDefined();
  });

  it('handles empty date range gracefully', async () => {
    const agg = buildAggregator({});
    const result = await agg.aggregateRange('testuser', '2025-06-01', '2025-06-01');

    expect(result.days).toBeDefined();
    expect(result._meta.dayCount).toBeGreaterThanOrEqual(0);
  });
});
