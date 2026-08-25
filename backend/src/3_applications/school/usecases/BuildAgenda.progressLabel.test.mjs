import { describe, expect, it } from 'vitest';
import { moduleProgressLabel } from './BuildAgenda.mjs';

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
