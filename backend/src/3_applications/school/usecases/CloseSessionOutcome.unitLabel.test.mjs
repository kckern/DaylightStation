import { describe, expect, it, vi } from 'vitest';

// `planLearnerWork` is a large pure domain function (prerequisite chains,
// progressions) that CloseSessionOutcome calls internally but does not take
// as a dependency-injected port. Mocking it isolates these tests to the one
// thing under test — the "Unit N" label built off `enrollment.moduleOrder` —
// without having to fabricate a whole realistic curriculum/progression graph.
// Same pattern already used in this repo, e.g.
// `backend/src/4_api/v1/routers/piano.effect-audit.test.mjs`.
const planEntries = [];
vi.mock('#domains/school/planner.mjs', () => ({
  planLearnerWork: () => ({ entries: planEntries }),
}));

const { CloseSessionOutcome } = await import('./CloseSessionOutcome.mjs');

/**
 * Regression coverage for the same 0-based "Unit N" bug already fixed once
 * in `BuildAgenda.mjs` (commits c74c13bc2, f997c0fae) and found still live
 * here by a follow-up audit: `moduleIndex` was computed with a raw
 * `.indexOf()` (0-based) and printed as `Unit ${moduleIndex}` — the first
 * module in `moduleOrder` printed as "Unit 0" instead of "Unit 1". Both
 * sites now go through `BuildAgenda`'s exported `moduleOrdinal` helper
 * (1-based, or `null` when the module cannot be placed).
 *
 * Both sites live inside private methods reached only through `execute()`,
 * so these tests drive the whole use case with minimal in-memory fakes
 * rather than reaching into the class.
 */

const LEARNER_ID = 'milo';
const SESSION_ID = 'sess-unit-label';
const COURSE_ID = 'cfm';

function makeUnit({ module = 'w35-aug24' } = {}) {
  return {
    unitId: 'cfm-w35-d1', courseId: COURSE_ID, module, subject: 'religion', title: 'Psalms 49-61',
  };
}

function makeEnrollment(moduleOrder) {
  return { moduleOrder };
}

function makeSessionsDouble() {
  const events = [
    { type: 'created', at: '2026-08-24T12:00:00.000Z', sessionId: SESSION_ID, seq: 1, learnerId: LEARNER_ID, unitId: 'cfm-w35-d1' },
    { type: 'launch_dispatched', at: '2026-08-24T12:00:01.000Z', sessionId: SESSION_ID, seq: 2, surface: 'portal' },
  ];
  return {
    readEvents: async () => events,
    appendEvent: async (id, event) => { events.push({ ...event, seq: events.length + 1, sessionId: id }); },
    listForLearner: async () => [],
  };
}

function makeSubject({ moduleOrder, module = 'w35-aug24', moduleTitle = 'Aug 24-30' } = {}) {
  const unit = makeUnit({ module });
  const curriculum = {
    getUnit: async () => unit,
    listUnits: async () => [],
    listWorks: async () => [{ work: COURSE_ID, title: 'Come Follow Me', modules: [{ module, title: moduleTitle }] }],
  };
  const assignments = {
    get: async () => ({ courses: [{ courseId: COURSE_ID, enrollment: makeEnrollment(moduleOrder) }] }),
  };
  const tokens = { put: async () => {}, liveAccessCodes: async () => new Set() };
  const grownUps = { assert: () => {} };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  planEntries.length = 0; // no plan entries -> #nextUnlocked short-circuits to null; keeps the fixture focused on the label
  const service = new CloseSessionOutcome({
    curriculum, sessions: makeSessionsDouble(), tokens, assignments, grownUps, logger,
    clock: () => new Date('2026-08-24T12:05:00.000Z'),
  });
  return service;
}

describe('CloseSessionOutcome unit labels (site 1: #settle taxonomy block)', () => {
  it('labels the first module as "Unit 1" (regression: was "Unit 0")', async () => {
    const service = makeSubject({ moduleOrder: ['w35-aug24', 'w36-aug31'] });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    expect(result.status).toBe('settled');
    expect(result.document.blocks[0].taxonomy.unit).toBe('Unit 1: Aug 24-30');
  });

  it('labels a later module with the correct ordinal', async () => {
    const service = makeSubject({ moduleOrder: ['w34-aug17', 'w35-aug24', 'w36-aug31'] });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    expect(result.document.blocks[0].taxonomy.unit).toBe('Unit 2: Aug 24-30');
  });

  it('falls back to the module title (never "Unit 0"/"Unit NaN") when the module is not in moduleOrder', async () => {
    const service = makeSubject({ moduleOrder: ['some-other-module'] });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    const label = result.document.blocks[0].taxonomy.unit;
    expect(label).toBe('Aug 24-30');
    expect(label).not.toMatch(/Unit 0/);
    expect(label).not.toMatch(/Unit NaN/);
  });
});

describe('CloseSessionOutcome unit labels (site 2: #learningProgress course-bar row)', () => {
  function progressRow(result) {
    return result.document.blocks[0].progress.find((row) => row.label !== 'Course');
  }

  it('labels the first module\'s progress row "Unit 1" (regression: was "Unit 0")', async () => {
    const service = makeSubject({ moduleOrder: ['w35-aug24', 'w36-aug31'] });
    // makeSubject resets planEntries as part of building the fake — populate
    // it after construction so the module-bar row's `total` is non-zero.
    planEntries.push({ courseId: COURSE_ID, module: 'w35-aug24', unitId: 'cfm-w35-d1', status: 'completed' });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    expect(progressRow(result).label).toBe('Unit 1');
  });

  it('labels a later module\'s progress row with the correct ordinal', async () => {
    const service = makeSubject({ moduleOrder: ['w34-aug17', 'w35-aug24', 'w36-aug31'] });
    planEntries.push({ courseId: COURSE_ID, module: 'w35-aug24', unitId: 'cfm-w35-d1', status: 'completed' });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    expect(progressRow(result).label).toBe('Unit 2');
  });

  it('falls back to the bare "Unit" label (never "Unit 0"/"Unit NaN") when the module is not in moduleOrder', async () => {
    const service = makeSubject({ moduleOrder: ['some-other-module'] });
    planEntries.push({ courseId: COURSE_ID, module: 'w35-aug24', unitId: 'cfm-w35-d1', status: 'completed' });
    const result = await service.execute({ sessionId: SESSION_ID, honorClose: true });
    const label = progressRow(result).label;
    expect(label).toBe('Unit');
    expect(label).not.toMatch(/Unit 0/);
    expect(label).not.toMatch(/Unit NaN/);
  });
});
