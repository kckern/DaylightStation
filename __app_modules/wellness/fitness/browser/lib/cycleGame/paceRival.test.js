import { describe, it, expect } from 'vitest';
import { pickPaceRival, buildParRecord, PAR_RPM, mergeRaceCandidates, paceRivalPool, rivalPoolCandidates } from './paceRival.js';
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

  it('breaks a time-race tie on distance with the most recent race', () => {
    const req = { riderId: 'rider-a', winCondition: 'time', timeCapS: 300 };
    const older = cand('20261101080000', 'time', 300, [p('rider-a', null, 1348)]);
    const newer = cand('20261105080000', 'time', 300, [p('rider-a', null, 1348)]);
    expect(pickPaceRival({ ...req, candidates: [older, newer] })).toEqual({ kind: 'self', raceId: '20261105080000', participantId: 'rider-a' });
    expect(pickPaceRival({ ...req, candidates: [newer, older] })).toEqual({ kind: 'self', raceId: '20261105080000', participantId: 'rider-a' });
  });

  it('skips null entries inside candidates', () => {
    const r = pickPaceRival({ ...want, candidates: [null, undefined, cand('r1', 'distance', 1500, [null, p('rider-a', 440, 1500)]), null] });
    expect(r).toEqual({ kind: 'self', raceId: 'r1', participantId: 'rider-a' });
  });

  it('a request with no real length returns par, never a candidate whose own length is null', () => {
    const noLenDistance = cand('r1', 'distance', null, [p('rider-a', 440, 1500)]);
    const noLenTime = cand('r2', 'time', null, [p('rider-a', null, 1348)]);
    const candidates = [noLenDistance, noLenTime];
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'distance', goalM: null, candidates })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'distance', candidates })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'time', timeCapS: null, candidates })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'distance', goalM: 0, candidates: [cand('r3', 'distance', 0, [p('rider-a', 440, 1500)])] })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'distance', goalM: NaN, candidates: [cand('r4', 'distance', NaN, [p('rider-a', 440, 1500)])] })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'time', timeCapS: Infinity, candidates: [cand('r5', 'time', Infinity, [p('rider-a', null, 1348)])] })).toEqual(PAR);
  });

  it('compares lengths as numbers, without fuzzy matching', () => {
    const numeric = [cand('r1', 'distance', 1500, [p('rider-a', 440, 1500)])];
    const stringy = [cand('r1', 'distance', '1500', [p('rider-a', 440, 1500)])];
    const self = { kind: 'self', raceId: 'r1', participantId: 'rider-a' };
    expect(pickPaceRival({ ...want, goalM: '1500', candidates: numeric })).toEqual(self);
    expect(pickPaceRival({ ...want, candidates: stringy })).toEqual(self);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'time', timeCapS: '300', candidates: [cand('r1', 'time', 300, [p('rider-a', null, 1348)])] })).toEqual(self);
    expect(pickPaceRival({ ...want, goalM: 1500.0000001, candidates: numeric })).toEqual(PAR);
    expect(pickPaceRival({ ...want, candidates: [cand('r1', 'distance', 1500.0000001, [p('rider-a', 440, 1500)])] })).toEqual(PAR);
  });

  it('an unknown win condition returns par', () => {
    const odd = { raceId: 'r1', winCondition: 'laps', goalM: 1500, timeCapS: 1500, participants: [p('rider-a', 440, 1500)] };
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: 'laps', goalM: 1500, timeCapS: 1500, candidates: [odd] })).toEqual(PAR);
    expect(pickPaceRival({ riderId: 'rider-a', winCondition: null, goalM: 1500, candidates: [{ ...odd, winCondition: null }] })).toEqual(PAR);
  });
});

describe('buildParRecord', () => {
  it('gives par a constant 80 rpm cadence, one sample per distance sample', () => {
    expect(PAR_RPM).toBe(80);
    const rec = buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh: 18 });
    const rpm = SessionSerializerV3.decodeSeries(rec.participants.par.rpm_series);
    const dist = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
    expect(rpm).toHaveLength(dist.length);
    expect(rpm.every((v) => v === 80)).toBe(true);
    const built = buildGhostFromCandidate(mapRaceRecordToCandidate(rec));
    expect(built.riders[0].ghostRpmSeries).toEqual(rpm);
  });

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
    // No recorded HR / zone: empty arrays, not undefined. Cadence is a constant.
    expect(rider.ghostHrSeries).toEqual([]);
    expect(rider.ghostRpmSeries).toEqual(Array(20).fill(80));
    expect(rider.ghostZoneSeries).toEqual([]);
  });

  it('the par candidate is never itself picked as a rival', () => {
    const c = mapRaceRecordToCandidate(buildParRecord({ winCondition: 'distance', goalM: 100 }));
    expect(pickPaceRival({ candidates: [c], riderId: 'rider-a', winCondition: 'distance', goalM: 100 })).toEqual(PAR);
  });

  it('clamps a crawling par speed to a 3 km/h floor', () => {
    // 3 km/h = 0.8333 m/s, so 100 m takes 120 s.
    [0.001, 1, 2.999].forEach((speedKmh) => {
      const rec = buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh });
      expect(rec.participants.par.final_time_s).toBe(120);
      expect(SessionSerializerV3.decodeSeries(rec.participants.par.distance_series)).toHaveLength(120);
    });
    // 3 itself and anything above it are used as given.
    expect(buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh: 3 }).participants.par.final_time_s).toBe(120);
    expect(buildParRecord({ winCondition: 'distance', goalM: 100, speedKmh: 6 }).participants.par.final_time_s).toBe(60);
  });

  it('returns null when the series would run past four hours', () => {
    expect(buildParRecord({ winCondition: 'distance', goalM: 1e6, speedKmh: 0.001 })).toBeNull();
    expect(buildParRecord({ winCondition: 'time', timeCapS: 14401 })).toBeNull();
    expect(buildParRecord({ winCondition: 'time', timeCapS: 1e12 })).toBeNull();
    // Exactly four hours is still allowed: 72 km at 18 km/h, or a 14400 s cap.
    const dist = buildParRecord({ winCondition: 'distance', goalM: 72000, speedKmh: 18 });
    expect(dist.participants.par.final_time_s).toBe(14400);
    expect(buildParRecord({ winCondition: 'distance', goalM: 72001, speedKmh: 18 })).toBeNull();
    const time = buildParRecord({ winCondition: 'time', timeCapS: 14400 });
    expect(SessionSerializerV3.decodeSeries(time.participants.par.distance_series)).toHaveLength(14400);
  });

  it('returns null for a win condition that is neither distance nor time', () => {
    expect(buildParRecord({ winCondition: 'laps', goalM: 100, timeCapS: 60 })).toBeNull();
    expect(buildParRecord({ winCondition: null, goalM: 100, timeCapS: 60 })).toBeNull();
    expect(buildParRecord({ winCondition: '', goalM: 100, timeCapS: 60 })).toBeNull();
  });

  it('pins the last sample of a non-integer time cap to speed x cap', () => {
    const rec = buildParRecord({ winCondition: 'time', timeCapS: 60.5, speedKmh: 18 });
    const series = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
    expect(series).toHaveLength(61);
    expect(series[59]).toBe(300);
    expect(series[60]).toBe(302.5);
    expect(rec.participants.par.final_distance_m).toBe(302.5);
    expect(rec.participants.par.final_time_s).toBeNull();
    expect(rec.race.time_cap_s).toBe(60.5);
  });

  it('a long time-race series is strictly increasing', () => {
    [3, 18, 17.3].forEach((speedKmh) => {
      const rec = buildParRecord({ winCondition: 'time', timeCapS: 14400, speedKmh });
      const series = SessionSerializerV3.decodeSeries(rec.participants.par.distance_series);
      expect(series).toHaveLength(14400);
      expect(series.every((d, i) => i === 0 || d > series[i - 1])).toBe(true);
      expect(series[0]).toBeGreaterThan(0);
    });
  });

  it('accepts a numeric-string length and writes it back as a number', () => {
    const rec = buildParRecord({ winCondition: 'distance', goalM: '100' });
    expect(rec.race.goal_m).toBe(100);
    expect(rec.participants.par.final_distance_m).toBe(100);
    expect(buildParRecord({ winCondition: 'time', timeCapS: '60' }).race.time_cap_s).toBe(60);
  });
});

describe('mergeRaceCandidates', () => {
  it('appends races the first list does not have, keeping the first copy of a shared race', () => {
    const local = [cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)], { tag: 'local' })];
    const server = [
      cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)], { tag: 'server' }),
      cand('r0', 'distance', 1500, [p('rider-a', 400, 1500)], { tag: 'server' })
    ];
    const merged = mergeRaceCandidates(local, server);
    expect(merged.map((c) => [c.raceId, c.tag])).toEqual([['r1', 'local'], ['r0', 'server']]);
  });

  it('matches race ids as strings and skips empty entries and non-arrays', () => {
    const merged = mergeRaceCandidates([cand(20260101, 'distance', 100, [])], [null, cand('20260101', 'distance', 100, []), undefined]);
    expect(merged).toHaveLength(1);
    expect(mergeRaceCandidates(null, undefined)).toEqual([]);
  });
});

describe('paceRivalPool', () => {
  const want = { winCondition: 'distance', goalM: 1500 };
  it('is the races pickPaceRival chooses from: same type and exact length, not incomplete, not par', () => {
    const pool = paceRivalPool({ ...want, candidates: [
      cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)]),
      cand('r2', 'distance', 1000, [p('rider-a', 300, 1000)]),
      cand('r3', 'time', 1500, [p('rider-a', null, 900)]),
      cand('r4', 'distance', 1500, [p('rider-a', 300, 1500)], { incomplete: true }),
      cand('par', 'distance', 1500, [p('par', 300, 1500)]),
      null
    ] });
    expect(pool.map((c) => c.raceId)).toEqual(['r1']);
  });

  it('is empty for a request with no real length or an unknown race type', () => {
    const candidates = [cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)])];
    expect(paceRivalPool({ candidates, winCondition: 'distance', goalM: null })).toEqual([]);
    expect(paceRivalPool({ candidates, winCondition: 'sprint', goalM: 1500 })).toEqual([]);
  });

  it('an incomplete or stopped ride found in a merged list is never the pick', () => {
    const merged = mergeRaceCandidates(
      [cand('r1', 'distance', 1500, [p('rider-a', 460, 1500)])],
      [
        cand('r0', 'distance', 1500, [p('rider-a', 300, 1500)], { incomplete: true }),
        cand('r00', 'distance', 1500, [{ ...p('rider-a', 310, 1500), stopped: true }])
      ]
    );
    expect(pickPaceRival({ ...want, riderId: 'rider-a', candidates: merged })).toEqual({ kind: 'self', raceId: 'r1', participantId: 'rider-a' });
  });
});

describe('rivalPoolCandidates (the server\'s light rows as candidates)', () => {
  const want = { riderId: 'rider-a', winCondition: 'distance', goalM: 1500 };
  const entry = (raceId, parts, over = {}) => ({ raceId, date: '2026-01-01', winCondition: 'distance', goalM: 1500, participants: parts, ...over });
  const part = (id, finalTimeS, over = {}) => ({ id, isGhost: false, stopped: false, finalTimeS, finalDistanceM: 1500, placement: 1, ...over });

  it('maps an entry to the fields pickPaceRival reads, with no series', () => {
    expect(rivalPoolCandidates([entry('20250101100000', [part('rider-a', 300)])])).toEqual([{
      raceId: '20250101100000', date: '2026-01-01', winCondition: 'distance', goalM: 1500, timeCapS: null,
      incomplete: false,
      participants: [{ id: 'rider-a', isGhost: false, stopped: false, finalTimeS: 300, finalDistanceM: 1500, placement: 1 }]
    }]);
    const [time] = rivalPoolCandidates([{ raceId: '20250101100000', date: '2026-01-01', winCondition: 'time', timeCapS: 300, participants: [] }]);
    expect(time).toMatchObject({ winCondition: 'time', goalM: null, timeCapS: 300, participants: [] });
  });

  it('goes through the one selection rule: own best, then household best, ties to the most recent race', () => {
    const rows = rivalPoolCandidates([
      entry('20250101100000', [part('rider-a', 300), part('rider-b', 250)]),
      entry('20250102100000', [part('rider-a', 300)]),
      entry('20250103100000', [part('rider-a', 320)])
    ]);
    expect(pickPaceRival({ ...want, candidates: rows })).toEqual({ kind: 'self', raceId: '20250102100000', participantId: 'rider-a' });
    expect(pickPaceRival({ ...want, riderId: 'rider-c', candidates: rows })).toEqual({ kind: 'household', raceId: '20250101100000', participantId: 'rider-b' });
  });

  it('a ghost or a stopped rider in a row is never the pick, by flag or by id', () => {
    const rows = rivalPoolCandidates([
      entry('20250101100000', [part('rider-a', 100, { stopped: true })]),
      entry('20250102100000', [part('ghost:20240101100000:rider-a', 110, { isGhost: true })]),
      entry('20250103100000', [part('ghost:20240101100000:rider-a', 120, { isGhost: false })])
    ]);
    expect(pickPaceRival({ ...want, candidates: rows })).toEqual(PAR);
    expect(paceRivalPool({ ...want, candidates: rows })).toHaveLength(3); // still races considered
  });

  it('merged after the loaded history, the loaded copy of a race wins (it has the series)', () => {
    const loaded = [cand('20250101100000', 'distance', 1500, [{ ...p('rider-a', 300, 1500), distanceSeries: 'series' }])];
    const merged = mergeRaceCandidates(loaded, rivalPoolCandidates([
      entry('20250101100000', [part('rider-a', 300)]),
      entry('20240101100000', [part('rider-a', 280)])
    ]));
    expect(merged.map((c) => c.raceId)).toEqual(['20250101100000', '20240101100000']);
    expect(merged[0]).toBe(loaded[0]);
    expect(pickPaceRival({ ...want, candidates: merged })).toMatchObject({ kind: 'self', raceId: '20240101100000' });
  });

  it('drops what is not a row and tolerates a row with no participants', () => {
    expect(rivalPoolCandidates(null)).toEqual([]);
    expect(rivalPoolCandidates({ entries: [] })).toEqual([]);
    const out = rivalPoolCandidates([null, 'x', { winCondition: 'distance', goalM: 1500 }, entry('20250101100000', undefined)]);
    expect(out.map((c) => c.raceId)).toEqual(['20250101100000']);
    expect(out[0].participants).toEqual([]);
  });

  it('keeps an incomplete flag if a row carries one (the server leaves those races out)', () => {
    const rows = rivalPoolCandidates([entry('20250101100000', [part('rider-a', 100)], { incomplete: true })]);
    expect(rows[0].incomplete).toBe(true);
    expect(pickPaceRival({ ...want, candidates: rows })).toEqual(PAR);
  });
});
