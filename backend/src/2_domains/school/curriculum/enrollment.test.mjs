import { describe, expect, it } from 'vitest';
import { createCourseEnrollment } from './enrollment.mjs';
import { planLearnerWork } from '../planner.mjs';

const units = [
  { unitId: 'atlas.01', courseId: 'atlas', module: 'opening', moduleRole: 'overview', sequence: 1, title: 'Opening', subject: 'history' },
  { unitId: 'atlas.02', courseId: 'atlas', module: 'north', moduleRole: 'overview', sequence: 2, title: 'North', subject: 'history' },
  { unitId: 'atlas.03', courseId: 'atlas', module: 'north', moduleRole: 'lesson', sequence: 3, title: 'North state', subject: 'history' },
  { unitId: 'atlas.04', courseId: 'atlas', module: 'south', moduleRole: 'overview', sequence: 4, title: 'South', subject: 'history' },
  { unitId: 'atlas.05', courseId: 'atlas', module: 'bonus', moduleRole: 'optional', sequence: 5, title: 'Bonus', subject: 'history' },
];
const policy = { mode: 'module_blocks', required_opening_module: 'opening', one_active_module: true, module_order: 'shuffle_once', lesson_order: 'shuffle_once' };

describe('course enrollment ordering', () => {
  it('keeps required opening first and freezes shuffled module/lesson order', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', profile: 'upper', units, policy, rng: () => 0 });
    expect(enrollment.moduleOrder[0]).toBe('opening');
    expect(enrollment.lessonOrder.north[0]).toBe('atlas.02');
    expect(enrollment.moduleOrder).not.toContain('bonus');
    expect(enrollment.optionalModules).toEqual(['bonus']);
    expect(enrollment.profile).toBe('upper');
  });

  it('gates later modules until the opening module passes', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', profile: 'lower', units, policy, rng: () => 0 });
    const plan = planLearnerWork({
      learnerId: 'milo', units, coursePolicies: { atlas: policy },
      assignment: { courses: [{ courseId: 'atlas', profile: 'lower', enrollment }] }, sessions: [],
    });
    expect(plan.entries.find((x) => x.unitId === 'atlas.01').status).toBe('available');
    expect(plan.entries.find((x) => x.unitId === 'atlas.02').status).toBe('locked');
  });

  it('unlocks optional bonus after opening without putting it in the required chain', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', profile: 'upper', units, policy, rng: () => 0 });
    const sessions = [{ learnerId: 'felix', unitId: 'atlas.01', terminal: true, outcome: { result: 'passed' } }];
    const plan = planLearnerWork({
      learnerId: 'felix', units, coursePolicies: { atlas: policy },
      assignment: { courses: [{ courseId: 'atlas', profile: 'upper', enrollment }] }, sessions,
    });
    expect(plan.entries.find((x) => x.unitId === 'atlas.05').status).toBe('available');
  });
});
