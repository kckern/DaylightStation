import { describe, it, expect } from 'vitest';
import { deriveMatrix } from './SchoolMatrix.jsx';

const KIDS = [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }];
const UNITS = [
  { unitId: 'frac.01', courseId: 'math-fractions' },
  { unitId: 'caps.01', courseId: 'history-capitals' },
  { unitId: 'poke.01', courseId: 'pokemon-basics' },
];

describe('deriveMatrix (admin advocacy A4 — the bird\'s-eye view)', () => {
  it('rows per kid, columns per published course, assignment dots where they meet', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      overrides: [],
      assignments: [
        { learnerId: 'felix', courses: ['math-fractions', { courseId: 'history-capitals', elective: true }] },
        { learnerId: 'milo', courses: ['math-fractions'] },
      ],
    });
    expect(m.courseIds).toEqual(['history-capitals', 'math-fractions', 'pokemon-basics']);
    expect([...m.rows[0].assigned].sort()).toEqual(['history-capitals', 'math-fractions']);
    expect(m.unenrolled).toEqual(['pokemon-basics']); // zero-enrollment flag
  });

  it('flags DEAD references — an assigned course the catalog no longer publishes', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      overrides: [],
      assignments: [{ learnerId: 'felix', courses: ['math-fractions', 'ghost-course'] }],
    });
    expect(m.rows[0].deadRefs).toEqual(['ghost-course']);
  });

  it('flags ORPHAN assignment records — ids not on the roster still holding courses', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      overrides: [],
      assignments: [{ learnerId: 'departed-kid', courses: ['math-fractions'] }],
    });
    expect(m.orphanLearners).toEqual(['departed-kid']);
  });

  it('marks a course whose unit carries an active pass-override', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      overrides: [{ unitId: 'frac.01', percent: 60 }],
      assignments: [],
    });
    expect(m.overriddenCourses.has('math-fractions')).toBe(true);
    expect(m.overriddenCourses.has('history-capitals')).toBe(false);
  });
});
