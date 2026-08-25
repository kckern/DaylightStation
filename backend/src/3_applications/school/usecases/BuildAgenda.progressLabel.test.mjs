import { describe, expect, it } from 'vitest';
import { moduleProgressLabel, moduleTaxonomyUnitLabel } from './BuildAgenda.mjs';

// Real Come Follow Me shape (the course whose launch made this reachable in
// production): module order + per-module lesson order.
const CFM_ENROLLMENT = {
  moduleOrder: ['w35-aug24', 'w36-aug31', 'w37-sep07'],
  lessonOrder: {
    'w35-aug24': [
      'cfm-w35-d1-psalms-49-61',
      'cfm-w35-d2-psalms-49-61',
      'cfm-w35-d3-psalms-49-61',
      'cfm-w35-d4-psalms-49-61',
      'cfm-w35-d5-psalms-85-86',
    ],
    'w36-aug31': [
      'cfm-w36-d1-lesson',
      'cfm-w36-d2-lesson',
    ],
    'w37-sep07': [
      'cfm-w37-d1-lesson',
    ],
  },
};

describe('moduleProgressLabel', () => {
  it('labels the first lesson of the first module as 1-based on BOTH axes (regression: was "Unit 0 · 1/5")', () => {
    const label = moduleProgressLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w35-aug24', unitId: 'cfm-w35-d1-psalms-49-61', courseId: 'cfm' },
    });
    expect(label).toBe('Unit 1 · 1/5');
  });

  it('labels a later module/lesson correctly — third module, second of five', () => {
    // Reuse w35 (5 lessons) as a stand-in "third module" by giving it its own
    // enrollment slot, so the fixture actually exercises "index 2 -> Unit 3".
    const enrollment = {
      moduleOrder: ['w36-aug31', 'w37-sep07', 'w35-aug24'],
      lessonOrder: CFM_ENROLLMENT.lessonOrder,
    };
    const label = moduleProgressLabel({
      enrollment,
      entry: { module: 'w35-aug24', unitId: 'cfm-w35-d2-psalms-49-61', courseId: 'cfm' },
    });
    expect(label).toBe('Unit 3 · 2/5');
  });

  it('falls back when the module is not in moduleOrder', () => {
    const label = moduleProgressLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w99-unknown', unitId: 'cfm-w35-d1-psalms-49-61', courseId: 'cfm' },
      fallback: 'existing label',
    });
    expect(label).toBe('existing label');
  });

  it('falls back when the unit is not in that module\'s lessonOrder', () => {
    const label = moduleProgressLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w35-aug24', unitId: 'cfm-unknown-unit', courseId: 'cfm' },
      fallback: 'existing label',
    });
    expect(label).toBe('existing label');
  });

  it('falls back (without throwing) when enrollment is missing entirely', () => {
    const label = moduleProgressLabel({
      enrollment: undefined,
      entry: { module: 'w35-aug24', unitId: 'cfm-w35-d1-psalms-49-61', courseId: 'cfm' },
      fallback: 'existing label',
    });
    expect(label).toBe('existing label');
  });

  it('falls back (without throwing) when enrollment is an empty object', () => {
    const label = moduleProgressLabel({
      enrollment: {},
      entry: { module: 'w35-aug24', unitId: 'cfm-w35-d1-psalms-49-61', courseId: 'cfm' },
      fallback: 'existing label',
    });
    expect(label).toBe('existing label');
  });

  it('defaults the fallback to null when the caller passes none', () => {
    const label = moduleProgressLabel({
      enrollment: undefined,
      entry: { module: 'w35-aug24', unitId: 'cfm-w35-d1-psalms-49-61', courseId: 'cfm' },
    });
    expect(label).toBeNull();
  });
});

// The taxonomy block's "Unit N: {title}" line — the sibling label printed
// on the SAME receipt as progressLabel, computed from the same entry. Both
// must agree on which unit number a lesson belongs to.
describe('moduleTaxonomyUnitLabel', () => {
  it('labels the first module as "Unit 1: <title>" (regression: was "Unit 0: <title>", disagreeing with progressLabel\'s "Unit 1 · 1/5" on the same receipt)', () => {
    const label = moduleTaxonomyUnitLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w35-aug24', courseId: 'cfm' },
      moduleTitle: 'Aug 24–30 · Psalms 49–86',
    });
    expect(label).toBe('Unit 1: Aug 24–30 · Psalms 49–86');
  });

  it('labels a later module with the correct ordinal', () => {
    const enrollment = {
      moduleOrder: ['w36-aug31', 'w37-sep07', 'w35-aug24'],
      lessonOrder: CFM_ENROLLMENT.lessonOrder,
    };
    const label = moduleTaxonomyUnitLabel({
      enrollment,
      entry: { module: 'w35-aug24', courseId: 'cfm' },
      moduleTitle: 'Aug 24–30 · Psalms 49–86',
    });
    expect(label).toBe('Unit 3: Aug 24–30 · Psalms 49–86');
  });

  it('falls back to moduleTitle (not "Unit 0"/"Unit NaN") when the module is not in moduleOrder', () => {
    const label = moduleTaxonomyUnitLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w99-unknown', courseId: 'cfm' },
      moduleTitle: 'Some Title',
    });
    expect(label).toBe('Some Title');
    expect(label).not.toMatch(/Unit 0/);
    expect(label).not.toMatch(/Unit NaN/);
  });

  it('falls back to entry.module when moduleTitle is also missing', () => {
    const label = moduleTaxonomyUnitLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { module: 'w99-unknown', courseId: 'cfm' },
      moduleTitle: undefined,
    });
    expect(label).toBe('w99-unknown');
    expect(label).not.toMatch(/Unit 0/);
    expect(label).not.toMatch(/Unit NaN/);
  });

  it('falls back to entry.title when both moduleTitle and entry.module are missing', () => {
    const label = moduleTaxonomyUnitLabel({
      enrollment: CFM_ENROLLMENT,
      entry: { title: 'Fallback Lesson Title', courseId: 'cfm' },
      moduleTitle: undefined,
    });
    expect(label).toBe('Fallback Lesson Title');
  });

  it('does not throw and does not print "Unit 0"/"Unit NaN" when enrollment is missing entirely', () => {
    const label = moduleTaxonomyUnitLabel({
      enrollment: undefined,
      entry: { module: 'w35-aug24', courseId: 'cfm' },
      moduleTitle: 'Aug 24–30 · Psalms 49–86',
    });
    expect(label).toBe('Aug 24–30 · Psalms 49–86');
    expect(label).not.toMatch(/Unit 0/);
    expect(label).not.toMatch(/Unit NaN/);
  });
});
