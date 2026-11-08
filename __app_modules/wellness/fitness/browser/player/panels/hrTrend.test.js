import { describe, expect, it } from 'vitest';
import {
  hrTrendRange, monotonePath, thresholdLines, trendReady, trendTransform, trendVisible, zoneBands, zoneBarState,
  TREND_OFF_PX, TREND_ON_PX,
} from './hrTrend.js';
import { buildPrefix } from './hrTrendScale.js';

describe('trendVisible (hysteresis on measured card height)', () => {
  it('turns on at the ON height and stays on down to the OFF height', () => {
    expect(trendVisible(false, TREND_ON_PX - 1)).toBe(false);
    expect(trendVisible(false, TREND_ON_PX)).toBe(true);
    expect(trendVisible(true, TREND_OFF_PX)).toBe(true);
    expect(trendVisible(true, TREND_OFF_PX - 1)).toBe(false);
    expect(trendVisible(false, NaN)).toBe(false);
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

describe('thresholdLines', () => {
  it('places threshold guides inside the range only', () => {
    expect(thresholdLines([100, 200], [0, 100, 150, 250])).toEqual([50]);
  });
});

describe('monotonePath', () => {
  it('breaks on nulls and draws lone points as dots', () => {
    const d = monotonePath([{ x: 0, hr: 100 }, { x: 10, hr: 110 }, { x: 20, hr: null }, { x: 30, hr: 120 }, { x: 40, hr: null }]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toContain('M30,120 h0.01');
  });
  it('never overshoots a monotone run', () => {
    const d = monotonePath([{ x: 0, hr: 100 }, { x: 10, hr: 100 }, { x: 20, hr: 150 }, { x: 30, hr: 150 }]);
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...ys)).toBeLessThanOrEqual(150);
  });
  it('draws nothing for no points', () => {
    expect(monotonePath([])).toBe('');
  });
});

describe('zoneBands', () => {
  const seq = [{ id: 'cool', threshold: 0 }, { id: 'active', threshold: 100 }, { id: 'warm', threshold: 120 }, { id: 'fire', threshold: 160 }];
  it('spans threshold to next threshold, open at both ends, coloured by ZONE_COLORS', () => {
    expect(zoneBands(seq)).toEqual([
      { id: 'cool', color: '#6ab8ff', lo: 0, hi: 100 },
      { id: 'active', color: '#51cf66', lo: 100, hi: 120 },
      { id: 'warm', color: '#ffd43b', lo: 120, hi: 160 },
      { id: 'fire', color: '#ff6b6b', lo: 160, hi: 400 },
    ]);
  });
  it('falls back to one neutral band with no zones', () => {
    expect(zoneBands([])).toEqual([{ id: 'none', color: 'rgba(255,255,255,0.6)', lo: 0, hi: 400 }]);
    expect(zoneBands(undefined)).toEqual([{ id: 'none', color: 'rgba(255,255,255,0.6)', lo: 0, hi: 400 }]);
  });
});

describe('trendReady', () => {
  it('needs five real readings, not five ticks', () => {
    expect(trendReady(buildPrefix([100, null, 101, null, 102, 103]))).toBe(false);
    expect(trendReady(buildPrefix([100, null, 101, 102, 103, 104]))).toBe(true);
  });
});

describe('trendTransform', () => {
  it('maps hi to y=0 and lo to y=100', () => {
    expect(trendTransform([100, 200])).toBe('matrix(1 0 0 -1 0 200)');
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
