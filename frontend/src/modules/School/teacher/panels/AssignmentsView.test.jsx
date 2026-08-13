import { describe, it, expect } from 'vitest';
import { mergeEntries } from './AssignmentsView.jsx';

const ENROLLED = {
  courseId: 'young-peoples-atlas-us',
  profile: 'upper',
  enrollment: {
    schema: 'school.course-enrollment/v1',
    enrollmentId: 'enr-felix-young-peoples-atlas-us',
    courseId: 'young-peoples-atlas-us',
    profile: 'upper',
    moduleOrder: ['united-states', 'midwest'],
    optionalModules: ['bonus'],
    lessonOrder: { midwest: ['atlas-us-p012-midwest'] },
  },
};

describe('mergeEntries — a save must never flatten an enrollment', () => {
  it('keeps the whole object entry for a course that stays checked', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us'], 'courseId');
    expect(out).toEqual([ENROLLED]);
    expect(out[0].enrollment.lessonOrder.midwest).toEqual(['atlas-us-p012-midwest']);
  });

  it('drops an entry the teacher unchecked', () => {
    expect(mergeEntries([ENROLLED], [], 'courseId')).toEqual([]);
  });

  it('adds a newly checked id as a bare string', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us', 'math-fractions'], 'courseId');
    expect(out).toEqual([ENROLLED, 'math-fractions']);
  });

  it('preserves a bare string entry as a bare string', () => {
    expect(mergeEntries(['math-fractions'], ['math-fractions'], 'courseId')).toEqual(['math-fractions']);
  });

  it('preserves unknown fields on an object entry it does not understand', () => {
    const odd = { courseId: 'x', elective: true, somethingNew: 42 };
    expect(mergeEntries([odd], ['x'], 'courseId')).toEqual([odd]);
  });
});
