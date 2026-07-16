import { describe, it, expect } from 'vitest';
import {
  ZONE_MAP,
  getLastNonNull,
  computeHrStats,
  computeZoneTime,
  findSeries,
  buildSummary
} from './fitnessSessionSummary.mjs';

describe('getLastNonNull', () => {
  it('returns the last non-null value', () => {
    expect(getLastNonNull([1, 2, null, null])).toBe(2);
    expect(getLastNonNull([null, 5, null])).toBe(5);
  });
  it('returns 0 for empty/all-null/missing input', () => {
    expect(getLastNonNull([])).toBe(0);
    expect(getLastNonNull([null, null])).toBe(0);
    expect(getLastNonNull(undefined)).toBe(0);
  });
});

describe('computeHrStats', () => {
  it('computes min/max/avg over positive, non-null samples', () => {
    expect(computeHrStats([100, 110, 120])).toEqual({ min: 100, max: 120, avg: 110 });
  });
  it('ignores nulls and non-positive values', () => {
    expect(computeHrStats([90, null, 0, 95])).toEqual({ min: 90, max: 95, avg: 93 });
  });
  it('returns zeros when no valid samples', () => {
    expect(computeHrStats([])).toEqual({ min: 0, max: 0, avg: 0 });
    expect(computeHrStats([null, 0])).toEqual({ min: 0, max: 0, avg: 0 });
  });
});

describe('computeZoneTime', () => {
  it('accumulates seconds per zone, mapping letters via ZONE_MAP', () => {
    expect(computeZoneTime(['c', 'a', 'w', null], 5)).toEqual({
      [ZONE_MAP.c]: 5,
      [ZONE_MAP.a]: 5,
      [ZONE_MAP.w]: 5
    });
  });
  it('accumulates repeated zones', () => {
    expect(computeZoneTime(['c', 'c', 'c'], 5)).toEqual({ cool: 15 });
  });
});

describe('findSeries', () => {
  it('prefers the v2 flat-map key form', () => {
    const series = { 'user:alice:heart_rate': [1, 2], 'alice:hr': [9] };
    expect(findSeries(series, 'alice', 'heart_rate', 'hr')).toEqual([1, 2]);
  });
  it('falls back to the on-disk compact key form', () => {
    const series = { 'alice:hr': [9, 10] };
    expect(findSeries(series, 'alice', 'heart_rate', 'hr')).toEqual([9, 10]);
  });
  it('returns [] when neither key is present', () => {
    expect(findSeries({}, 'alice', 'heart_rate', 'hr')).toEqual([]);
  });
});

describe('buildSummary', () => {
  const participants = { alice: { display_name: 'Alice' }, bob: { display_name: 'Bob' } };
  const series = {
    'alice:hr': [100, 110, 120],
    'alice:zone': ['c', 'a', 'w'],
    'alice:coins': [0, 1, 2],
    'bob:hr': [90, null, 95],
    'bob:zone': ['c', 'c', 'c'],
    'bob:coins': [0, 0, 5]
  };
  const events = [
    { type: 'media', timestamp: 1000, data: { contentId: 'plex:1', title: 'Test Video', start: 1000, end: 2000 } },
    { type: 'challenge', timestamp: 1500, data: { result: 'success' } },
    { type: 'challenge', timestamp: 1600, data: { result: 'fail' } },
    { type: 'voice_memo', timestamp: 1800, data: { transcript: 'hi', durationSeconds: 5 } }
  ];
  const treasureBox = { totalCoins: 7, buckets: { blue: 1, green: 2, yellow: 3, orange: 1, red: 0 } };

  const summary = buildSummary({ participants, series, events, treasureBox, intervalSeconds: 5 });

  it('pins per-participant hr/zone/coins stats', () => {
    expect(summary.participants).toEqual({
      alice: { coins: 2, hr_avg: 110, hr_max: 120, hr_min: 100, zone_minutes: { cool: 0.08, active: 0.08, warm: 0.08 } },
      bob: { coins: 5, hr_avg: 93, hr_max: 95, hr_min: 90, zone_minutes: { cool: 0.25 } }
    });
  });

  it('pins deduped, primary-flagged media', () => {
    expect(summary.media).toEqual([
      {
        contentId: 'plex:1',
        title: 'Test Video',
        mediaType: 'video',
        showTitle: undefined,
        seasonTitle: undefined,
        grandparentId: undefined,
        parentId: undefined,
        durationMs: 1000,
        primary: true
      }
    ]);
  });

  it('pins challenge succeeded/failed counts', () => {
    expect(summary.challenges).toEqual({ total: 2, succeeded: 1, failed: 1 });
  });

  it('pins voice memo transcripts', () => {
    expect(summary.voiceMemos).toEqual([{ transcript: 'hi', durationSeconds: 5, timestamp: 1800 }]);
  });

  it('pins coin totals/buckets from treasureBox', () => {
    expect(summary.coins).toEqual({ total: 7, buckets: treasureBox.buckets });
  });
});
