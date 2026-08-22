import { describe, expect, it, beforeEach } from 'vitest';
import { EnrollLearner } from './EnrollLearner.mjs';
import { UnenrollLearner } from './UnenrollLearner.mjs';

const UNITS = [
  { unitId: 'el.01', courseId: 'elements', module: 'foundations', moduleRole: 'overview', sequence: 1 },
  { unitId: 'el.02', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 2 },
  { unitId: 'el.03', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 3 },
  { unitId: 'other.01', courseId: 'other-course', module: 'x', moduleRole: 'lesson', sequence: 1 },
];
const WORK = {
  work: 'elements',
  progression: { mode: 'module_blocks', required_opening_module: 'foundations', one_active_module: true, module_order: 'fixed', lesson_order: 'shuffle_once' },
};
const SYLLABUS = {
  schema: 'school.syllabus/v1', syllabusId: 'elements-lower', title: 'Elements — lower',
  courseId: 'elements', profile: 'lower', policy: null, passing: 60, term: null,
};

// A second syllabus for the SAME course, with no profile/passing set — used to
// prove a re-materialize under a different syllabus fully overwrites the
// top-level fields rather than leaving stale values from the prior syllabus.
const SYLLABUS_NO_PROFILE = {
  schema: 'school.syllabus/v1', syllabusId: 'elements-upper', title: 'Elements — upper',
  courseId: 'elements', profile: null, policy: null, passing: null, term: null,
};
const TIMED_SYLLABUS = {
  ...SYLLABUS,
  syllabusId: 'elements-fourth-of-july',
  timingTemplate: {
    schema: 'school.timing-template/v1', defaultAnchorId: 'fourth-of-july',
    opensBeforeDays: 21, closesAfterDays: 1, targetOffsetDays: -1,
    targetStrength: 'firm', basePriority: 'high', flexibility: 'flexible',
    normalBlocks: 1, urgentBlocks: 3, urgencyLeadDays: 10,
  },
};

// Units ordered so `foundations` is NOT the first module to appear in the
// array — `createCourseEnrollment` otherwise derives module order from
// first-appearance, which would make a naive test pass even if the course
// policy (required_opening_module) never reached the merge at all.
const UNITS_OPENING_NOT_FIRST = [
  { unitId: 'el.02', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 2 },
  { unitId: 'el.03', courseId: 'elements', module: 'period-1', moduleRole: 'lesson', sequence: 3 },
  { unitId: 'el.01', courseId: 'elements', module: 'foundations', moduleRole: 'overview', sequence: 1 },
];

// `CurriculumAccess.getWork(id)` is keyed `'<subject>/<work>'` — this double
// intentionally exposes only `listWorks()` (the real contract every other
// production caller — BuildAgenda, schoolLifecycle — uses to resolve a bare
// work name). A double that instead faked a `getWork(bareId)` method would
// hide the bug this fixes.
function harness({ assignment = null, open = [] } = {}) {
  const saved = [];
  return {
    saved,
    useCase: new EnrollLearner({
      syllabi: {
        get: async (id) => {
          if (id === 'elements-lower') return SYLLABUS;
          if (id === 'elements-upper') return SYLLABUS_NO_PROFILE;
          if (id === 'elements-fourth-of-july') return TIMED_SYLLABUS;
          return null;
        },
      },
      assignments: {
        get: async () => assignment,
        put: async (record) => { saved.push(record); return record; },
      },
      curriculum: { listUnits: async () => UNITS, listWorks: async () => [WORK] },
      sessions: { listOpenForLearner: async () => open },
      timingAnchors: { get: async (id) => (id === 'fourth-of-july'
        ? { anchorId: id, label: 'Fourth of July', kind: 'annual_date', month: 7, day: 4 }
        : null) },
      teacherGate: { assert: () => true },
      clock: () => new Date('2026-09-08T12:00:00.000Z'),
      rng: () => 0,
      logger: { info: () => {}, warn: () => {} },
    }),
  };
}

describe('EnrollLearner', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('refuses to construct without a teacherGate', () => {
    expect(() => new EnrollLearner({
      syllabi: {}, assignments: {}, curriculum: {},
    })).toThrow(/teacherGate/);
  });

  it('materializes an enrollment onto a new assignment entry', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const [record] = h.saved;
    expect(record.learnerId).toBe('milo');
    const entry = record.courses.find((c) => c.courseId === 'elements');
    expect(entry.profile).toBe('lower');
    expect(entry.syllabusId).toBe('elements-lower');
    expect(entry.passing).toBe(60);
    expect(entry.enrollment.schema).toBe('school.course-enrollment/v1');
    expect(entry.enrollment.moduleOrder[0]).toBe('foundations');
  });

  it('scopes materialization to the syllabus course only', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const entry = h.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(Object.keys(entry.enrollment.lessonOrder)).not.toContain('x');
  });

  it('materializes a syllabus timing template onto the learner enrollment', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-fourth-of-july', enrolledBy: 'kckern', pin: '7410' });
    const entry = h.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(entry.timing).toMatchObject({
      anchor: { anchorId: 'fourth-of-july', resolvedOn: '2027-07-04' },
      availability: { opensOn: '2027-06-13', closesOn: '2027-07-05' },
      agenda: { normalBlocks: 1, urgentBlocks: 3 },
    });
  });

  it('refuses an unknown syllabus by name', async () => {
    await expect(h.useCase.execute({ learnerId: 'milo', syllabusId: 'ghost', enrolledBy: 'kckern', pin: '7410' }))
      .rejects.toThrow("unknown syllabus: 'ghost'");
  });

  it('refuses a second enrollment in the same course without rematerialize', async () => {
    const hh = harness({ assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null } });
    await expect(hh.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' }))
      .rejects.toThrow('milo is already enrolled in elements');
  });

  it('refuses a re-materialize while a session on that course is open', async () => {
    const hh = harness({
      assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null },
      open: [{ sessionId: 'ws_1', unitId: 'el.02', state: 'issued' }],
    });
    await expect(hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    })).rejects.toThrow(/open session/i);
  });

  it('ignores an open session on a DIFFERENT course', async () => {
    const hh = harness({
      assignment: { learnerId: 'milo', courses: [{ courseId: 'elements' }], units: [], updatedAt: null },
      open: [{ sessionId: 'ws_2', unitId: 'other.01', state: 'issued' }],
    });
    await hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    });
    expect(hh.saved).toHaveLength(1);
  });

  it('refuses a stale save', async () => {
    const hh = harness({ assignment: { learnerId: 'milo', courses: [], units: [], updatedAt: '2026-09-01T00:00:00.000Z' } });
    await expect(hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', baseUpdatedAt: null,
    })).rejects.toThrow(/changed since you loaded/);
  });

  it('re-materializing preserves elective and the original enrolledAt from the prior entry', async () => {
    const hh = harness({
      assignment: {
        learnerId: 'milo',
        courses: [{ courseId: 'elements', elective: true, enrolledAt: '2026-01-01T00:00:00.000Z' }],
        units: [],
        updatedAt: null,
      },
    });
    await hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    });
    const entry = hh.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(entry.elective).toBe(true);
    expect(entry.enrolledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('re-materializing under a different syllabus overwrites stale top-level profile/passing, but still preserves elective and enrolledAt', async () => {
    const hh = harness({
      assignment: {
        learnerId: 'milo',
        courses: [{
          courseId: 'elements',
          elective: true,
          enrolledAt: '2026-01-01T00:00:00.000Z',
          syllabusId: 'elements-lower',
          profile: 'upper',
          passing: 80,
        }],
        units: [],
        updatedAt: null,
      },
    });
    await hh.useCase.execute({
      learnerId: 'milo', syllabusId: 'elements-upper', enrolledBy: 'kckern', pin: '7410', rematerialize: true,
    });
    const entry = hh.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(entry.profile).toBeNull();
    expect(entry.passing).toBeNull();
    expect(entry.elective).toBe(true);
    expect(entry.enrolledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stamps enrolledAt fresh on a brand-new enrollment (no prior entry to preserve)', async () => {
    await h.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const entry = h.saved[0].courses.find((c) => c.courseId === 'elements');
    expect(entry.enrolledAt).toBe('2026-09-08T12:00:00.000Z');
  });

  it('resolves the course policy via listWorks — required_opening_module wins even when it is not first in unit order', async () => {
    const hh = new EnrollLearner({
      syllabi: { get: async (id) => (id === 'elements-lower' ? SYLLABUS : null) },
      assignments: { get: async () => null, put: async (record) => record },
      curriculum: { listUnits: async () => UNITS_OPENING_NOT_FIRST, listWorks: async () => [WORK] },
      sessions: { listOpenForLearner: async () => [] },
      teacherGate: { assert: () => true },
      clock: () => new Date('2026-09-08T12:00:00.000Z'),
      rng: () => 0,
      logger: { info: () => {}, warn: () => {} },
    });
    const record = await hh.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    const entry = record.courses.find((c) => c.courseId === 'elements');
    expect(entry.enrollment.moduleOrder[0]).toBe('foundations');
  });

  it('preserves other courses and standalone units untouched', async () => {
    const hh = harness({
      assignment: {
        learnerId: 'milo',
        courses: ['math-fractions'],
        units: ['language-daily'],
        updatedAt: null,
      },
    });
    await hh.useCase.execute({ learnerId: 'milo', syllabusId: 'elements-lower', enrolledBy: 'kckern', pin: '7410' });
    expect(hh.saved[0].courses[0]).toBe('math-fractions');
    expect(hh.saved[0].units).toEqual(['language-daily']);
  });
});

function unenrollHarness({ assignment, open = [] } = {}) {
  const saved = [];
  return {
    saved,
    useCase: new UnenrollLearner({
      assignments: { get: async () => assignment, put: async (r) => { saved.push(r); return r; } },
      curriculum: { listUnits: async () => UNITS },
      sessions: { listOpenForLearner: async () => open },
      teacherGate: { assert: () => true },
      clock: () => new Date('2026-09-08T12:00:00.000Z'),
      logger: { info: () => {}, warn: () => {} },
    }),
  };
}

describe('UnenrollLearner', () => {
  const enrolled = { learnerId: 'milo', courses: [{ courseId: 'elements' }, 'math-fractions'], units: ['language-daily'], updatedAt: null };

  it('removes the course entry and leaves everything else alone', async () => {
    const h = unenrollHarness({ assignment: enrolled });
    await h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' });
    expect(h.saved[0].courses).toEqual(['math-fractions']);
    expect(h.saved[0].units).toEqual(['language-daily']);
  });

  it('refuses when the learner is not enrolled in that course', async () => {
    const h = unenrollHarness({ assignment: { learnerId: 'milo', courses: [], units: [], updatedAt: null } });
    await expect(h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' }))
      .rejects.toThrow('milo is not enrolled in elements');
  });

  it('refuses while a session on that course is open', async () => {
    const h = unenrollHarness({ assignment: enrolled, open: [{ sessionId: 'ws_1', unitId: 'el.02', state: 'issued' }] });
    await expect(h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' }))
      .rejects.toThrow(/open session/i);
  });

  it('ignores an open session on a DIFFERENT course', async () => {
    const h = unenrollHarness({
      assignment: enrolled,
      open: [{ sessionId: 'ws_2', unitId: 'other.01', state: 'issued' }],
    });
    await h.useCase.execute({ learnerId: 'milo', courseId: 'elements', removedBy: 'kckern', pin: '7410' });
    expect(h.saved).toHaveLength(1);
  });

  it('refuses to construct without a teacherGate', () => {
    expect(() => new UnenrollLearner({
      assignments: {}, curriculum: {},
    })).toThrow(/teacherGate/);
  });
});
