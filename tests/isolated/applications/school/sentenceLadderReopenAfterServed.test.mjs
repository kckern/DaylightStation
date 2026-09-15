/**
 * A SERVED LADDER STILL OPENS (2026-09-14).
 *
 * Finishing the day's Sentence Ladder set marks the `language` subject served,
 * and a served subject's code resolves to "You already did this today." with
 * only a way out — unless its program's status declares `reopenable`. The
 * ladder did not, so a child who met the day and wanted another round typed
 * the same code and met a wall. The ladder now reports `reopenable`, and this
 * asserts the typed-code path honours it with the ladder's own planned entry.
 */
import { describe, it, expect } from 'vitest';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';

const LEARNER_ID = 'kid1';
const CORPUS_ID = 'glossika-korean';
const LADDER_UNIT_ID = `sentence-ladder:${CORPUS_ID}`;
const NOW_ISO = '2026-09-14T18:00:00.000Z';
const CODE = '615204';
const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** The language code as a panel mints it: no `continueToday`, no program. */
function languageCodeRecord() {
  let n = 0;
  return mintToken({
    tokenClass: 'subject_next',
    subject: { learnerId: LEARNER_ID, subject: 'language' },
    at: NOW_ISO,
    rng: () => { n += 1; return (n % 97) / 97; },
    accessCode: CODE,
    accessCodeExpiresAt: '2026-09-15T11:00:00.000Z',
  });
}

function servedProjection(status) {
  const assignment = {
    learnerId: LEARNER_ID, courses: [],
    programs: [{ programId: 'sentence-ladder', corpusId: CORPUS_ID, subject: 'language' }],
  };
  const plan = appendAssignedProgramEntries({ entries: [], errors: [] }, assignment);
  const sections = [{ subject: 'language', servedToday: true, next: null, progressRows: [] }];
  const programStatuses = [{ programId: 'sentence-ladder', programInstance: CORPUS_ID, status }];
  return {
    plan,
    async project() {
      return {
        plan, sections, activeExceptions: [], programStatuses,
        projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW_ISO },
      };
    },
  };
}

function resolverFor(planProjection) {
  return new ResolveAccessCode({
    tokens: { async getByAccessCode() { return languageCodeRecord(); } },
    curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
    assignments: { async get() { return { units: [] }; } },
    sessions: {
      async listForLearner() { return []; },
      async readEvents(id) { throw new Error(`test fake: unexpected readEvents(${id})`); },
      async appendEvent(id) { throw new Error(`test fake: /resolve must not write (${id})`); },
    },
    planProjection,
    clock: () => new Date(NOW_ISO),
    logger: noopLogger,
  });
}

const DONE = {
  doneToday: true, progressLabel: 'Day 3', score: null, reopenable: true,
  servedWork: [{ unitId: LADDER_UNIT_ID, title: 'Glossika Korean · Day 2' }],
};

describe('sentence ladder code — a day already served', () => {
  it('opens the ladder again rather than "You already did this today."', async () => {
    const planProjection = servedProjection(DONE);
    expect(planProjection.plan.entries.map((e) => e.unitId)).toEqual([LADDER_UNIT_ID]);

    const { resolution } = await resolverFor(planProjection).resolve({ code: CODE });

    expect(resolution.kind).toBe('program');
    expect(resolution.programId).toBe('sentence-ladder');
    expect(resolution.unit?.unitId).toBe(LADDER_UNIT_ID);
  });

  it('without `reopenable` it is the wall this guards against', async () => {
    const { reopenable, ...closed } = DONE;
    const { resolution } = await resolverFor(servedProjection(closed)).resolve({ code: CODE });
    expect(reopenable).toBe(true);
    expect(resolution.kind).toBe('served');
  });

  it('an errored ladder is still refused honestly, never offered a dead button', async () => {
    const { resolution } = await resolverFor(servedProjection({ ...DONE, error: true })).resolve({ code: CODE });
    expect(resolution.kind).not.toBe('program');
  });
});
