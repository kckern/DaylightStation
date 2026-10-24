import { describe, expect, it } from 'vitest';
import {
  bucketHrSeries, hrTrendRange, hrTrendRuns, thresholdLines, trendVisible, zoneBarState,
  TREND_MAX_BUCKETS, TREND_OFF_PX, TREND_ON_PX,
} from './hrTrend.js';

describe('trendVisible (hysteresis on measured card height)', () => {
  it('turns on at the ON height and stays on down to the OFF height', () => {
    expect(trendVisible(false, TREND_ON_PX - 1)).toBe(false);
    expect(trendVisible(false, TREND_ON_PX)).toBe(true);
    expect(trendVisible(true, TREND_OFF_PX)).toBe(true);
    expect(trendVisible(true, TREND_OFF_PX - 1)).toBe(false);
    expect(trendVisible(false, NaN)).toBe(false);
  });
});

describe('bucketHrSeries', () => {
  it('keeps short series 1:1 and downsamples long ones to at most 120 buckets', () => {
    expect(bucketHrSeries([100, 110], ['active', 'active'])).toEqual([{ hr: 100, zone: 'active' }, { hr: 110, zone: 'active' }]);
    const long = Array.from({ length: 915 }, (_, i) => 100 + (i % 10));
    const buckets = bucketHrSeries(long, long.map(() => 'warm'));
    expect(buckets).toHaveLength(TREND_MAX_BUCKETS);
    expect(buckets.every((b) => b.hr > 100 && b.hr < 110)).toBe(true);
  });
  it('averages non-null HR and keeps the highest zone so a short Fire spike shows', () => {
    const hr = [120, 170, null, 130];
    const zones = ['warm', 'fire', null, 'warm'];
    expect(bucketHrSeries(hr, zones, 2)).toEqual([{ hr: 145, zone: 'fire' }, { hr: 130, zone: 'warm' }]);
  });
  it('a bucket with no reading stays null (a gap, not a zero)', () => {
    expect(bucketHrSeries([null, null, 120, 0], [null, null, 'warm', null], 2)).toEqual([{ hr: null, zone: null }, { hr: 120, zone: 'warm' }]);
    expect(bucketHrSeries([], [])).toEqual([]);
  });
});

describe('hrTrendRange', () => {
  it('is bounded by the rider thresholds and widens only for data outside them', () => {
    const buckets = [{ hr: 110 }, { hr: 130 }];
    expect(hrTrendRange(buckets, [0, 100, 120, 140, 160])).toEqual([90, 170]);
    expect(hrTrendRange([{ hr: 80 }, { hr: 185 }], [100, 160])).toEqual([80, 185]);
  });
  it('pads data-only ranges and never collapses to a flat line', () => {
    expect(hrTrendRange([{ hr: 120 }, { hr: 122 }], [])).toEqual([111, 131]);
    expect(hrTrendRange([], [])).toBeNull();
  });
});

describe('hrTrendRuns', () => {
  const range = [100, 200];
  it('splits on zone change and joins runs at the boundary point', () => {
    const runs = hrTrendRuns([{ hr: 120, zone: 'warm' }, { hr: 150, zone: 'warm' }, { hr: 180, zone: 'fire' }], range);
    expect(runs.map((r) => r.zone)).toEqual(['warm', 'fire']);
    expect(runs[0].points).toBe('0.5,80 1.5,50');
    expect(runs[1].points).toBe('1.5,50 2.5,20');
  });
  it('breaks the line on a gap', () => {
    const runs = hrTrendRuns([{ hr: 120, zone: 'warm' }, { hr: 130, zone: 'warm' }, { hr: null, zone: null }, { hr: 140, zone: 'warm' }, { hr: 150, zone: 'warm' }], range);
    expect(runs).toHaveLength(2);
    expect(runs[1].points.startsWith('3.5,')).toBe(true);
  });
  it('draws nothing without a range', () => {
    expect(hrTrendRuns([{ hr: 120, zone: 'warm' }], null)).toEqual([]);
  });
  it('places threshold guides inside the range only', () => {
    expect(thresholdLines([100, 200], [0, 100, 150, 250])).toEqual([50]);
  });
});

describe('zoneBarState', () => {
  it('committed Fire renders a full, pulsing (max) bar instead of an empty track', () => {
    expect(zoneBarState({ committedZoneId: 'fire', showBar: false, progress: 0 })).toEqual({ show: true, max: true, percent: 100 });
  });
  it('other zones show their progress; nothing to show stays hidden', () => {
    expect(zoneBarState({ committedZoneId: 'warm', showBar: true, progress: 0.426 })).toEqual({ show: true, max: false, percent: 43 });
    expect(zoneBarState({ committedZoneId: 'warm', showBar: false, progress: null })).toEqual({ show: false, max: false, percent: 0 });
  });
});
