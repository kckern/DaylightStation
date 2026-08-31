import { describe, expect, it } from 'vitest';
import { lessonProgressRows } from '#domains/school/lessonProgress.mjs';

describe('lessonProgressRows display labels', () => {
  it('uses authored compact course and module labels instead of generic or id labels', () => {
    const units = [
      { unitId: 'd1', courseId: 'cfm', module: 'w35', sequence: 1, title: 'Monday' },
      { unitId: 'd2', courseId: 'cfm', module: 'w35', sequence: 2, title: 'Tuesday' },
      { unitId: 'd3', courseId: 'cfm', module: 'w36', sequence: 3, title: 'Next week' },
    ];
    const enrollment = {
      moduleOrder: ['w35', 'w36'], optionalModules: [],
      lessonOrder: { w35: ['d1', 'd2'], w36: ['d3'] },
      progression: { mode: 'sequential', module_order: 'fixed', lesson_order: 'fixed', module_number_start: 35 },
    };
    const rows = lessonProgressRows({
      learnerId: 'learner4', unit: units[1], units, sessions: [],
      assignment: { courses: [{ courseId: 'cfm', enrollment }] },
      works: [{
        work: 'cfm', title: 'Come Follow Me — Old Testament 2026', short_title: 'Come Follow Me',
        progression: enrollment.progression,
        modules: [
          { module: 'w35', title: 'Aug 24–30 · Psalms 49–86', short_title: 'Psalms 49–86' },
          { module: 'w36', title: 'Aug 31–Sep 6 · Psalms 102–150', short_title: 'Psalms 102–150' },
        ],
      }],
    });
    expect(rows).toEqual([
      { label: 'Come Follow Me', completed: 0, total: 2, inProgress: 1 },
      { label: 'Psalms 49–86', completed: 0, total: 2, inProgress: 1 },
    ]);
  });

  it('excludes optional worksheets from module progress totals', () => {
    const units = [
      { unitId: 'r1', courseId: 'math', module: 'number-sense', sequence: 1, title: 'Required' },
      { unitId: 'o1', courseId: 'math', module: 'number-sense', sequence: 2, title: 'Practice', required: false },
    ];
    const enrollment = {
      moduleOrder: ['number-sense'], optionalModules: [], optionalLessons: ['o1'],
      lessonOrder: { 'number-sense': ['r1', 'o1'] }, progression: { mode: 'module_blocks', one_active_module: true },
    };
    const rows = lessonProgressRows({
      learnerId: 'learner', unit: units[0], units, sessions: [],
      assignment: { courses: [{ courseId: 'math', enrollment }] },
      works: [{ work: 'math', title: 'Math', progression: enrollment.progression, modules: [{ module: 'number-sense', title: 'Number Sense' }] }],
    });
    expect(rows.at(-1)).toMatchObject({ completed: 0, total: 1 });
  });
});
