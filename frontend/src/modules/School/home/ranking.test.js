import { describe, it, expect } from 'vitest';
import { GRADES, gradeRank, gradeFromBirthyear, rankWithin } from './ranking.js';

describe('GRADES', () => {
  it('is the ladder in ascending order', () => {
    expect(GRADES).toEqual(['early', 'lower', 'upper', 'middle', 'high', 'ap']);
  });
});

describe('gradeRank', () => {
  it('returns the ascending ladder index', () => {
    expect(gradeRank('upper')).toBe(2);
  });
  it('is case-insensitive', () => {
    expect(gradeRank('AP')).toBe(5);
  });
  it('returns -1 for unknown tiers', () => {
    expect(gradeRank('bogus')).toBe(-1);
  });
  it('returns -1 for null', () => {
    expect(gradeRank(null)).toBe(-1);
  });
});

describe('gradeFromBirthyear (now=2026)', () => {
  const now = 2026;
  it('2020 -> early (schoolYear 1)', () => {
    expect(gradeFromBirthyear(2020, now)).toBe('early');
  });
  it('2022 -> early (schoolYear -1, clamped)', () => {
    expect(gradeFromBirthyear(2022, now)).toBe('early');
  });
  it('2018 -> lower (schoolYear 3)', () => {
    expect(gradeFromBirthyear(2018, now)).toBe('lower');
  });
  it('2016 -> upper (schoolYear 5)', () => {
    expect(gradeFromBirthyear(2016, now)).toBe('upper');
  });
  it('2014 -> middle (schoolYear 7)', () => {
    expect(gradeFromBirthyear(2014, now)).toBe('middle');
  });
  it('2011 -> high (schoolYear 10)', () => {
    expect(gradeFromBirthyear(2011, now)).toBe('high');
  });
  it('2008 -> ap (schoolYear 13)', () => {
    expect(gradeFromBirthyear(2008, now)).toBe('ap');
  });
});

describe('rankWithin', () => {
  it('orders started before fresh (grade-fit asc) before done', () => {
    const items = [
      { id: 'a', minGrade: 'high' }, // fresh, far from an 'upper' student
      { id: 'b', minGrade: 'upper' }, // started
      { id: 'c', minGrade: 'lower' }, // fresh, near
      { id: 'd', minGrade: 'upper' }, // done
      { id: 'e' }, // fresh, no minGrade = perfect fit
    ];
    const progress = [
      { materialId: 'b', unitsDone: 1, unitTotal: 3, lastActivity: '2026-07-20T10:00:00Z' },
      { materialId: 'd', unitsDone: 4, unitTotal: 4, lastActivity: '2026-07-21T10:00:00Z' }, // done
    ];
    const out = rankWithin(items, { progress, studentGrade: 'upper' });
    expect(out.map((i) => i.id)).toEqual(['b', 'e', 'c', 'a', 'd']);
  });

  it('orders two started items by lastActivity descending', () => {
    const items = [
      { id: 'x' },
      { id: 'y' },
    ];
    const progress = [
      { materialId: 'x', unitsDone: 1, unitTotal: 3, lastActivity: '2026-07-19T10:00:00Z' },
      { materialId: 'y', unitsDone: 1, unitTotal: 3, lastActivity: '2026-07-22T10:00:00Z' },
    ];
    const out = rankWithin(items, { progress, studentGrade: 'upper' });
    expect(out.map((i) => i.id)).toEqual(['y', 'x']);
  });

  it('guest (studentGrade null) leaves fresh items in original order', () => {
    const items = [
      { id: 'a', minGrade: 'high' },
      { id: 'b', minGrade: 'upper' },
      { id: 'c', minGrade: 'lower' },
      { id: 'e' },
    ];
    const out = rankWithin(items, { studentGrade: null });
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('is pure: does not mutate items or progress', () => {
    const items = [
      { id: 'a', minGrade: 'high' },
      { id: 'b', minGrade: 'upper' },
      { id: 'c', minGrade: 'lower' },
      { id: 'd', minGrade: 'upper' },
      { id: 'e' },
    ];
    const progress = [
      { materialId: 'b', unitsDone: 1, unitTotal: 3, lastActivity: '2026-07-20T10:00:00Z' },
      { materialId: 'd', unitsDone: 4, unitTotal: 4, lastActivity: '2026-07-21T10:00:00Z' },
    ];
    const beforeItems = items.map((i) => i.id);
    const beforeProgress = progress.map((p) => ({ ...p }));
    const out = rankWithin(items, { progress, studentGrade: 'upper' });
    expect(items.map((i) => i.id)).toEqual(beforeItems);
    expect(progress).toEqual(beforeProgress);
    expect(out).not.toBe(items);
  });
});
