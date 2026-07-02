import { describe, it, expect } from 'vitest';
import { buildRaceRecord } from './raceRecord.js';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';

const state = {
  winCondition: 'distance',
  riders: {
    milo: { userId: 'milo', displayName: 'Milo', equipmentId: 'cycle_ace', cumulativeDistanceM: 3000, distanceSeries: [1000, 2000, 3000], finishTimeS: 252 },
    felix: { userId: 'felix', displayName: 'Felix', equipmentId: 'tricycle', cumulativeDistanceM: 2710, distanceSeries: [900, 1800, 2710], finishTimeS: null }
  },
  standings: [
    { userId: 'milo', placement: 1, finishTimeS: 252, distanceM: 3000 },
    { userId: 'felix', placement: 2, finishTimeS: null, distanceM: 2710 }
  ]
};
const meta = { raceId: '20260602143012', date: '2026-06-02', mode: 'simultaneous', winCondition: 'distance', goalM: 3000, intervalSeconds: 5, backgroundPlexId: 'plex:1' };

describe('buildRaceRecord', () => {
  it('builds a v1 record with race metadata', () => {
    const rec = buildRaceRecord(state, meta);
    expect(rec.version).toBe(1);
    expect(rec.race.id).toBe('20260602143012');
    expect(rec.race.win_condition).toBe('distance');
    expect(rec.race.goal_m).toBe(3000);
    expect(rec.race.time_cap_s).toBeUndefined();
    expect(rec.race.interval_seconds).toBe(5);
    expect(rec.race.background_plex_id).toBe('plex:1');
  });
  it('builds per-participant entries with RLE distance series + placement', () => {
    const rec = buildRaceRecord(state, meta);
    expect(rec.participants.milo.final_distance_m).toBe(3000);
    expect(rec.participants.milo.final_time_s).toBe(252);
    expect(rec.participants.milo.placement).toBe(1);
    expect(rec.participants.milo.equipment).toBe('cycle_ace');
    expect(rec.participants.milo.distance_series).toBe('[1000,2000,3000]');
    expect(rec.participants.felix.placement).toBe(2);
    expect(rec.participants.felix.final_time_s).toBeNull();
  });
  it('uses time_cap_s (not goal_m) for a time race', () => {
    const rec = buildRaceRecord({ ...state, winCondition: 'time' }, { ...meta, winCondition: 'time', timeCapS: 300, goalM: undefined });
    expect(rec.race.time_cap_s).toBe(300);
    expect(rec.race.goal_m).toBeUndefined();
  });
  it('encodes each participant hr_series from the engine hrSeries', () => {
    const s = {
      riders: {
        a: { userId: 'a', displayName: 'A', equipmentId: 'cycle_ace', cumulativeDistanceM: 100, finishTimeS: 50, distanceSeries: [50, 100], hrSeries: [150, 160] }
      },
      standings: [{ userId: 'a', placement: 1 }]
    };
    const rec = buildRaceRecord(s, { raceId: '20260603120000', date: 'x', mode: 'simultaneous', winCondition: 'distance', goalM: 100, intervalSeconds: 1 });
    expect(rec.participants.a.hr_series).toBe(SessionSerializerV3.encodeSeries([150, 160]));
  });
  it('encodes rpm_series + zone_series (so ghosts can replay all metrics)', () => {
    const s = {
      riders: {
        a: {
          userId: 'a', displayName: 'A', equipmentId: 'cycle_ace', cumulativeDistanceM: 100, finishTimeS: 50,
          distanceSeries: [50, 100], hrSeries: [150, 160], rpmSeries: [80, 92], zoneSeries: ['warm', 'hot']
        }
      },
      standings: [{ userId: 'a', placement: 1 }]
    };
    const rec = buildRaceRecord(s, { raceId: '20260603120000', date: 'x', mode: 'simultaneous', winCondition: 'distance', goalM: 100, intervalSeconds: 1 });
    expect(rec.participants.a.rpm_series).toBe(SessionSerializerV3.encodeSeries([80, 92]));
    expect(rec.participants.a.zone_series).toBe(SessionSerializerV3.encodeSeries(['warm', 'hot']));
    // round-trips back to the original arrays
    expect(SessionSerializerV3.decodeSeries(rec.participants.a.rpm_series)).toEqual([80, 92]);
    expect(SessionSerializerV3.decodeSeries(rec.participants.a.zone_series)).toEqual(['warm', 'hot']);
  });
  it('persists course_id from meta, null when absent', () => {
    const state = { standings: [], riders: {} };
    const base = { raceId: '20260701080000', date: 'D', mode: 'simultaneous',
      winCondition: 'distance', goalM: 1500, intervalSeconds: 1 };
    expect(buildRaceRecord(state, { ...base, courseId: 'sprint-1500m' }).race.course_id).toBe('sprint-1500m');
    expect(buildRaceRecord(state, base).race.course_id).toBeNull();
  });
});
