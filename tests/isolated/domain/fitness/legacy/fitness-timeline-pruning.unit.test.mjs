import { describe, test, expect, beforeEach } from 'vitest';
import { FitnessTimeline, MAX_SERIES_LENGTH } from '#frontend/hooks/fitness/FitnessTimeline.js';

/**
 * Tests for FitnessTimeline pruning behavior.
 *
 * The pruning logic removes oldest data points once a series exceeds
 * MAX_SERIES_LENGTH, which is what keeps a long session from growing without
 * bound.
 *
 * The cap is imported, never restated. It was 2000 when these tests were
 * written and is 8640 now (12 hours at 5s ticks); every assertion below was
 * hardcoded to the old number, so the whole file failed once the cap moved
 * even though pruning worked perfectly. A test that copies a constant tests
 * the copy.
 *
 * Related: docs/_wip/audits/2026-01-19-fitness-memory-audit.md
 * Related code: frontend/src/hooks/fitness/FitnessTimeline.js
 */
describe('FitnessTimeline pruning', () => {
  const CAP = MAX_SERIES_LENGTH;
  const OVER = 100;          // ticks past the cap
  const TOTAL = CAP + OVER;
  let timeline;

  beforeEach(() => {
    timeline = new FitnessTimeline();
  });

  test('the cap is a bounded number, so a series cannot grow forever', () => {
    expect(Number.isInteger(CAP)).toBe(true);
    expect(CAP).toBeGreaterThan(0);
    // A sanity ceiling, not a restatement: at 5s ticks this is ~12 hours, and
    // an order of magnitude more would stop being a memory cap.
    expect(CAP).toBeLessThanOrEqual(100000);

    for (let i = 0; i < TOTAL; i++) timeline.tick({ 'test:hr': i % 180 });
    expect(timeline.series['test:hr'].length).toBeLessThanOrEqual(CAP);
  });

  test('pruning preserves newest data point', () => {
    for (let i = 0; i < TOTAL; i++) timeline.tick({ 'test:hr': i });

    const series = timeline.series['test:hr'];
    expect(series.length).toBe(CAP);
    expect(series[0]).toBe(OVER);
    expect(series[series.length - 1]).toBe(TOTAL - 1);
  });

  test('pruning keeps a dense rolling window without repadding to absolute tick count', () => {
    for (let i = 0; i < TOTAL; i++) timeline.tick({ 'test:hr': i });

    const series = timeline.series['test:hr'];

    expect(series.length).toBe(CAP);
    expect(timeline.timebase.tickCount).toBe(TOTAL);
    expect(timeline.timebase.prunedTickCount).toBe(OVER);

    const nonNullCount = series.filter((v) => v !== null).length;
    expect(nonNullCount).toBe(CAP);
    expect(series[0]).toBe(OVER);
    expect(series[CAP - 1]).toBe(TOTAL - 1);
  });

  test('long-running timeline prunes a constant one tick per tick after cap', () => {
    const LONG = CAP * 2 + 500;
    for (let i = 0; i < LONG; i++) timeline.tick({ 'device:7138:rpm': i });

    const series = timeline.series['device:7138:rpm'];
    expect(series.length).toBe(CAP);
    expect(timeline.timebase.tickCount).toBe(LONG);
    expect(timeline.timebase.prunedTickCount).toBe(LONG - CAP);
    expect(series[0]).toBe(LONG - CAP);
    expect(series[CAP - 1]).toBe(LONG - 1);
    expect(FitnessTimeline.validateSeriesLengths(timeline.timebase, timeline.series)).toEqual({
      ok: true,
      issues: []
    });
  });

  test('multiple series are pruned independently', () => {
    for (let i = 0; i < TOTAL; i++) {
      timeline.tick({ 'user:alice:hr': i, 'user:bob:hr': i * 2 });
    }

    const aliceSeries = timeline.series['user:alice:hr'];
    const bobSeries = timeline.series['user:bob:hr'];

    expect(aliceSeries.length).toBe(CAP);
    expect(bobSeries.length).toBe(CAP);
    expect(aliceSeries[aliceSeries.length - 1]).toBe(TOTAL - 1);
    expect(bobSeries[bobSeries.length - 1]).toBe((TOTAL - 1) * 2);
  });

  test('series under threshold are not affected', () => {
    const UNDER = Math.floor(CAP / 2);
    for (let i = 0; i < UNDER; i++) timeline.tick({ 'test:hr': i });

    const series = timeline.series['test:hr'];
    expect(series.length).toBe(UNDER);
    expect(series[0]).toBe(0);
    expect(series[UNDER - 1]).toBe(UNDER - 1);
  });

  test('pruning occurs on each tick, not just at threshold', () => {
    for (let i = 0; i < CAP; i++) timeline.tick({ 'test:hr': i });
    expect(timeline.series['test:hr'].length).toBe(CAP);

    // One past the cap — the window slides by exactly one.
    timeline.tick({ 'test:hr': CAP });
    expect(timeline.series['test:hr'].length).toBe(CAP);
    expect(timeline.series['test:hr'][0]).toBe(1);
    expect(timeline.series['test:hr'][CAP - 1]).toBe(CAP);
  });
});
