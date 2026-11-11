import { describe, it, expect } from 'vitest';
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from "./ghostCandidate.js";

const REC = {
  race: { id: '20260630081500', date: '2026-06-30T15:15:00.000Z', win_condition: 'distance', goal_m: 1500, interval_seconds: 1 },
  participants: {
    dad: { display_name: 'Dad', equipment: 'cycle_ace', final_distance_m: 1500, final_time_s: 150, placement: 1,
      distance_series: SessionSerializerV3.encodeSeries([0, 10, 20]) },
    user_3: { display_name: 'User_3', equipment: 'tricycle', final_distance_m: 1200, final_time_s: null, placement: 2,
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
  it('carries the incomplete flag onto the candidate (false when the record has none)', () => {
    expect(mapRaceRecordToCandidate(REC).incomplete).toBe(false);
    const c = mapRaceRecordToCandidate({ ...REC, race: { ...REC.race, incomplete: true } });
    expect(c.incomplete).toBe(true);
  });
  it('carries stopped from the record participant onto the candidate participant', () => {
    const c = mapRaceRecordToCandidate({ ...REC, participants: { ...REC.participants, user_3: { ...REC.participants.user_3, stopped: true } } });
    expect(c.participants.find((p) => p.id === 'user_3').stopped).toBe(true);
    expect(c.participants.find((p) => p.id === 'dad').stopped).toBe(false);
  });
  // The race index (indexEntryFromRecord) reads the same two fields; a rider must
  // be a valid rival as a record exactly when they are one as an index row.
  describe('final time and distance, read the way the race index reads them', () => {
    const finals = (final_distance_m, final_time_s) => {
      const c = mapRaceRecordToCandidate({ ...REC, participants: { 'rider-a': { display_name: 'Rider A', placement: 1, final_distance_m, final_time_s } } });
      return { finalDistanceM: c.participants[0].finalDistanceM, finalTimeS: c.participants[0].finalTimeS };
    };
    it('keeps finite numbers', () => {
      expect(finals(1500, 150.2)).toEqual({ finalDistanceM: 1500, finalTimeS: 150.2 });
      expect(finals(0, 0)).toEqual({ finalDistanceM: 0, finalTimeS: 0 });
    });
    it('reads a numeric-string distance as its number', () => {
      expect(finals('1500', 150).finalDistanceM).toBe(1500);
      expect(finals('1480.5', null).finalDistanceM).toBe(1480.5);
    });
    it('reads a distance that is not a finite number as null', () => {
      for (const v of [undefined, null, '', 'abc', NaN, Infinity, {}]) expect(finals(v, 150).finalDistanceM).toBeNull();
    });
    it('reads a time that is not a finite number as null (a string is not a time, as in the index)', () => {
      for (const v of [undefined, null, '', '150', 'abc', NaN, Infinity]) expect(finals(1500, v).finalTimeS).toBeNull();
    });
    it('labels the score from the coerced values', () => {
      const c = mapRaceRecordToCandidate({ race: { id: '20260630081500', win_condition: 'time', time_cap_s: 300 },
        participants: { 'rider-a': { placement: 1, final_distance_m: '1500', final_time_s: null } } });
      expect(c.scoreLabel).toBe(mapRaceRecordToCandidate({ race: { id: '20260630081500', win_condition: 'time', time_cap_s: 300 },
        participants: { 'rider-a': { placement: 1, final_distance_m: 1500, final_time_s: null } } }).scoreLabel);
    });
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
