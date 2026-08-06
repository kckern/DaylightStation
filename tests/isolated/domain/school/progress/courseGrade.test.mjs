import { describe, it, expect } from 'vitest';
import {
  COURSE_GRADE_POLICY,
  courseGradeFromSessions,
} from '#domains/school/progress/courseGrade.mjs';

function row(overrides = {}) {
  return {
    sessionId: 's1',
    learnerId: 'learner1',
    unitId: 'u1',
    state: 'graded',
    result: null,
    gradedPercent: null,
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('courseGradeFromSessions', () => {
  it('a retake IMPROVES the grade — best-of per unit, never a mean over attempts', () => {
    const sessions = [
      row({ unitId: 'u1', gradedPercent: 60, result: 'needs_remediation', updatedAt: '2026-09-01T10:00:00.000Z' }),
      row({ unitId: 'u1', gradedPercent: 95, result: 'passed', updatedAt: '2026-09-03T10:00:00.000Z' }),
      row({ unitId: 'u2', gradedPercent: 80, result: 'passed', updatedAt: '2026-09-05T10:00:00.000Z' }),
    ];
    const grade = courseGradeFromSessions({ sessions, courseId: 'fractions', unitIds: ['u1', 'u2', 'u3'] });
    expect(grade.unitGrades).toEqual([
      { unitId: 'u1', bestPercent: 95, passed: true, attempts: 2 },
      { unitId: 'u2', bestPercent: 80, passed: true, attempts: 1 },
      { unitId: 'u3', bestPercent: null, passed: false, attempts: 0 },
    ]);
    expect(grade.coursePercent).toBe(87.5); // mean over attempted units only
    expect(grade.policy).toBe('best-of-unit-mean-v1');
    expect(grade.courseId).toBe('fractions');
  });

  it('the window excludes out-of-period sessions', () => {
    const sessions = [
      // Outside a Sep–Dec window — must not count toward best/attempts/passed.
      row({ unitId: 'u1', gradedPercent: 100, result: 'passed', updatedAt: '2026-06-01T10:00:00.000Z' }),
      row({ unitId: 'u1', gradedPercent: 70, result: 'passed', updatedAt: '2026-09-10T10:00:00.000Z' }),
    ];
    const grade = courseGradeFromSessions({
      sessions,
      courseId: 'fractions',
      unitIds: ['u1'],
      window: { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T23:59:59.000Z' },
    });
    expect(grade.unitGrades).toEqual([
      { unitId: 'u1', bestPercent: 70, passed: true, attempts: 1 },
    ]);
    expect(grade.coursePercent).toBe(70);
  });

  it('ungraded sessions (no gradedPercent) never count as attempts', () => {
    const sessions = [
      row({ unitId: 'u1', gradedPercent: null, result: null, state: 'open', updatedAt: '2026-09-01T10:00:00.000Z' }),
      row({ unitId: 'u1', gradedPercent: undefined, result: null, state: 'open', updatedAt: '2026-09-02T10:00:00.000Z' }),
    ];
    const grade = courseGradeFromSessions({ sessions, courseId: 'fractions', unitIds: ['u1'] });
    expect(grade.unitGrades).toEqual([
      { unitId: 'u1', bestPercent: null, passed: false, attempts: 0 },
    ]);
    expect(grade.coursePercent).toBeNull();
  });

  it('a session with result "passed" but no gradedPercent still marks passed=true without counting as an attempt', () => {
    const sessions = [
      row({ unitId: 'u1', gradedPercent: null, result: 'passed', updatedAt: '2026-09-01T10:00:00.000Z' }),
    ];
    const grade = courseGradeFromSessions({ sessions, courseId: 'fractions', unitIds: ['u1'] });
    expect(grade.unitGrades).toEqual([
      { unitId: 'u1', bestPercent: null, passed: true, attempts: 0 },
    ]);
    expect(grade.coursePercent).toBeNull();
  });

  it('exports the policy string constant', () => {
    expect(COURSE_GRADE_POLICY).toBe('best-of-unit-mean-v1');
  });
});
