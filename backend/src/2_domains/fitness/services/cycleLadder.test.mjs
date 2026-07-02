import { describe, it, expect } from 'vitest';
import {
  currentWeekWindow, isoWeekOf, parseIsoWeekParam, resolveFeaturedCourse,
  raceMatchesCourse, computeLadder, computePersonalBest
} from './cycleLadder.mjs';

const COURSE_D = { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 };
const COURSE_T = { id: 'endurance-5min', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 };

const entry = (id, date, parts, over = {}) => ({
  id, date, course_id: ('course_id' in over) ? over.course_id : 'sprint-1500m',
  win_condition: ('win_condition' in over) ? over.win_condition : 'distance',
  goal_m: ('goal_m' in over) ? over.goal_m : 1500,
  time_cap_s: ('time_cap_s' in over) ? over.time_cap_s : null,
  participants: parts
});
const p = (userId, timeS, distM = 1500, over = {}) => ({
  userId, isGhost: false, final_time_s: timeS, final_distance_m: distM, placement: null, ...over
});

describe('week math', () => {
  it('currentWeekWindow spans local Monday to next Monday (exclusive)', () => {
    // Wed 2026-07-01 → Mon 2026-06-29 .. Mon 2026-07-06
    expect(currentWeekWindow(new Date(2026, 6, 1, 15, 0))).toEqual({ start: '2026-06-29', end: '2026-07-06' });
    // A Monday maps to itself
    expect(currentWeekWindow(new Date(2026, 5, 29, 0, 1)).start).toBe('2026-06-29');
    // Sunday belongs to the week that STARTED the previous Monday
    expect(currentWeekWindow(new Date(2026, 6, 5, 23, 59)).start).toBe('2026-06-29');
  });
  it('isoWeekOf matches known ISO weeks', () => {
    expect(isoWeekOf(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 });   // Thu 2026-01-01
    expect(isoWeekOf(new Date(2026, 6, 1)).week).toBe(27);                       // Wed 2026-07-01
  });
  it('parseIsoWeekParam round-trips and rejects garbage', () => {
    const r = parseIsoWeekParam('2026-W27');
    expect(r.week).toBe(27);
    expect(r.window).toEqual({ start: '2026-06-29', end: '2026-07-06' });
    expect(parseIsoWeekParam('nope')).toBeNull();
    expect(parseIsoWeekParam('2026-W99')).toBeNull();
  });
});

describe('resolveFeaturedCourse', () => {
  const cfg = { featured_courses: [COURSE_D, COURSE_T] };
  it('rotates by ISO week number', () => {
    expect(resolveFeaturedCourse(cfg, 26).id).toBe('sprint-1500m');
    expect(resolveFeaturedCourse(cfg, 27).id).toBe('endurance-5min');
  });
  it('override pins a course; unknown override falls back to rotation', () => {
    expect(resolveFeaturedCourse({ ...cfg, featured_course_override: 'endurance-5min' }, 26).id).toBe('endurance-5min');
    expect(resolveFeaturedCourse({ ...cfg, featured_course_override: 'ghost-town' }, 26).id).toBe('sprint-1500m');
  });
  it('null when no courses configured', () => {
    expect(resolveFeaturedCourse({}, 27)).toBeNull();
    expect(resolveFeaturedCourse({ featured_courses: [] }, 27)).toBeNull();
  });
});

describe('raceMatchesCourse', () => {
  it('matches by course_id', () => {
    expect(raceMatchesCourse(entry('x', '2026-06-30', []), COURSE_D)).toBe(true);
  });
  it('legacy fallback: null course_id but same win_condition + goal', () => {
    const legacy = entry('x', '2026-06-30', [], { course_id: null });
    expect(raceMatchesCourse(legacy, COURSE_D)).toBe(true);
    expect(raceMatchesCourse(entry('x', '2026-06-30', [], { course_id: null, goal_m: 2500 }), COURSE_D)).toBe(false);
    expect(raceMatchesCourse(entry('x', '2026-06-30', [], { course_id: null, win_condition: 'time', time_cap_s: 300, goal_m: null }), COURSE_T)).toBe(true);
  });
});

describe('computeLadder', () => {
  const W = { weekStart: '2026-06-29', weekEnd: '2026-07-06' };
  it('best-per-rider within the week, ranked ascending time for distance courses', () => {
    const entries = [
      entry('20260629080000', '2026-06-29', [p('dad', 150), p('milo', 190)]),
      entry('20260701080000', '2026-07-01', [p('milo', 170)]),
      entry('20260620080000', '2026-06-20', [p('dad', 140)]) // outside week
    ];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings).toEqual([
      { userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 },
      { userId: 'milo', bestValue: 170, raceId: '20260701080000', attempts: 2 }
    ]);
    expect(l.allTimeRecord).toEqual({ userId: 'dad', bestValue: 140, raceId: '20260620080000', date: '2026-06-20' });
    expect(l.week).toEqual({ start: '2026-06-29', end: '2026-07-06' });
  });
  it('time course ranks by max distance; zero distance never qualifies', () => {
    const entries = [entry('20260630080000', '2026-06-30',
      [p('dad', null, 2100), p('milo', null, 2400), p('alan', null, 0)],
      { course_id: 'endurance-5min', win_condition: 'time', time_cap_s: 300, goal_m: null })];
    const l = computeLadder({ course: COURSE_T, entries, ...W });
    expect(l.standings.map((s) => s.userId)).toEqual(['milo', 'dad']);
  });
  it('excludes ghosts and null finish times (DNF) on distance courses', () => {
    const entries = [entry('20260630080000', '2026-06-30', [
      p('dad', 150),
      p('ghost:20260601080000:dad', 145, 1500, { isGhost: true }),
      p('milo', null) // rode but never finished
    ])];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings).toHaveLength(1);
    expect(l.standings[0].userId).toBe('dad');
  });
  it('tie goes to the earlier raceId', () => {
    const entries = [
      entry('20260630080000', '2026-06-30', [p('milo', 150)]),
      entry('20260629080000', '2026-06-29', [p('dad', 150)])
    ];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings.map((s) => s.userId)).toEqual(['dad', 'milo']);
  });
});

describe('computePersonalBest', () => {
  it('returns the all-time best for one rider, or best:null', () => {
    const entries = [
      entry('20260620080000', '2026-06-20', [p('milo', 190)]),
      entry('20260630080000', '2026-06-30', [p('milo', 170)])
    ];
    expect(computePersonalBest({ entries, course: COURSE_D, userId: 'milo' })).toEqual({
      userId: 'milo', courseId: 'sprint-1500m',
      best: { bestValue: 170, raceId: '20260630080000', date: '2026-06-30' }
    });
    expect(computePersonalBest({ entries, course: COURSE_D, userId: 'nobody' }).best).toBeNull();
  });
});
