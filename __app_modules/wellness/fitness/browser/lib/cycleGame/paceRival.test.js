import { describe, it, expect } from 'vitest';
import { pickPaceRival, buildParRecord, PAR_ID, DEFAULT_PAR_SPEED_KMH } from './paceRival.js';
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from './ghostCandidate.js';
import { SessionSerializerV3 } from '../../hooks/fitness/SessionSerializerV3.js';

const cand = (raceId, winCondition, goal, parts, extra = {}) => ({
  raceId, winCondition, goalM: winCondition === 'distance' ? goal : null,
  timeCapS: winCondition === 'time' ? goal : null, participants: parts, ...extra
});
const p = (id, finalTimeS, finalDistanceM, isGhost = false) => ({ id, isGhost, finalTimeS, finalDistanceM, stopped: false });

const PAR = { kind: 'par', raceId: null, participantId: 'par' };

describe('pickPaceRival', () => {
  const want = { riderId: 'rider-a', winCondition: 'distance', goalM: 1500 };

  it("prefers the rider's own best at the same type and length", () => {
    const r = pickPaceRival({ ...want, candidates: [
      cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)]),
      cand('r2', 'distance', 1500, [p('rider-a', 440, 1500), p('rider-b', 400, 1500)]),
      cand('r3', 'distance', 1000, [p('rider-a', 200, 1000)])
    ] });
    expect(r).toMatchObject({ kind: 'self', raceId: 'r2', participantId: 'rider-a' });
  });

  it('falls back to the household best', () => {
    const r = pickPaceRival({ ...want, candidates: [cand('r2', 'distance', 1500, [p('rider-b', 400, 1500)])] });
    expect(r).toMatchObject({ kind: 'household', raceId: 'r2', participantId: 'rider-b' });
  });

  it('picks the fastest household rider across races', () => {
    const r = pickPaceRival({ ...want, candidates: [
      cand('r1', 'distance', 1500, [p('rider-b', 400, 1500), p('rider-c', 420, 1500)]),
      cand('r2', 'distance', 1500, [p('rider-c', 380, 1500)])
    ] });
    expect(r).toEqual({ kind: 'household', raceId: 'r2', participantId: 'rider-c' });
  });

  it('for time races the best is the furthest distance', () => {
    const r = pickPaceRival({ riderId: 'rider-a', winCondition: 'time', timeCapS: 300, candidates: [
      cand('r1', 'time', 300, [p('rider-a', null, 1100)]), cand('r2', 'time', 300, [p('rider-a', null, 1348)])
    ] });
    expect(r).toEqual({ kind: 'self', raceId: 'r2', participantId: 'rider-a' });
  });

  it('skips ghosts, incomplete races, unfinished distance rides and stopped riders', () => {
    const r = pickPaceRival({ ...want, candidates: [
      cand('r1', 'distance', 1500, [p('ghost:x:rider-a', 300, 1500, true)]),
      cand('r2', 'distance', 1500, [p('rider-a', 310, 1500)], { incomplete: true }),
      cand('r3', 'distance', 1500, [p('rider-a', null, 900)]),
      cand('r4', 'distance', 1500, [{ ...p('rider-a', 320, 1500), stopped: true }])
    ] });
    expect(r.kind).toBe('par');
  });

  it('skips a ghost id even when the isGhost flag is missing', () => {
    const r = pickPaceRival({ ...want, candidates: [
      cand('r1', 'distance', 1500, [{ id: 'ghost:x:rider-a', finalTimeS: 300, finalDistanceM: 1500 }])
    ] });
    expect(r).toEqual(PAR);
  });

  it('returns par when there is no history', () => {
    expect(pickPaceRival({ ...want, candidates: [] })).toEqual(PAR);
    expect(pickPaceRival({ ...want })).toEqual(PAR);
    expect(pickPaceRival({ ...want, candidates: null })).toEqual(PAR);
    expect(pickPaceRival()).toEqual(PAR);
  });

  it('ignores the same race type at a different length', () => {
    const dist = pickPaceRival({ ...want, candidates: [
      cand('r1', 'distance', 1000, [p('rider-a', 200, 1000)]),
      cand('r2', 'distance', 2000, [p('rider-a', 500, 2000)])
    ] });
    expect(dist).toEqual(PAR);
    const time = pickPaceRival({ riderId: 'rider-a', winCondition: 'time', timeCapS: 300, candidates: [
      cand('r1', 'time', 600, [p('rider-a', null, 2600)])
    ] });
    expect(time).toEqual(PAR);
  });

  it('ignores the other race type even when the numbers line up', () => {
    const r = pickPaceRival({ ...want, candidates: [cand('r1', 'time', 1500, [p('rider-a', null, 1500)])] });
    expect(r).toEqual(PAR);
  });

  it('breaks a tie on score with the most recent race', () => {
    const older = cand('20261101080000', 'distance', 1500, [p('rider-a', 440, 1500)]);
    const newer = cand('20261105080000', 'distance', 1500, [p('rider-a', 440, 1500)]);
    expect(pickPaceRival({ ...want, candidates: [older, newer] }).raceId).toBe('20261105080000');
    expect(pickPaceRival({ ...want, candidates: [newer, older] }).raceId).toBe('20261105080000');
    // Household tie as well.
    const h1 = cand('20261101080000', 'distance', 1500, [p('rider-b', 400, 1500)]);
    const h2 = cand('20261105080000', 'distance', 1500, [p('rider-c', 400, 1500)]);
    expect(pickPaceRival({ ...want, candidates: [h2, h1] })).toEqual({ kind: 'household', raceId: '20261105080000', participantId: 'rider-c' });
  });

  it('a null rider gets the household best, or par', () => {
    const cands = [cand('r1', 'distance', 1500, [p('rider-a', 440, 1500), p('rider-b', 400, 1500)])];
    expect(pickPaceRival({ ...want, riderId: null, candidates: cands })).toEqual({ kind: 'household', raceId: 'r1', participantId: 'rider-b' });
    expect(pickPaceRival({ ...want, riderId: null, candidates: [] })).toEqual(PAR);
  });

  it("finds the rider's own earlier ride through the real candidate mapper", () => {
    const record = {
      race: { id: '20261101080000', win_condition: 'distance', goal_m: 300, interval_seconds: 1 },
      participants: {
        'rider-b': { display_name: 'Rider B', final_distance_m: 300, final_time_s: 50, placement: 1, distance_series: '[[100,1],200,300]' },
        'rider-a': { display_name: 'Rider A', final_distance_m: 300, final_time_s: 61, placement: 2, distance_series: '[90,180,300]' }
      }
    };
    const candidates = [mapRaceRecordToCandidate(record)];
    const r = pickPaceRival({ candidates, riderId: 'rider-a', winCondition: 'distance', goalM: 300 });
    expect(r).toEqual({ kind: 'self', raceId: '20261101080000', participantId: 'rider-a' });
  });

  it('never picks a past ride against a rival: the saved ghost is skipped, the live rider counts', () => {
    const record = {
      race: { id: '20261102080000', win_condition: 'distance', goal_m: 300, interval_seconds: 1 },
      participants: {
        'ghost:20261101080000:rider-a': { display_name: 'Rider A', final_distance_m: 300, final_time_s: 40, placement: 1, distance_series: '[150,300]' },
        'ghost:par:par': { display_name: 'Par', final_distance_m: 300, final_time_s: 45, placement: 2, distance_series: '[150,300]' },
        'rider-a': { display_name: 'Rider A', final_distance_m: 300, final_time_s: 58, placement: 3, distance_series: '[100,200,300]' }
      }
    };
    const r = pickPaceRival({ candidates: [mapRaceRecordToCandidate(record)], riderId: 'rider-a', winCondition: 'distance', goalM: 300 });
    expect(r).toEqual({ kind: 'self', raceId: '20261102080000', participantId: 'rider-a' });
  });
});

describe('buildParRecord', () => {
  it('builds a distance record that reaches the goal at the par speed', () => {
    const rec = buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh: 18 }); // 5 m/s
    expect(rec.race).toMatchObject({ id: 'par', win_condition: 'distance', goal_m: 100 });
    expect(rec.participants.par.final_time_s).toBe(20);
    expect(rec.participants.par.final_distance_m).toBe(100);
  });

  it('builds a time record that runs the full cap', () => {
    const rec = buildParRecord({ winCondition: 'time', timeCapS: 60, speedKmh: 18 });
    expect(rec.race).toMatchObject({ id: 'par', win_condition: 'time', time_cap_s: 60 });
    expect(rec.participants.par.final_distance_m).toBe(300);
    expect(rec.participants.par.final_time_s).toBeNull();
    expect(SessionSerializerV3.decodeSeries(rec.participants.par.distance_series)).toHaveLength(60);
  });

  it('exports the par id and default speed it uses', () => {
    expect(PAR_ID).toBe('par');
    expect(DEFAULT_PAR_SPEED_KMH).toBe(18);
    expect(buildParRecord({ winCondition: 'distance', goalM: 100 }).participants.par.final_time_s).toBe(20);
  });

  it('ends exactly on a goal that is not a multiple of the per-second distance', () => {
    const rec = buildParRecord({ winCondition: 'distance', goalM: 103, speedKmh: 18 });
    const series = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
    expect(series).toHaveLength(21);
    expect(series[19]).toBe(100);
    expect(series[20]).toBe(103);
    expect(rec.participants.par.final_distance_m).toBe(103);
    expect(rec.participants.par.final_time_s).toBe(21);
  });

  it('does not add a duplicate trailing sample when the division is a hair over a whole second', () => {
    // 10.8 km/h = 3 m/s in real numbers, 3.0000000000000004 or 2.9999999999999996 in floats.
    const rec = buildParRecord({ winCondition: 'distance', goalM: 300, speedKmh: 10.8 });
    const series = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
    expect(series).toHaveLength(100);
    expect(series[99]).toBe(300);
    expect(series[98]).toBe(297);
  });

  it.each([0, -5, NaN, Infinity, -Infinity, null, undefined, '18'])('falls back to 18 km/h for speedKmh %s', (speedKmh) => {
    const rec = buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh });
    const series = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
    expect(series).toHaveLength(20);
    expect(series.every(Number.isFinite)).toBe(true);
    expect(series[19]).toBe(100);
    expect(rec.participants.par.final_time_s).toBe(20);
  });

  it('returns null when the race has no usable length', () => {
    expect(buildParRecord({ winCondition: 'distance', goalM: null })).toBeNull();
    expect(buildParRecord({ winCondition: 'distance', goalM: 0 })).toBeNull();
    expect(buildParRecord({ winCondition: 'distance', goalM: Infinity })).toBeNull();
    expect(buildParRecord({ winCondition: 'time', timeCapS: null })).toBeNull();
    expect(buildParRecord({ winCondition: 'time', timeCapS: 0 })).toBeNull();
    expect(buildParRecord({ winCondition: 'time', timeCapS: NaN })).toBeNull();
    expect(buildParRecord()).toBeNull();
    // The null record is safe to hand to the mapper.
    expect(mapRaceRecordToCandidate(buildParRecord())).toBeNull();
  });

  it('survives the real candidate mapper (distance)', () => {
    const c = mapRaceRecordToCandidate(buildParRecord({ winCondition: 'distance', goalM: 103, speedKmh: 18 }));
    expect(c).toMatchObject({ raceId: 'par', winCondition: 'distance', goalM: 103, timeCapS: null, incomplete: false, intervalSeconds: 1 });
    expect(c.participants).toHaveLength(1);
    expect(c.participants[0]).toMatchObject({ id: 'par', isGhost: false, stopped: false, finalTimeS: 21, finalDistanceM: 103, placement: 1, displayName: 'Par' });
    const series = SessionSerializerV3.decodeSeries(c.participants[0].distanceSeries);
    expect(series).toHaveLength(21);
    expect(series[series.length - 1]).toBe(103);
  });

  it('survives the real candidate mapper (time)', () => {
    const c = mapRaceRecordToCandidate(buildParRecord({ winCondition: 'time', timeCapS: 60, speedKmh: 18 }));
    expect(c).toMatchObject({ raceId: 'par', winCondition: 'time', goalM: null, timeCapS: 60, incomplete: false });
    expect(c.participants).toHaveLength(1);
    expect(c.participants[0]).toMatchObject({ id: 'par', finalTimeS: null, finalDistanceM: 300 });
    const series = SessionSerializerV3.decodeSeries(c.participants[0].distanceSeries);
    expect(series).toHaveLength(60);
    expect(series[0]).toBe(5);
    expect(series[59]).toBe(300);
  });

  it('becomes a one-rider ghost through buildGhostFromCandidate', () => {
    const c = mapRaceRecordToCandidate(buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh: 18 }));
    const built = buildGhostFromCandidate(c);
    expect(built).not.toBeNull();
    expect(built.riders).toHaveLength(1);
    expect(built.ghost).toMatchObject({ sourceRaceId: 'par', winCondition: 'distance', goalM: 100, timeCapS: null, riderCount: 1, displayName: 'Par' });
    expect(built.ghost.riders).toBe(built.riders);
    const rider = built.riders[0];
    expect(rider).toMatchObject({ userId: 'ghost:par:par', equipmentId: null, ghostIntervalS: 1 });
    expect(rider.ghostSeries).toHaveLength(20);
    expect(rider.ghostSeries[19]).toBe(100);
    // No recorded HR / cadence / zone: empty arrays, not undefined.
    expect(rider.ghostHrSeries).toEqual([]);
    expect(rider.ghostRpmSeries).toEqual([]);
    expect(rider.ghostZoneSeries).toEqual([]);
  });

  it('the par candidate is never itself picked as a rival', () => {
    const c = mapRaceRecordToCandidate(buildParRecord({ winCondition: 'distance', goalM: 100 }));
    expect(pickPaceRival({ candidates: [c], riderId: 'rider-a', winCondition: 'distance', goalM: 100 })).toEqual(PAR);
  });
});
