// tests/unit/fitness/fitness-timeline-pruning.unit.test.mjs
import { describe, test, expect, beforeEach } from 'vitest';
import { FitnessTimeline } from '#frontend/hooks/fitness/FitnessTimeline.js';

/**
 * Tests for FitnessTimeline pruning behavior.
 *
 * The pruning logic (MAX_SERIES_LENGTH = 2000) prevents unbounded memory growth
 * by removing oldest data points when a series exceeds the threshold.
 *
 * At 5-second intervals: 2000 points = ~2.7 hours of data
 *
 * Related: docs/_wip/audits/2026-01-19-fitness-memory-audit.md
 * Related code: frontend/src/hooks/fitness/FitnessTimeline.js:8
 */
describe('FitnessTimeline pruning', () => {
  let timeline;

  beforeEach(() => {
    timeline = new FitnessTimeline();
  });

  test('MAX_SERIES_LENGTH is 2000 to cap memory usage', () => {
    // Add more than 2000 ticks to a series
    for (let i = 0; i < 2100; i++) {
      timeline.tick({ 'test:hr': i % 180 });
    }

    // Series should be pruned to MAX_SERIES_LENGTH
    const series = timeline.series['test:hr'];
    expect(series.length).toBeLessThanOrEqual(2000);
  });

  test('pruning preserves newest data point', () => {
    // Add 2100 ticks (100 over limit)
    for (let i = 0; i < 2100; i++) {
      timeline.tick({ 'test:hr': i });
    }

    const series = timeline.series['test:hr'];

    // Series should be at MAX_SERIES_LENGTH
    expect(series.length).toBe(2000);

    expect(series[0]).toBe(100);
    expect(series[series.length - 1]).toBe(2099);
  });

  test('pruning keeps a dense rolling window without repadding to absolute tick count', () => {
    for (let i = 0; i < 2100; i++) {
      timeline.tick({ 'test:hr': i });
    }

    const series = timeline.series['test:hr'];

    expect(series.length).toBe(2000);
    expect(timeline.timebase.tickCount).toBe(2100);
    expect(timeline.timebase.prunedTickCount).toBe(100);

    const nonNullCount = series.filter(v => v !== null).length;
    expect(nonNullCount).toBe(2000);
    expect(series[0]).toBe(100);
    expect(series[1999]).toBe(2099);
  });

  test('long-running timeline prunes a constant one tick per tick after cap', () => {
    for (let i = 0; i < 5000; i++) {
      timeline.tick({ 'device:7138:rpm': i });
    }

    const series = timeline.series['device:7138:rpm'];
    expect(series.length).toBe(2000);
    expect(timeline.timebase.tickCount).toBe(5000);
    expect(timeline.timebase.prunedTickCount).toBe(3000);
    expect(series[0]).toBe(3000);
    expect(series[1999]).toBe(4999);
    expect(FitnessTimeline.validateSeriesLengths(timeline.timebase, timeline.series)).toEqual({
      ok: true,
      issues: []
    });
  });

  test('multiple series are pruned independently', () => {
    // Add data to multiple series
    for (let i = 0; i < 2100; i++) {
      timeline.tick({
        'user:alice:hr': i,
        'user:bob:hr': i * 2
      });
    }

    const aliceSeries = timeline.series['user:alice:hr'];
    const bobSeries = timeline.series['user:bob:hr'];

    // Both should be pruned
    expect(aliceSeries.length).toBe(2000);
    expect(bobSeries.length).toBe(2000);

    // Each preserves its own newest data
    expect(aliceSeries[aliceSeries.length - 1]).toBe(2099);
    expect(bobSeries[bobSeries.length - 1]).toBe(2099 * 2);
  });

  test('series under threshold are not affected', () => {
    // Add exactly 1000 ticks (under threshold)
    for (let i = 0; i < 1000; i++) {
      timeline.tick({ 'test:hr': i });
    }

    const series = timeline.series['test:hr'];
    expect(series.length).toBe(1000);
    expect(series[0]).toBe(0);
    expect(series[999]).toBe(999);
  });

  test('pruning occurs on each tick, not just at threshold', () => {
    // Fill to exactly MAX_SERIES_LENGTH
    for (let i = 0; i < 2000; i++) {
      timeline.tick({ 'test:hr': i });
    }
    expect(timeline.series['test:hr'].length).toBe(2000);

    // Add one more - should trigger pruning
    timeline.tick({ 'test:hr': 2000 });
    expect(timeline.series['test:hr'].length).toBe(2000);

    // The oldest value (0) should be gone, newest (2000) should be present
    expect(timeline.series['test:hr'][0]).toBe(1);
    expect(timeline.series['test:hr'][1999]).toBe(2000);
  });
});
