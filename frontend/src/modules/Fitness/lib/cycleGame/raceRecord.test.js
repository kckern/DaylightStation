import { describe, it, expect } from 'vitest';
import { buildRaceRecord } from './raceRecord.js';

const state = {
  winCondition: 'distance',
  riders: {
    user_3: { userId: 'user_3', displayName: 'User_3', equipmentId: 'cycle_ace', cumulativeDistanceM: 3000, distanceSeries: [1000, 2000, 3000], finishTimeS: 252 },
    user_2: { userId: 'user_2', displayName: 'User_2', equipmentId: 'tricycle', cumulativeDistanceM: 2710, distanceSeries: [900, 1800, 2710], finishTimeS: null }
  },
  standings: [
    { userId: 'user_3', placement: 1, finishTimeS: 252, distanceM: 3000 },
    { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
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
    expect(rec.participants.user_3.final_distance_m).toBe(3000);
    expect(rec.participants.user_3.final_time_s).toBe(252);
    expect(rec.participants.user_3.placement).toBe(1);
    expect(rec.participants.user_3.equipment).toBe('cycle_ace');
    expect(rec.participants.user_3.distance_series).toBe('[1000,2000,3000]');
    expect(rec.participants.user_2.placement).toBe(2);
    expect(rec.participants.user_2.final_time_s).toBeNull();
  });
  it('uses time_cap_s (not goal_m) for a time race', () => {
    const rec = buildRaceRecord({ ...state, winCondition: 'time' }, { ...meta, winCondition: 'time', timeCapS: 300, goalM: undefined });
    expect(rec.race.time_cap_s).toBe(300);
    expect(rec.race.goal_m).toBeUndefined();
  });
});
