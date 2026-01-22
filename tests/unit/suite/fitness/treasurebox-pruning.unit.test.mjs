// tests/unit/fitness/treasurebox-pruning.unit.test.mjs
import { jest, describe, test, expect, beforeAll } from '@jest/globals';

// Mock logger
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis()
  })
}));

/**
 * Tests for TreasureBox timeline pruning behavior.
 *
 * The pruning logic (MAX_TIMELINE_POINTS = 1000) prevents unbounded memory growth
 * by removing oldest data points when a timeline exceeds the threshold.
 *
 * At 5-second intervals: 1000 points = ~83 minutes of data
 *
 * Related: docs/_wip/audits/2026-01-19-fitness-memory-audit.md
 * Related code: frontend/src/hooks/fitness/TreasureBox.js:7
 */
describe('TreasureBox timeline pruning', () => {
  let FitnessTreasureBox;

  beforeAll(async () => {
    const module = await import('#frontend/hooks/fitness/TreasureBox.js');
    FitnessTreasureBox = module.FitnessTreasureBox;
  });

  test('MAX_TIMELINE_POINTS limits cumulative timeline to 1000 entries', async () => {
    const tb = new FitnessTreasureBox(null);

    // Manually push 1100 entries to cumulative timeline
    for (let i = 0; i < 1100; i++) {
      tb._timeline.cumulative.push(i);
    }

    // Trigger truncation
    tb._truncateTimeline();

    expect(tb._timeline.cumulative.length).toBe(1000);
    // Should keep newest (last 1000)
    expect(tb._timeline.cumulative[0]).toBe(100);
    expect(tb._timeline.cumulative[999]).toBe(1099);
  });

  test('perColor timelines are also truncated', async () => {
    const tb = new FitnessTreasureBox(null);

    // Add entries to perColor
    tb._timeline.perColor.set('hot', []);
    for (let i = 0; i < 1100; i++) {
      tb._timeline.perColor.get('hot').push(i);
    }

    // Push matching cumulative entries
    for (let i = 0; i < 1100; i++) {
      tb._timeline.cumulative.push(i);
    }

    tb._truncateTimeline();

    expect(tb._timeline.perColor.get('hot').length).toBe(1000);
  });

  test('truncation preserves newest data points', async () => {
    const tb = new FitnessTreasureBox(null);

    // Add 1200 entries (200 over limit)
    for (let i = 0; i < 1200; i++) {
      tb._timeline.cumulative.push(i);
    }

    tb._truncateTimeline();

    // Should keep newest 1000 points (values 200-1199)
    expect(tb._timeline.cumulative.length).toBe(1000);
    expect(tb._timeline.cumulative[0]).toBe(200);
    expect(tb._timeline.cumulative[999]).toBe(1199);
  });

  test('timelines under threshold are not affected', async () => {
    const tb = new FitnessTreasureBox(null);

    // Add exactly 500 entries (under threshold)
    for (let i = 0; i < 500; i++) {
      tb._timeline.cumulative.push(i);
    }

    tb._truncateTimeline();

    // Should remain unchanged
    expect(tb._timeline.cumulative.length).toBe(500);
    expect(tb._timeline.cumulative[0]).toBe(0);
    expect(tb._timeline.cumulative[499]).toBe(499);
  });

  test('multiple color series are truncated independently', async () => {
    const tb = new FitnessTreasureBox(null);

    // Add entries to multiple color series
    tb._timeline.perColor.set('warm', []);
    tb._timeline.perColor.set('hot', []);
    tb._timeline.perColor.set('fire', []);

    for (let i = 0; i < 1100; i++) {
      tb._timeline.perColor.get('warm').push(i);
      tb._timeline.perColor.get('hot').push(i * 2);
      tb._timeline.perColor.get('fire').push(i * 3);
      tb._timeline.cumulative.push(i);
    }

    tb._truncateTimeline();

    // All should be pruned to 1000
    expect(tb._timeline.perColor.get('warm').length).toBe(1000);
    expect(tb._timeline.perColor.get('hot').length).toBe(1000);
    expect(tb._timeline.perColor.get('fire').length).toBe(1000);

    // Each preserves its own newest data
    expect(tb._timeline.perColor.get('warm')[999]).toBe(1099);
    expect(tb._timeline.perColor.get('hot')[999]).toBe(1099 * 2);
    expect(tb._timeline.perColor.get('fire')[999]).toBe(1099 * 3);
  });

  test('lastIndex is adjusted after truncation', async () => {
    const tb = new FitnessTreasureBox(null);

    // Set up state as if we've been tracking
    tb._timeline.lastIndex = 1099;

    // Add 1100 entries
    for (let i = 0; i < 1100; i++) {
      tb._timeline.cumulative.push(i);
    }

    tb._truncateTimeline();

    // lastIndex should be adjusted by the excess amount (100)
    // Original: 1099, excess: 100, new: max(-1, 1099 - 100) = 999
    expect(tb._timeline.lastIndex).toBe(999);
  });
});
