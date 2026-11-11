import { describe, expect, it } from 'vitest';
import {
  createFitnessAchievementProvider, findPersonalBests, isoWeekParam, ladderScore,
} from './fitnessAchievementProvider.mjs';

const H = 3_600_000;
// Study day with a 4am boundary in UTC (the test household lives in UTC).
const studyDay = (ms) => new Date(ms - 4 * H).toISOString().slice(0, 10);
const week = { from: '2026-11-02', to: '2026-11-08' };
const MON4 = Date.parse('2026-11-02T04:00:00Z');
const ringMs = { fromMs: MON4, toMs: Date.parse('2026-11-07T12:00:00Z') };

const entry = (id, course, parts, over = {}) => ({
  id, date: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`, course_id: course,
  win_condition: 'distance', goal_m: 1500, time_cap_s: null,
  participants: Object.entries(parts).map(([userId, t]) => ({ userId, isGhost: userId.startsWith('ghost:'), final_time_s: t, final_distance_m: 1500 })),
  ...over,
});

function deps(over = {}) {
  return {
    races: {
      getLadder: async () => ({ course: { id: 'sprint', win_condition: 'distance' }, standings: [
        { userId: 'kidA', bestValue: 100 }, { userId: 'ghost:kidA', bestValue: 50 }, { userId: 'kidB', bestValue: 125 }, { userId: 'dad', bestValue: 90 }] }),
      listIndexEntries: async () => [],
      get: async () => null,
    },
    cycleGameConfig: () => ({ featured_courses: [{ id: 'sprint', label: 'Sprint 1500' }] }),
    gliderRuns: { listAll: async () => [] },
    gliderActs: { list: () => [] },
    fitnessRings: { standings: async ({ learnerIds }) => learnerIds.map((learnerId) => ({ learnerId, rings: 0 })) },
    sessions: { listSessionsInRange: async () => [] },
    now: () => Date.parse('2026-11-10T00:00:00Z'),
    ...over,
  };
}

const args = (over = {}) => ({ learnerIds: ['kidA', 'kidB'], week, ringMs, contestClosed: false, today: '2026-11-04', studyDay, ...over });

describe('helpers', () => {
  it('turns a Monday into its ISO week and scores ladder values higher-better', () => {
    expect(isoWeekParam('2026-11-02')).toBe('2026-W45');
    expect(isoWeekParam('2026-12-28')).toBe('2026-W53');
    expect(ladderScore({ win_condition: 'distance' }, 100)).toBe(10000);
    expect(ladderScore({ win_condition: 'time' }, 2400)).toBe(2400);
    expect(ladderScore({ win_condition: 'time' }, 0)).toBeNull();
  });

  it('finds strict personal bests, never the first race, never lobby or ghost', () => {
    const pbs = findPersonalBests([
      entry('20261101100000', 'sprint', { kidA: 120, 'ghost:kidA': 10 }),
      entry('20261103100000', 'sprint', { kidA: 110, kidB: 200 }),
      entry('20261104100000', 'sprint', { kidA: 110 }),
      entry('20261105100000', null, { kidA: 50 }),
      entry('20261105110000', 'sprint', { kidA: null }),
    ], ['kidA', 'kidB']);
    expect(pbs).toEqual([{ learnerId: 'kidA', courseId: 'sprint', raceId: '20261103100000', date: '2026-11-03' }]);
  });

  it('an incomplete (ended-early) race is never a personal best and never sets the bar', () => {
    const pbs = findPersonalBests([
      entry('20261101100000', 'sprint', { kidA: 120 }),
      entry('20261102100000', 'sprint', { kidA: 60 }, { incomplete: true }),
      entry('20261103100000', 'sprint', { kidA: 110 }),
    ], ['kidA']);
    expect(pbs.map((p) => p.raceId)).toEqual(['20261103100000']);
    // an incomplete first ride does not become the bar a later ride must beat
    const first = findPersonalBests([
      entry('20261101100000', 'sprint', { kidA: 60 }, { incomplete: true }),
      entry('20261102100000', 'sprint', { kidA: 120 }),
      entry('20261103100000', 'sprint', { kidA: 110 }),
    ], ['kidA']);
    expect(first.map((p) => p.raceId)).toEqual(['20261103100000']);
  });

  it('keeps courses with the same id but a different goal apart', () => {
    const pbs = findPersonalBests([
      entry('20261101100000', 'sprint', { kidA: 120 }),
      entry('20261103100000', 'sprint', { kidA: 300 }, { goal_m: 3000 }),
      entry('20261104100000', 'sprint', { kidA: 250 }, { goal_m: 3000 }),
    ], ['kidA']);
    expect(pbs.map((p) => p.raceId)).toEqual(['20261104100000']);
  });
});

describe('createFitnessAchievementProvider', () => {
  it('declares its activities and requires its deps', () => {
    const p = createFitnessAchievementProvider(deps());
    expect(p.name).toBe('fitness');
    expect(p.activities).toEqual(['race', 'race-pb', 'glider-act', 'glider-bells', 'ring-improved', 'rings-lifetime']);
    expect(() => createFitnessAchievementProvider({ ...deps(), sessions: {} })).toThrow(/sessions/);
  });

  it('race: roster-only ladder standings, scored higher-better, open until the week is over', async () => {
    let asked;
    const d = deps();
    const getLadder = d.races.getLadder;
    d.races.getLadder = async (q) => { asked = q; return getLadder(q); };
    const p = createFitnessAchievementProvider(d);
    const out = await p.week(args());
    expect(asked.week).toBe('2026-W45');
    // The score ranks; `value`/`unit` and the course are what a child reads (a distance course: seconds).
    expect(out.contests.race).toEqual({
      standings: [{ learnerId: 'kidA', score: 10000, value: 100, unit: 'seconds' }, { learnerId: 'kidB', score: 8000, value: 125, unit: 'seconds' }],
      course: 'Sprint 1500', closed: false,
    });
    expect((await p.week(args({ today: '2026-11-09' }))).contests.race.closed).toBe(true);
  });

  it('race-pb: dated by the race epoch study day, labelled with the course', async () => {
    const d = deps();
    d.races.listIndexEntries = async () => [
      entry('20261025100000', 'sprint', { kidA: 120 }),
      entry('20261102010000', 'sprint', { kidA: 115 }), // local 01:00 Mon, but its UTC epoch is Sunday's study day
      entry('20261104100000', 'sprint', { kidA: 110 }),
    ];
    d.races.get = async (id) => ({ race: { id, date: id === '20261102010000' ? '2026-11-02T01:00:00Z' : '2026-11-04T10:00:00Z' } });
    const out = await createFitnessAchievementProvider(d).week(args());
    expect(out.learners.kidA.milestones['race-pb']).toEqual([{ key: 'sprint:20261104100000', day: '2026-11-04', label: 'New best on Sprint 1500' }]);
    expect(out.learners.kidB.milestones['race-pb']).toEqual([]);
  });

  it('glider: first completion from the run log; every bell judged against the act bell set', async () => {
    const run = (id, rider, course, endedAt, status, collectibles) => ({ run: { id, course_id: course, status, ended_at: endedAt }, rider: { user_id: rider }, collectibles });
    const d = deps({
      gliderActs: { list: () => [{ id: 'mountain-pass', name: 'Mountain Pass', segments: [
        { type: 'open' }, { type: 'collectible-path', collectibles: [{ id: 'b1' }, { id: 'b2' }] }] }] },
      gliderRuns: { listAll: async () => [
        run('r3', 'kidA', 'mountain-pass', '2026-11-03T18:00:00Z', 'completed', ['b1', 'b2']),
        run('r1', 'kidA', 'mountain-pass', '2026-10-20T18:00:00Z', 'completed', ['b1']),
        run('r4', 'kidB', 'mountain-pass', '2026-11-04T18:00:00Z', 'abandoned', ['b1', 'b2']),
        run('r5', 'kidB', 'mountain-pass', '2026-11-05T18:00:00Z', 'completed', ['b1']),
        run('r6', 'ghost:x', 'mountain-pass', '2026-11-05T18:00:00Z', 'completed', ['b1', 'b2']),
      ] },
    });
    const out = await createFitnessAchievementProvider(d).week(args());
    // KidA finished the act weeks ago — no act milestone this week; his first all-bell run is this week.
    expect(out.learners.kidA.milestones['glider-act']).toEqual([]);
    expect(out.learners.kidA.milestones['glider-bells']).toEqual([{ key: expect.stringMatching(/^mountain-pass:/), day: '2026-11-03', label: 'Every bell in Mountain Pass' }]);
    expect(out.learners.kidB.milestones['glider-act']).toEqual([{ key: 'mountain-pass', day: '2026-11-05', label: 'Finished Mountain Pass' }]);
    expect(out.learners.kidB.milestones['glider-bells'][0].day).toBe('2026-11-04');
    expect(out.learners.kidB.milestones['glider-bells'][0].key).toBe(out.learners.kidA.milestones['glider-bells'][0].key);
  });

  it('ring-improved: this week minus the 4-week mean; under 2 prior weeks with rings scores nothing', async () => {
    const byWeek = { 0: { kidA: 40, kidB: 30 }, 1: { kidA: 20, kidB: 30 }, 2: { kidA: 20 }, 3: {}, 4: { kidA: 10 } };
    const d = deps({ fitnessRings: { standings: async ({ learnerIds, fromMs }) => {
      const i = Math.round((MON4 - fromMs) / (7 * 24 * H));
      return learnerIds.map((learnerId) => ({ learnerId, rings: byWeek[i]?.[learnerId] ?? 0 }));
    } } });
    const out = await createFitnessAchievementProvider(d).week(args({ contestClosed: true }));
    expect(out.contests['ring-improved']).toEqual({ standings: [{ learnerId: 'kidA', score: 27.5 }], closed: true });
  });

  it('ringMarksCrossed: early marks, then every 10,000', async () => {
    const { ringMarksCrossed } = await import('./fitnessAchievementProvider.mjs');
    expect(ringMarksCrossed(900, 1200)).toEqual([1000]);
    expect(ringMarksCrossed(4000, 10500)).toEqual([5000, 10000]);
    expect(ringMarksCrossed(88_500, 91_200)).toEqual([90000]);
    expect(ringMarksCrossed(91_000, 91_500)).toEqual([]);
  });

  it('rings-lifetime: reports a mark crossed this week by a settled session, never a past one', async () => {
    const s = (id, start, rings, over = {}) => ({ sessionId: id, startTime: Date.parse(start), endTime: Date.parse(start) + H, finalized: true, participants: Object.fromEntries(Object.entries(rings).map(([k, n]) => [k, { rings: n }])), ...over });
    const d = deps({ sessions: { listSessionsInRange: async () => [
      s('c', '2026-11-03T18:00:00Z', { kidA: 30, kidB: 10 }),
      s('a', '2026-10-01T18:00:00Z', { kidA: 980, kidB: 4990 }),
      s('b', '2026-11-02T03:00:00Z', { kidA: 10 }), // before 4am Monday → Sunday's study day
      s('d', '2026-11-04T18:00:00Z', { kidB: 5 }, { finalized: false, endTime: Date.now() }),
    ] } });
    const out = await createFitnessAchievementProvider(d).week(args());
    expect(out.learners.kidA.milestones['rings-lifetime']).toEqual([{ key: '1000', day: '2026-11-03', label: '1,000 lifetime rings' }]);
    expect(out.learners.kidB.milestones['rings-lifetime']).toEqual([{ key: '5000', day: '2026-11-03', label: '5,000 lifetime rings' }]);
  });

  it('one failing source makes only its activities unavailable', async () => {
    const warns = [];
    const d = deps({
      gliderRuns: { listAll: async () => { throw new Error('disk gone'); } },
      logger: { warn: (e, data) => warns.push([e, data]), debug() {} },
    });
    const out = await createFitnessAchievementProvider(d).week(args());
    expect(out.unavailable.sort()).toEqual(['glider-act', 'glider-bells']);
    expect(out.learners.kidA.milestones['glider-act']).toBeUndefined();
    expect(out.learners.kidA.milestones['race-pb']).toEqual([]);
    expect(out.contests.race.standings.length).toBe(2);
    expect(warns[0][0]).toBe('fitness.achievements.source-failed');
  });
});
