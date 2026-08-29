import { describe, expect, it } from 'vitest';
import { createCourseEnrollment } from './enrollment.mjs';
import { planLearnerWork } from '../planner.mjs';

const units = [
  { unitId: 'atlas.01', courseId: 'atlas', module: 'opening', moduleRole: 'overview', sequence: 1, title: 'Opening', subject: 'civilization' },
  { unitId: 'atlas.02', courseId: 'atlas', module: 'north', moduleRole: 'overview', sequence: 2, title: 'North', subject: 'civilization' },
  { unitId: 'atlas.03', courseId: 'atlas', module: 'north', moduleRole: 'lesson', sequence: 3, title: 'North state', subject: 'civilization' },
  { unitId: 'atlas.04', courseId: 'atlas', module: 'south', moduleRole: 'overview', sequence: 4, title: 'South', subject: 'civilization' },
  { unitId: 'atlas.05', courseId: 'atlas', module: 'bonus', moduleRole: 'optional', sequence: 5, title: 'Bonus', subject: 'civilization' },
];
const policy = { mode: 'module_blocks', required_opening_module: 'opening', one_active_module: true, module_order: 'shuffle_once', lesson_order: 'shuffle_once' };

describe('course enrollment ordering', () => {
  it('requires caller-supplied entropy when the authored policy shuffles', () => {
    expect(() => createCourseEnrollment({ courseId: 'atlas', units, policy })).toThrow(/rng is required/);
  });

  it('keeps required opening first and freezes shuffled module/lesson order', () => {
    const enrollment = createCourseEnrollment({ enrollmentId: 'enr-learner4-atlas', courseId: 'atlas', profile: 'upper', units, policy, rng: () => 0 });
    expect(enrollment.enrollmentId).toBe('enr-learner4-atlas');
    expect(enrollment.moduleOrder[0]).toBe('opening');
    expect(enrollment.lessonOrder.north[0]).toBe('atlas.02');
    expect(enrollment.moduleOrder).not.toContain('bonus');
    expect(enrollment.optionalModules).toEqual(['bonus']);
    expect(enrollment.profile).toBe('upper');
    expect(enrollment.schema).toBe('school.course-enrollment/v2');
    expect(enrollment.progression).toEqual(policy);
  });

  it('gates later modules until the opening module passes', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', profile: 'lower', units, policy, rng: () => 0 });
    const plan = planLearnerWork({
      learnerId: 'learner3', units, coursePolicies: { atlas: policy },
      assignment: { courses: [{ courseId: 'atlas', profile: 'lower', enrollment }] }, sessions: [],
    });
    expect(plan.entries.find((x) => x.unitId === 'atlas.01').status).toBe('available');
    expect(plan.entries.find((x) => x.unitId === 'atlas.02').status).toBe('locked');
  });

  it('unlocks optional bonus after opening without putting it in the required chain', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', profile: 'upper', units, policy, rng: () => 0 });
    const sessions = [{ learnerId: 'learner4', unitId: 'atlas.01', terminal: true, outcome: { result: 'passed' } }];
    const plan = planLearnerWork({
      learnerId: 'learner4', units, coursePolicies: { atlas: policy },
      assignment: { courses: [{ courseId: 'atlas', profile: 'upper', enrollment }] }, sessions,
    });
    expect(plan.entries.find((x) => x.unitId === 'atlas.05').status).toBe('available');
  });

  it('reports the next unlock from the frozen enrollment order', () => {
    const enrollment = {
      courseId: 'atlas', profile: 'lower', optionalModules: ['bonus'],
      moduleOrder: ['opening', 'south', 'north'],
      lessonOrder: {
        opening: ['atlas.01'], south: ['atlas.04'], north: ['atlas.02', 'atlas.03'], bonus: ['atlas.05'],
      },
    };
    const plan = planLearnerWork({
      learnerId: 'learner3', units, coursePolicies: { atlas: policy },
      assignment: { courses: [{ courseId: 'atlas', profile: 'lower', enrollment }] }, sessions: [],
    });
    expect(plan.entries.find((x) => x.unitId === 'atlas.01').unlocks).toBe('atlas.04');
    expect(plan.entries.find((x) => x.unitId === 'atlas.04').unlocks).toBe('atlas.02');
    expect(plan.entries.find((x) => x.unitId === 'atlas.02').unlocks).toBe('atlas.03');
    expect(plan.entries.find((x) => x.unitId === 'atlas.05').unlocks).toBeNull();
  });
});

describe('dated module schedules', () => {
  const modules = [
    { module: 'w35', title: 'Week 35', opensOn: '2026-08-24', closesOn: '2026-08-30' },
    { module: 'w36', title: 'Week 36', opensOn: '2026-08-31', closesOn: '2026-09-06' },
    { module: 'w37', title: 'Week 37', opensOn: '2026-09-07', closesOn: '2026-09-13' },
  ];
  const datedUnits = [
    { unitId: 'w35.d1', courseId: 'cfm', module: 'w35', sequence: 1 },
    { unitId: 'w36.d1', courseId: 'cfm', module: 'w36', sequence: 2 },
    { unitId: 'w37.d1', courseId: 'cfm', module: 'w37', sequence: 3 },
  ];
  const datedPolicy = { mode: 'dated_modules', lesson_order: 'sequence' };

  it('copies each module window onto the enrollment', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules, policy: datedPolicy, today: '2026-08-23',
    });
    expect(enrollment.moduleSchedule).toEqual({
      w35: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
      w36: { opensOn: '2026-08-31', closesOn: '2026-09-06' },
      w37: { opensOn: '2026-09-07', closesOn: '2026-09-13' },
    });
  });

  it('snapshots compact labels and course-relative numbering before dropping closed modules', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules,
      policy: { ...datedPolicy, module_number_start: 35 },
      display: { title: 'Come Follow Me — Old Testament 2026', shortTitle: 'Come Follow Me' },
      today: '2026-09-08',
    });
    expect(enrollment.display).toEqual({
      courseTitle: 'Come Follow Me — Old Testament 2026',
      courseShortTitle: 'Come Follow Me',
      modules: { w37: { number: 37, title: 'Week 37' } },
    });
  });

  it('omits modules that closed before enrollment — they were never assigned', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules, policy: datedPolicy, today: '2026-09-08',
    });
    expect(Object.keys(enrollment.moduleSchedule)).toEqual(['w37']);
    expect(enrollment.moduleOrder).toEqual(['w37']);
  });

  it('keeps omitted pre-enrollment modules out of the planner', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules, policy: datedPolicy, today: '2026-09-08',
    });
    const plan = planLearnerWork({
      learnerId: 'learner3', units: datedUnits,
      assignment: { courses: [{ courseId: 'cfm', enrollment }] },
      sessions: [], now: '2026-09-08T09:00:00.000Z',
      coursePolicies: { cfm: datedPolicy },
    });

    expect(plan.entries.map((entry) => entry.unitId)).toEqual(['w37.d1']);
    // `plan.next` is gone (see planner.mjs); `available` carries the ordering.
    expect(plan.available[0].unitId).toBe('w37.d1');
  });

  it('uses the frozen v2 policy even if the catalog later changes mode', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules, policy: datedPolicy, today: '2026-08-23',
    });
    const plan = planLearnerWork({
      learnerId: 'learner3', units: datedUnits,
      assignment: { courses: [{ courseId: 'cfm', enrollment }] },
      sessions: [], now: '2026-08-24T09:00:00.000Z',
      coursePolicies: { cfm: { mode: 'sequential' } },
    });
    expect(plan.available[0].unitId).toBe('w35.d1');
    expect(plan.entries.find((entry) => entry.unitId === 'w36.d1').status).toBe('upcoming');
  });

  it('infers dated semantics for a legacy v1 snapshot with moduleSchedule', () => {
    const enrollment = {
      schema: 'school.course-enrollment/v1', moduleOrder: ['w35', 'w36'], optionalModules: [],
      lessonOrder: { w35: ['w35.d1'], w36: ['w36.d1'] },
      moduleSchedule: {
        w35: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
        w36: { opensOn: '2026-08-31', closesOn: '2026-09-06' },
      },
    };
    const plan = planLearnerWork({
      learnerId: 'learner3', units: datedUnits,
      assignment: { courses: [{ courseId: 'cfm', enrollment }] }, sessions: [],
      now: '2026-08-24T09:00:00.000Z', coursePolicies: { cfm: { mode: 'sequential' } },
    });
    expect(plan.entries.find((entry) => entry.unitId === 'w36.d1').status).toBe('upcoming');
  });

  it('keeps a module whose window closes today', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules, policy: datedPolicy, today: '2026-08-30',
    });
    expect(Object.keys(enrollment.moduleSchedule)).toContain('w35');
  });

  it('orders dated modules by calendar, never shuffled', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'cfm', units: datedUnits, modules,
      policy: { mode: 'dated_modules', module_order: 'shuffle_once', lesson_order: 'sequence' },
      today: '2026-08-23', rng: () => 0,
    });
    expect(enrollment.moduleOrder).toEqual(['w35', 'w36', 'w37']);
  });

  it('snapshots the school-day schedule, deep-copied like progression', () => {
    const schedule = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-12-21', to: '2027-01-01' }] };
    const enrollment = createCourseEnrollment({ courseId: 'atlas', units, policy, schedule, rng: () => 0 });
    expect(enrollment.schedule).toEqual(schedule);
    // A syllabus edited after enrollment must not reach into a plan a learner
    // is already living in — the same reason progression is cloned.
    schedule.daysOfWeek.push(6);
    schedule.except[0].to = '2027-06-01';
    expect(enrollment.schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(enrollment.schedule.except[0].to).toBe('2027-01-01');
  });

  it('adds no schedule key to an enrollment that declares none', () => {
    const enrollment = createCourseEnrollment({ courseId: 'atlas', units, policy, rng: () => 0 });
    expect(enrollment).not.toHaveProperty('schedule');
  });

  it('adds no moduleSchedule to a course that is not dated', () => {
    const enrollment = createCourseEnrollment({
      courseId: 'atlas', units: [{ unitId: 'a.1', courseId: 'atlas', module: 'midwest', sequence: 1 }],
      policy: { mode: 'module_blocks' },
    });
    expect(enrollment.moduleSchedule).toBeUndefined();
  });
});
