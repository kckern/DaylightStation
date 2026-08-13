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
      assignments: [{ learnerId: 'felix', courses: ['math-fractions', 'ghost-course'] }],
    });
    expect(m.rows[0].deadRefs).toEqual(['ghost-course']);
  });

  it('flags ORPHAN assignment records — ids not on the roster still holding courses', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      assignments: [{ learnerId: 'departed-kid', courses: ['math-fractions'] }],
    });
    expect(m.orphanLearners).toEqual(['departed-kid']);
  });
});

describe('deriveMatrix — enrollment cells', () => {
  const SYLLABI = [{ syllabusId: 'atlas-upper', title: 'Atlas — upper', courseId: 'history-capitals' }];

  it('names the syllabus and profile in the cell', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{
        learnerId: 'felix',
        courses: [{ courseId: 'history-capitals', profile: 'upper', syllabusId: 'atlas-upper', enrollment: { schema: 'school.course-enrollment/v1' } }],
      }],
    });
    const cell = m.rows[0].cells['history-capitals'];
    expect(cell).toMatchObject({ enrolled: true, syllabusId: 'atlas-upper', syllabusTitle: 'Atlas — upper', profile: 'upper', managed: true });
  });

  it('marks a hand-authored enrollment as unmanaged rather than broken', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{ learnerId: 'felix', courses: [{ courseId: 'history-capitals', profile: 'upper', enrollment: { schema: 'school.course-enrollment/v1' } }] }],
    });
    expect(m.rows[0].cells['history-capitals']).toMatchObject({ enrolled: true, managed: false, profile: 'upper' });
  });

  it('treats a bare-string course as enrolled with no enrollment record', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: [],
      assignments: [{ learnerId: 'milo', courses: ['math-fractions'] }],
    });
    expect(m.rows[1].cells['math-fractions']).toMatchObject({ enrolled: true, managed: false, syllabusId: null });
  });

  it('leaves an unassigned intersection absent from cells', () => {
    const m = deriveMatrix({ kids: KIDS, units: UNITS, syllabi: [], assignments: [] });
    expect(m.rows[0].cells['math-fractions']).toBeUndefined();
  });
});
