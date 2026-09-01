import { describe, expect, it } from 'vitest';
import { lessonProgressRows, lessonProgressRowsFromPlan } from './lessonProgress.mjs';

const assignment = {
  courses: [{
    courseId: 'math-course',
    enrollment: {
      moduleOrder: ['foundations', 'number-sense', 'enrichment'],
      optionalModules: ['enrichment'],
      lessonOrder: {
        foundations: ['foundations-1'],
        'number-sense': ['place-value', 'number-forms', 'optional-practice'],
        enrichment: ['challenge'],
      },
    },
  }],
};

const works = [{
  work: 'math-course',
  title: 'Elementary Mathematics',
  short_title: 'Elementary Math',
  modules: [
    { module: 'foundations', title: 'Foundations', number: 1 },
    { module: 'number-sense', title: 'Number Sense and Place Value', short_title: 'Number Sense', number: 2 },
    { module: 'enrichment', title: 'Enrichment', number: 3 },
  ],
}];

describe('lessonProgressRowsFromPlan', () => {
  it('projects course and current-module rows from the canonical plan without counting electives', () => {
    const plan = { entries: [
      { unitId: 'foundations-1', courseId: 'math-course', module: 'foundations', status: 'completed' },
      { unitId: 'place-value', courseId: 'math-course', module: 'number-sense', status: 'completed' },
      { unitId: 'number-forms', courseId: 'math-course', module: 'number-sense', status: 'in_progress' },
      { unitId: 'optional-practice', courseId: 'math-course', module: 'number-sense', status: 'available', elective: true },
      { unitId: 'challenge', courseId: 'math-course', module: 'enrichment', status: 'completed' },
    ] };

    expect(lessonProgressRowsFromPlan({
      plan,
      unit: { unitId: 'number-forms', courseId: 'math-course', module: 'number-sense', title: 'Number Forms' },
      assignment,
      works,
    })).toEqual([
      { label: 'Elementary Math', completed: 1, total: 2, inProgress: 1 },
      { label: 'Number Sense', completed: 1, total: 2, inProgress: 1 },
    ]);
  });

  it('returns no rows when the supplied plan or course context cannot provide real denominators', () => {
    expect(lessonProgressRowsFromPlan({
      plan: { entries: [] }, unit: { unitId: 'standalone' }, assignment, works,
    })).toBeNull();
    expect(lessonProgressRowsFromPlan({
      plan: null, unit: { unitId: 'place-value', courseId: 'math-course' }, assignment, works,
    })).toBeNull();
  });

  it('keeps the compatibility wrapper for callers that need it to build the plan', () => {
    const units = [
      { unitId: 'foundations-1', courseId: 'math-course', module: 'foundations', sequence: 1, required: true },
      { unitId: 'place-value', courseId: 'math-course', module: 'number-sense', sequence: 2, required: true },
      { unitId: 'number-forms', courseId: 'math-course', module: 'number-sense', sequence: 3, required: true },
    ];
    const sessions = [
      { sessionId: 's1', unitId: 'foundations-1', terminal: true, outcome: { result: 'passed' } },
      { sessionId: 's2', unitId: 'place-value', terminal: true, outcome: { result: 'passed' } },
      { sessionId: 's3', unitId: 'number-forms', terminal: false, state: 'created' },
    ];

    expect(lessonProgressRows({
      learnerId: 'user_4',
      unit: units[2],
      assignment,
      units,
      sessions,
      works,
      now: '2026-09-01T16:00:00.000Z',
      timezone: 'America/Los_Angeles',
    })).toEqual([
      { label: 'Elementary Math', completed: 1, total: 2, inProgress: 1 },
      { label: 'Number Sense', completed: 1, total: 2, inProgress: 1 },
    ]);
  });
});
