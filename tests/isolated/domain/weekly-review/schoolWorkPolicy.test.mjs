// tests/isolated/domain/weekly-review/schoolWorkPolicy.test.mjs
import { describe, it, expect } from 'vitest';
import { curateSchoolWork, dedupeWorkItems } from "../../../../__app_modules/personal/weekly-review/server/domain/schoolWorkPolicy.mjs";

const DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'];

function item(overrides) {
  return {
    learnerId: 'kid-a',
    learnerName: 'Kid A',
    kind: 'course',
    verb: 'worked',
    title: 'Course',
    subtitle: null,
    at: `${overrides.studyDay || '2026-03-23'}T10:00:00.000Z`,
    studyDay: '2026-03-23',
    imageUrl: null,
    groupKey: 'course:c1',
    weight: 1,
    subject: null,
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('curateSchoolWork', () => {
  it('gives every date a key with empty lists for empty input', () => {
    const result = curateSchoolWork([], DATES);
    expect(Object.keys(result)).toEqual(DATES);
    for (const date of DATES) expect(result[date]).toEqual({ school: [], schoolAll: [] });
  });

  it('drops items whose studyDay is outside the window', () => {
    const result = curateSchoolWork([
      item({ studyDay: '2026-03-22', groupKey: 'course:old' }),
      item({ studyDay: '2026-03-30', groupKey: 'course:new' }),
      item({ studyDay: '2026-03-24', groupKey: 'course:in' }),
    ], DATES);
    const all = Object.values(result).flatMap(day => day.schoolAll);
    expect(all.map(i => i.groupKey)).toEqual(['course:in']);
    expect(result['2026-03-22']).toBeUndefined();
  });

  it('keeps every in-window item in schoolAll sorted by at, unmerged', () => {
    const result = curateSchoolWork([
      item({ studyDay: '2026-03-23', at: '2026-03-23T15:00:00.000Z', title: 'late' }),
      item({ studyDay: '2026-03-23', at: '2026-03-23T09:00:00.000Z', title: 'early', learnerId: 'kid-b' }),
      item({ studyDay: '2026-03-23', at: '2026-03-23T12:00:00.000Z', title: 'mid', kind: 'activity', groupKey: 'activity:x' }),
    ], DATES);
    expect(result['2026-03-23'].schoolAll.map(i => i.title)).toEqual(['early', 'mid', 'late']);
    expect(result['2026-03-23'].schoolAll.every(i => i.subtitle === null)).toBe(true);
  });

  it('places a 4-session course on its heaviest day with a session count', () => {
    const result = curateSchoolWork([
      item({ studyDay: '2026-03-23', weight: 1, subtitle: 'Unit 3' }),
      item({ studyDay: '2026-03-24', weight: 3, subtitle: 'Unit 4' }),
      item({ studyDay: '2026-03-24', weight: 1, subtitle: 'Unit 5', at: '2026-03-24T11:00:00.000Z' }),
      item({ studyDay: '2026-03-26', weight: 2, subtitle: 'Unit 6' }),
    ], DATES);
    expect(result['2026-03-23'].school).toEqual([]);
    expect(result['2026-03-26'].school).toEqual([]);
    expect(result['2026-03-24'].school).toHaveLength(1);
    const [kept] = result['2026-03-24'].school;
    expect(kept.subtitle).toBe('Unit 4 · 4 sessions this week');
    expect(kept.weight).toBe(7);
    expect(result['2026-03-24'].schoolAll).toHaveLength(2);
  });

  it('breaks a weight tie toward the latest day', () => {
    const result = curateSchoolWork([
      item({ studyDay: '2026-03-23', weight: 2 }),
      item({ studyDay: '2026-03-25', weight: 2 }),
    ], DATES);
    expect(result['2026-03-23'].school).toEqual([]);
    expect(result['2026-03-25'].school[0].subtitle).toBe('2 sessions this week');
  });

  it('suffixes program groups with days and leaves other kinds unsuffixed', () => {
    const result = curateSchoolWork([
      item({ kind: 'program', verb: 'worked', groupKey: 'program:p', studyDay: '2026-03-23', subtitle: 'Korean' }),
      item({ kind: 'program', verb: 'worked', groupKey: 'program:p', studyDay: '2026-03-24', subtitle: 'Korean' }),
      item({ kind: 'activity', verb: 'completed', groupKey: 'activity:a', studyDay: '2026-03-23', learnerId: 'kid-b', subtitle: 'Maze' }),
      item({ kind: 'activity', verb: 'completed', groupKey: 'activity:a', studyDay: '2026-03-24', learnerId: 'kid-b', subtitle: 'Maze' }),
    ], DATES);
    const school = Object.values(result).flatMap(day => day.school);
    expect(school.find(i => i.kind === 'program').subtitle).toBe('Korean · 2 days this week');
    expect(school.find(i => i.kind === 'activity').subtitle).toBe('Maze');
  });

  it('prefers a finished book over a course for the same child on the same day', () => {
    const result = curateSchoolWork([
      item({ kind: 'course', verb: 'completed', groupKey: 'course:c1', weight: 10 }),
      item({ kind: 'book', verb: 'finished', groupKey: 'book:r1:finished', title: 'The Book', weight: 1 }),
    ], DATES);
    expect(result['2026-03-23'].school.map(i => i.title)).toEqual(['The Book']);
    expect(result['2026-03-23'].schoolAll).toHaveLength(2);
  });

  it('ranks the full priority ladder and uses weight to break ties', () => {
    const ladder = [
      ['program', 'worked'], ['course', 'worked'], ['book', 'started'],
      ['activity', 'completed'], ['course', 'completed'], ['book', 'finished'],
    ];
    const items = ladder.map(([kind, verb], idx) => item({ kind, verb, groupKey: `${kind}:${verb}`, title: `${kind}-${verb}`, weight: 10 - idx }));
    let remaining = items;
    const winners = [];
    while (remaining.length) {
      const [winner] = curateSchoolWork(remaining, DATES)['2026-03-23'].school;
      winners.push(winner.title);
      remaining = remaining.filter(i => i.title !== winner.title);
    }
    expect(winners).toEqual(['book-finished', 'course-completed', 'activity-completed', 'book-started', 'course-worked', 'program-worked']);

    const tie = curateSchoolWork([
      item({ kind: 'activity', verb: 'completed', groupKey: 'activity:light', title: 'light', weight: 1 }),
      item({ kind: 'activity', verb: 'completed', groupKey: 'activity:heavy', title: 'heavy', weight: 5 }),
    ], DATES);
    expect(tie['2026-03-23'].school.map(i => i.title)).toEqual(['heavy']);
  });

  it('keeps one item per child, so two children give two items sorted by at', () => {
    const result = curateSchoolWork([
      item({ learnerId: 'kid-a', groupKey: 'course:a1', at: '2026-03-23T14:00:00.000Z', title: 'a1' }),
      item({ learnerId: 'kid-a', groupKey: 'course:a2', at: '2026-03-23T15:00:00.000Z', title: 'a2' }),
      item({ learnerId: 'kid-b', groupKey: 'course:b1', at: '2026-03-23T09:00:00.000Z', title: 'b1' }),
    ], DATES);
    const school = result['2026-03-23'].school;
    expect(school).toHaveLength(2);
    expect(school.map(i => i.learnerId)).toEqual(['kid-b', 'kid-a']);
  });

  it('never merges a shared groupKey across children', () => {
    const result = curateSchoolWork([
      item({ learnerId: 'kid-a', groupKey: 'course:shared', studyDay: '2026-03-23', weight: 1 }),
      item({ learnerId: 'kid-a', groupKey: 'course:shared', studyDay: '2026-03-24', weight: 2 }),
      item({ learnerId: 'kid-b', groupKey: 'course:shared', studyDay: '2026-03-25', weight: 2 }),
      item({ learnerId: 'kid-b', groupKey: 'course:shared', studyDay: '2026-03-26', weight: 1 }),
    ], DATES);
    const school = Object.values(result).flatMap(day => day.school);
    expect(school.map(i => [i.learnerId, i.studyDay, i.weight, i.subtitle])).toEqual([
      ['kid-a', '2026-03-24', 3, '2 sessions this week'],
      ['kid-b', '2026-03-25', 3, '2 sessions this week'],
    ]);
  });

  it('does not mutate its inputs', () => {
    const items = deepFreeze([
      item({ studyDay: '2026-03-23', weight: 1 }),
      item({ studyDay: '2026-03-24', weight: 2 }),
    ]);
    const dates = deepFreeze([...DATES]);
    const result = curateSchoolWork(items, dates);
    expect(result['2026-03-24'].school[0].weight).toBe(3);
    expect(items[1].weight).toBe(2);
    expect(items[1].subtitle).toBeNull();
  });

  it('never adds a score field', () => {
    const result = curateSchoolWork([item({}), item({ studyDay: '2026-03-24' })], DATES);
    const all = Object.values(result).flatMap(day => [...day.school, ...day.schoolAll]);
    for (const entry of all) expect(Object.keys(entry).sort()).toEqual(Object.keys(item({})).sort());
  });
});

describe('dedupeWorkItems', () => {
  it('returns one item per groupKey carrying the group total weight', () => {
    const result = dedupeWorkItems([
      item({ studyDay: '2026-03-23', weight: 1 }),
      item({ studyDay: '2026-03-24', weight: 2 }),
      item({ groupKey: 'book:r1:finished', kind: 'book', verb: 'finished', weight: 1 }),
    ]);
    expect(result).toHaveLength(2);
    const course = result.find(i => i.groupKey === 'course:c1');
    expect(course.studyDay).toBe('2026-03-24');
    expect(course.weight).toBe(3);
    expect(course.subtitle).toBe('2 sessions this week');
  });
});
