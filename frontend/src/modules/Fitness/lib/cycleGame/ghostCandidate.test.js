import { describe, it, expect } from 'vitest';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from './ghostCandidate.js';

const REC = {
  race: { id: '20260630081500', date: '2026-06-30T15:15:00.000Z', win_condition: 'distance', goal_m: 1500, interval_seconds: 1 },
  participants: {
    dad: { display_name: 'Dad', equipment: 'cycle_ace', final_distance_m: 1500, final_time_s: 150, placement: 1,
      distance_series: SessionSerializerV3.encodeSeries([0, 10, 20]) },
    milo: { display_name: 'Milo', equipment: 'tricycle', final_distance_m: 1200, final_time_s: null, placement: 2,
      distance_series: SessionSerializerV3.encodeSeries([0, 5, 9]) }
  }
};

describe('mapRaceRecordToCandidate', () => {
  it('maps a record to a candidate (winner first, day/time from raceId)', () => {
    const c = mapRaceRecordToCandidate(REC);
    expect(c.raceId).toBe('20260630081500');
    expect(c.day).toBe('2026-06-30');
    expect(c.timeOfDay).toBe('8:15 am');
    expect(c.participants[0].displayName).toBe('Dad');
    expect(c.winnerName).toBe('Dad');
    expect(c.goalKind).toBe('distance');
    expect(c.scoreKind).toBe('time');
  });
  it('returns null for a record with no participants', () => {
    expect(mapRaceRecordToCandidate({ race: { id: 'x' }, participants: {} })).toBeNull();
  });
});

describe('buildGhostFromCandidate', () => {
  it('builds ghost riders with decoded series and ghost: ids', () => {
    const { ghost, riders } = buildGhostFromCandidate(mapRaceRecordToCandidate(REC));
    expect(riders).toHaveLength(2);
    expect(riders[0].userId).toBe('ghost:20260630081500:dad');
    expect(riders[0].ghostSeries).toEqual([0, 10, 20]);
    expect(ghost.sourceRaceId).toBe('20260630081500');
    expect(ghost.winCondition).toBe('distance');
    expect(ghost.riders).toBe(riders);
    // winnerName comes from resolveParticipantIdentity, which does NOT append
    // the 👻 suffix (only per-rider displayName does, via the ` 👻` template in
    // buildGhostFromCandidate) — so the ghost's own displayName has no emoji.
    expect(ghost.displayName).toBe('Dad +1');
  });
  it('returns null when no rider has distance data', () => {
    const rec = { race: REC.race, participants: { dad: { display_name: 'Dad', distance_series: null } } };
    expect(buildGhostFromCandidate(mapRaceRecordToCandidate(rec))).toBeNull();
  });
});
