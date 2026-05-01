import { describe, it, expect, vi } from 'vitest';
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

const DATE = '2026-05-01';

function makeWeight(overrides = {}) {
  return {
    lbs: 175,
    fat_percent: 22,
    lean_lbs: 130,
    water_weight: 100,
    lbs_adjusted_average_7day_trend: -0.2,
    ...overrides,
  };
}

function makeCalibration({ leanOffset = 4, bfOffset = -3 } = {}) {
  return {
    getCorrectedLean: vi.fn((raw) => raw + leanOffset),
    getCorrectedBodyFat: vi.fn((raw) => raw + bfOffset),
  };
}

// Empty strava/fitness arrays so mergeWorkouts has iterables. The calibration
// behaviour we're testing only touches the weight branch, but aggregator
// always calls mergeWorkouts.
const BASE_SOURCES = { strava: [], fitness: { activities: [] } };

describe('HealthAggregator.aggregateDayMetrics — DEXA calibration (F-007)', () => {
  it('without calibration: leanLbs equals raw weight.lean_lbs (regression guard)', () => {
    const sources = { ...BASE_SOURCES, weight: makeWeight({ lean_lbs: 130 }) };

    const metric = HealthAggregator.aggregateDayMetrics(DATE, sources);

    expect(metric.weight.leanLbs).toBe(130);
    expect(metric.weight.fatPercent).toBe(22);
  });

  it('with calibration: leanLbs and fatPercent are corrected via calibration accessors', () => {
    const calibration = makeCalibration({ leanOffset: 4, bfOffset: -3 });
    const sources = {
      ...BASE_SOURCES,
      weight: makeWeight({ lean_lbs: 130, fat_percent: 22 }),
      calibration,
    };

    const metric = HealthAggregator.aggregateDayMetrics(DATE, sources);

    expect(calibration.getCorrectedLean).toHaveBeenCalledWith(130);
    expect(calibration.getCorrectedBodyFat).toHaveBeenCalledWith(22);
    expect(metric.weight.leanLbs).toBe(134);
    expect(metric.weight.fatPercent).toBe(19);
  });

  it('with calibration but no weight at all: weight is null (graceful no-op)', () => {
    const calibration = makeCalibration();
    const sources = { ...BASE_SOURCES, calibration };

    const metric = HealthAggregator.aggregateDayMetrics(DATE, sources);

    expect(metric.weight).toBeNull();
    expect(calibration.getCorrectedLean).not.toHaveBeenCalled();
    expect(calibration.getCorrectedBodyFat).not.toHaveBeenCalled();
  });

  it('with calibration but missing lean_lbs/fat_percent fields: leaves them undefined (no NaN injection)', () => {
    const calibration = makeCalibration();
    const sources = {
      ...BASE_SOURCES,
      weight: { lbs: 175 }, // no lean_lbs, no fat_percent
      calibration,
    };

    const metric = HealthAggregator.aggregateDayMetrics(DATE, sources);

    expect(metric.weight.lbs).toBe(175);
    expect(metric.weight.leanLbs).toBeUndefined();
    expect(metric.weight.fatPercent).toBeUndefined();
    expect(calibration.getCorrectedLean).not.toHaveBeenCalled();
    expect(calibration.getCorrectedBodyFat).not.toHaveBeenCalled();
  });
});
