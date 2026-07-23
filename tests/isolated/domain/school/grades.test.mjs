import { describe, it, expect } from 'vitest';
import { GRADES, gradeRank, gradeFromLabels, isVisibleAtCeiling } from '#domains/school/grades.mjs';

describe('school grade ladder', () => {
  it('is the six-tier ascending ladder', () => {
    expect(GRADES).toEqual(['early', 'lower', 'upper', 'middle', 'high', 'ap']);
  });

  it('ranks by ascending position, -1 for unknown', () => {
    expect(gradeRank('early')).toBe(0);
    expect(gradeRank('ap')).toBe(5);
    expect(gradeRank('bogus')).toBe(-1);
  });
});

describe('gradeFromLabels', () => {
  it('extracts the grade token from a label list', () => {
    expect(gradeFromLabels(['school:on', 'subject:math', 'grade:high'])).toBe('high');
  });

  it('is case-insensitive (Plex title-cases label tags)', () => {
    expect(gradeFromLabels(['School:on', 'Grade:Upper'])).toBe('upper');
  });

  it('returns null when no grade label is present', () => {
    expect(gradeFromLabels(['school:on', 'subject:math'])).toBeNull();
    expect(gradeFromLabels([])).toBeNull();
  });
});

describe('isVisibleAtCeiling', () => {
  it('shows content at or below the household ceiling', () => {
    expect(isVisibleAtCeiling('lower', 'upper')).toBe(true);
    expect(isVisibleAtCeiling('upper', 'upper')).toBe(true);
  });

  it('hides content above the ceiling (dormant until the household grows into it)', () => {
    expect(isVisibleAtCeiling('high', 'upper')).toBe(false);
    expect(isVisibleAtCeiling('ap', 'upper')).toBe(false);
  });

  it('treats a missing min-grade as open to all (absence never hides)', () => {
    expect(isVisibleAtCeiling(null, 'upper')).toBe(true);
    expect(isVisibleAtCeiling(null, 'early')).toBe(true);
  });

  it('shows everything when no ceiling is configured', () => {
    expect(isVisibleAtCeiling('ap', null)).toBe(true);
    expect(isVisibleAtCeiling('high', null)).toBe(true);
  });

  it('fails closed: a present-but-unknown grade is hidden, not shown', () => {
    expect(isVisibleAtCeiling('bogus', 'upper')).toBe(false);
  });

  it('fails safe: an invalid ceiling restricts to the lowest rung, never opens wide', () => {
    expect(isVisibleAtCeiling('high', 'bogus')).toBe(false);
    expect(isVisibleAtCeiling(null, 'bogus')).toBe(true);
  });
});
