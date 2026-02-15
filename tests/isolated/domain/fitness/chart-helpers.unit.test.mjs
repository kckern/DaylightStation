import { describe, it, expect } from 'vitest';
import { buildBeatsSeries, getZoneCoinRate, buildSegments } from '#frontend/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js';
import { ZoneColors } from '#frontend/modules/Fitness/domain/types.js';
import { ZONE_COLORS } from '#frontend/modules/Fitness/shared/constants/fitness.js';

describe('buildBeatsSeries — coins quality gate (O3)', () => {
  const makeGetSeries = (data) => (userId, metric) => {
    const key = `${metric}`;
    return data[key] ? [...data[key]] : [];
  };

  it('falls through to heart_beats when coins_total is mostly null', () => {
    const coins = [0, ...Array(19).fill(null)];
    const heartBeats = Array.from({ length: 20 }, (_, i) => i * 10);
    const zones = Array(20).fill('active');
    const hr = Array(20).fill(100);

    const getSeries = makeGetSeries({
      coins_total: coins,
      heart_beats: heartBeats,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    const lastBeat = result.beats[result.beats.length - 1];
    expect(lastBeat).toBe(190);
  });

  it('uses coins_total when it has sufficient non-null data', () => {
    const coins = Array.from({ length: 20 }, (_, i) => i * 5);
    const heartBeats = Array.from({ length: 20 }, (_, i) => i * 10);
    const zones = Array(20).fill('warm');
    const hr = Array(20).fill(120);

    const getSeries = makeGetSeries({
      coins_total: coins,
      heart_beats: heartBeats,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    const lastBeat = result.beats[result.beats.length - 1];
    expect(lastBeat).toBe(95);
  });
});

describe('buildBeatsSeries — forward-fill cumulative metrics (O4)', () => {
  const makeGetSeries = (data) => (userId, metric) => {
    return data[metric] ? [...data[metric]] : [];
  };

  it('forward-fills interior nulls in coins_total', () => {
    const coins = [0, null, null, 5, null, null, 12, null, null, 20];
    const zones = Array(10).fill('warm');
    const hr = Array(10).fill(130);

    const getSeries = makeGetSeries({
      coins_total: coins,
      zone_id: zones,
      heart_rate: hr,
    });

    const roster = { id: 'alan', profileId: 'alan', name: 'Alan' };
    const result = buildBeatsSeries(roster, getSeries, { intervalMs: 5000 });

    // Interior nulls should be forward-filled, not preserved
    expect(result.beats[1]).toBe(0);  // forward-filled from index 0
    expect(result.beats[4]).toBe(5);  // forward-filled from index 3
    expect(result.beats[7]).toBe(12); // forward-filled from index 6
    expect(result.beats[9]).toBe(20);
  });
});

describe('getZoneCoinRate — DEFAULT_ZONE_COIN_RATES (O2)', () => {
  // Test WITHOUT zoneConfig to exercise the default fallback
  it('returns 0 for cool zone (blue — no coins)', () => {
    expect(getZoneCoinRate('cool')).toBe(0);
  });

  it('returns non-zero for active zone (green — earns coins)', () => {
    expect(getZoneCoinRate('active')).toBeGreaterThan(0);
  });

  it('returns higher rate for warm than active', () => {
    expect(getZoneCoinRate('warm')).toBeGreaterThan(getZoneCoinRate('active'));
  });

  it('returns higher rate for hot than warm', () => {
    expect(getZoneCoinRate('hot')).toBeGreaterThan(getZoneCoinRate('warm'));
  });

  it('returns higher rate for fire than hot', () => {
    expect(getZoneCoinRate('fire')).toBeGreaterThan(getZoneCoinRate('hot'));
  });
});

describe('buildSegments + enforceZoneSlopes — blue zone flatness (O7)', () => {
  it('produces flat values for cool (blue) zone segments', () => {
    const beats = [0, 5, 10, 15, 20, 20, 20, 20, 20, 25, 30];
    const zones = ['warm', 'warm', 'warm', 'warm', 'warm', 'cool', 'cool', 'cool', 'cool', 'warm', 'warm'];
    const active = Array(11).fill(true);

    const segments = buildSegments(beats, zones, active, { zoneConfig: [] });

    const coolSegments = segments.filter(s => s.zone === 'cool' && !s.isGap);
    expect(coolSegments.length).toBeGreaterThan(0);

    coolSegments.forEach(seg => {
      const values = seg.points.map(p => p.v);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[0]);
      }
    });
  });
});

describe('zone color consolidation (O5)', () => {
  it('domain ZoneColors match shared constants ZONE_COLORS for all zone IDs', () => {
    const zoneIds = ['cool', 'active', 'warm', 'hot', 'fire'];
    zoneIds.forEach(zone => {
      expect(ZoneColors[zone]).toBe(ZONE_COLORS[zone]);
    });
  });
});
