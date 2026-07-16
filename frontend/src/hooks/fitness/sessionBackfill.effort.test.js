import { describe, it, expect } from 'vitest';
import { computeOccupantEffort, isInsignificantEffort, DEFAULT_INSIGNIFICANT_USAGE, isKnownUserId, buildOccupancySegments } from './sessionBackfill.js';

const series = (o) => o;

describe('computeOccupantEffort', () => {
  it('counts hr samples, active/warm seconds, and last coin total', () => {
    const s = series({
      'user:a:heart_rate': [null, 120, 0, 130, null],   // 2 valid samples
      'user:a:zone_id':    [null, 'active', 'cool', 'warm', 'hot'], // 3 active/warm/hot ticks
      'user:a:coins_total':[0, 1, 3, 3, 3]              // last = 3
    });
    const e = computeOccupantEffort(s, 'a', { intervalSeconds: 5 });
    expect(e).toEqual({ coins: 3, activeWarmZoneSeconds: 15, hrSampleCount: 2 });
  });

  it('treats a missing occupant as zero effort', () => {
    expect(computeOccupantEffort({}, 'ghost', { intervalSeconds: 5 }))
      .toEqual({ coins: 0, activeWarmZoneSeconds: 0, hrSampleCount: 0 });
  });
});

describe('isInsignificantEffort', () => {
  const cfg = DEFAULT_INSIGNIFICANT_USAGE;
  it('is true for a near-idle strap regardless of duration', () => {
    expect(isInsignificantEffort({ coins: 1, activeWarmZoneSeconds: 0, hrSampleCount: 2 }, cfg)).toBe(true);
  });
  it('is false when any effort signal exceeds its bound', () => {
    expect(isInsignificantEffort({ coins: 5, activeWarmZoneSeconds: 0, hrSampleCount: 2 }, cfg)).toBe(false);
    expect(isInsignificantEffort({ coins: 0, activeWarmZoneSeconds: 30, hrSampleCount: 2 }, cfg)).toBe(false);
    expect(isInsignificantEffort({ coins: 0, activeWarmZoneSeconds: 0, hrSampleCount: 50 }, cfg)).toBe(false);
  });
});

describe('isKnownUserId', () => {
  it('rejects synthetic guest ids, accepts configured ids', () => {
    expect(isKnownUserId('grannie')).toBe(true);
    expect(isKnownUserId('guest-123')).toBe(false);
    expect(isKnownUserId('#90006')).toBe(false);
    expect(isKnownUserId('guest_29413')).toBe(false);
  });
});

describe('buildOccupancySegments', () => {
  it('adds a synthetic segment for a series-only occupant (no entity)', () => {
    const entities = [
      { entityId: 'e1', profileId: 'grannie', deviceId: '29413', startTime: 400, endTime: null, status: 'active' }
    ];
    const series = {
      'user:soren:heart_rate': [116, 116, null],
      'user:grannie:heart_rate': [null, null, 80]
    };
    const per = buildOccupancySegments({ entities, series, sessionEndTime: 1000, intervalSeconds: 5 });
    const segs = per.get('29413');
    const ids = segs.map((s) => s.occupantId).sort();
    expect(ids).toEqual(['grannie', 'soren']);
    expect(segs.every((s) => s.effort)).toBe(true);
  });
});
