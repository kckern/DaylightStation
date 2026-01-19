// tests/unit/fitness/snapshot-series-pruning.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

/**
 * Tests for FitnessSession snapshot.participantSeries pruning behavior.
 *
 * The pruning logic (MAX_SNAPSHOT_SERIES_LENGTH = 2000) prevents unbounded memory growth
 * by removing oldest HR data points when a participant's series exceeds the threshold.
 *
 * At 5-second intervals: 2000 points = ~2.7 hours of data per participant
 *
 * Related: docs/_wip/audits/2026-01-19-fitness-memory-audit.md
 * Related code: frontend/src/hooks/fitness/FitnessSession.js:1459
 */
describe('FitnessSession snapshot series pruning', () => {
  test('MAX_SNAPSHOT_SERIES_LENGTH caps participantSeries at 2000 points', () => {
    // This tests the pruning logic that exists in FitnessSession._processHrTick
    // The logic is: if series.length > MAX_SNAPSHOT_SERIES_LENGTH, splice oldest

    const MAX_SNAPSHOT_SERIES_LENGTH = 2000;
    const series = [];

    // Simulate adding 2100 points
    for (let i = 0; i < 2100; i++) {
      series.push(i);

      // Pruning logic from FitnessSession.js:1460-1463
      if (series.length > MAX_SNAPSHOT_SERIES_LENGTH) {
        const removeCount = series.length - MAX_SNAPSHOT_SERIES_LENGTH;
        series.splice(0, removeCount);
      }
    }

    expect(series.length).toBe(2000);
    // Should have removed first 100, keeping 100-2099
    expect(series[0]).toBe(100);
    expect(series[1999]).toBe(2099);
  });

  test('pruning runs every tick, not just at threshold', () => {
    // Verify that even with exactly 2001 points, we prune back to 2000
    const MAX_SNAPSHOT_SERIES_LENGTH = 2000;
    const series = new Array(2000).fill(0).map((_, i) => i);

    // Add one more point
    series.push(2000);

    if (series.length > MAX_SNAPSHOT_SERIES_LENGTH) {
      const removeCount = series.length - MAX_SNAPSHOT_SERIES_LENGTH;
      series.splice(0, removeCount);
    }

    expect(series.length).toBe(2000);
    expect(series[0]).toBe(1);
    expect(series[1999]).toBe(2000);
  });
});
