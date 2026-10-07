// @vitest-environment node
/**
 * PlanProjection — the one assembler for "what's next".
 *
 * The doubles here are the ones `tests/isolated/application/school/buildAgenda.test.mjs`
 * already uses (`FakeCatalog` + `CurriculumAccess`, `FakeAssignmentStore`,
 * `FakeSessionRepository`, the real committed four-unit maths course), because
 * the whole point of this class is that its answer must equal BuildAgenda's.
 * A fixture invented here could agree with the implementation and still
 * disagree with the paper a child is holding.
 */
import { describe, it, expect, vi } from 'vitest';
import { PlanProjection } from './PlanProjection.mjs';
import { CurriculumAccess } from './CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore,
  fakeClock, silentLogger,
// Relative, not `#testlib/…`: this test is COLOCATED under `backend/src`, so its
// `#` specifiers resolve against `backend/package.json`, which defines no
// `#testlib` (and cannot — a Node subpath-import target may not escape its own
// package with `../`). The shared doubles are still the shared doubles.
} from '../../../../tests/_lib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT,
} from '../../../../tests/_lib/school/lifecycleFixtures.mjs';

const LEARNER = 'kid1';

/**
 * A learner assigned the four-unit maths course whose ONLY evidence for unit 1
 * is a teacher attestation — no graded session anywhere. That is the exact
 * shape the attested-pass overlay exists for: with it, unit 2 unlocks; without
 * it, unit 2 is still sitting behind "Finish … first".
 */
function build({
  attestations = {
    list: ({ learnerId } = {}) => (learnerId === LEARNER
      ? [{ id: 'att1', unitId: MEDIA_UNIT, at: '2026-07-27T08:00:00.000Z' }]
      : []),
  },
  curriculumExceptions = null,
  launchers = new Map(),
  logger = silentLogger,
} = {}) {
  const clock = fakeClock();
  const catalog = new FakeCatalog({
    units: rawUnits(), documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger,
  });
  const assignments = new FakeAssignmentStore([
    { learnerId: LEARNER, courses: ['math-fractions'] },
  ]);
  const sessions = new FakeSessionRepository();
  const projection = new PlanProjection({
    curriculum, assignments, sessions, attestations, curriculumExceptions,
    launchers, clock: clock.now, logger,
  });
  return { projection, clock, curriculum, catalog, sessions, assignments };
}

const entryFor = (plan, unitId) => plan.entries.find((e) => e.unitId === unitId);

describe('PlanProjection', () => {
  it('applies the attested-pass overlay by default', async () => {
    const { projection } = build();
    const { plan } = await projection.project({ learnerId: LEARNER });
    expect(entryFor(plan, MEDIA_UNIT).status).toBe('completed');
    expect(entryFor(plan, WORKSHEET_UNIT).status).not.toBe('locked');
  });

  it('can be asked for the RAW view, without the attested overlay', async () => {
    const { projection } = build();
    const { plan } = await projection.project({ learnerId: LEARNER, attested: false });
    expect(entryFor(plan, MEDIA_UNIT).status).toBe('available');
    expect(entryFor(plan, WORKSHEET_UNIT).status).toBe('locked');
  });

  it('returns sections and the raw projection alongside the plan', async () => {
    const { projection } = build();
    const result = await projection.project({ learnerId: LEARNER });
    expect(Array.isArray(result.sections)).toBe(true);
    expect(result.sections.map((s) => s.subject)).toContain('math');
    expect(result.projection).toMatchObject({ nowIso: expect.any(String) });
    expect(Object.keys(result.projection).sort())
      .toEqual(['assignment', 'nowIso', 'sessions', 'units', 'works']);
    expect(result.projection.assignment).toMatchObject({ learnerId: LEARNER });
    expect(result.projection.units.map((u) => u.unitId)).toContain(MEDIA_UNIT);
    // RAW history, never the overlaid one: the synthetic attested row exists to
    // unlock the PLANNER's gate and must never read as "served today", or the
    // repair day becomes the day the agenda goes silent.
    expect(result.projection.sessions).toEqual([]);
    const math = result.sections.find((s) => s.subject === 'math');
    expect(math.servedToday).toBe(false);
    expect(math.next?.unitId).toBe(WORKSHEET_UNIT);
  });

  it('the curriculum-exception overlay is applied by default and skippable', async () => {
    const curriculumExceptions = {
      active: async () => [{
        exceptionId: 'exc1', learnerId: LEARNER, kind: 'excused',
        resolvedLessonIds: [MEDIA_UNIT], decidedAt: '2026-07-26T12:00:00.000Z',
      }],
    };
    const { projection } = build({ attestations: null, curriculumExceptions });
    const on = await projection.project({ learnerId: LEARNER });
    expect(entryFor(on.plan, MEDIA_UNIT).status).toBe('completed');
    expect(on.activeExceptions).toHaveLength(1);

    const off = await projection.project({ learnerId: LEARNER, exceptions: false });
    expect(entryFor(off.plan, MEDIA_UNIT).status).toBe('available');
    expect(entryFor(off.plan, WORKSHEET_UNIT).status).toBe('locked');
  });

  it('accepts caller-supplied programStatuses instead of fanning out to launchers', async () => {
    const status = vi.fn(async () => ({ doneToday: true, progressLabel: null, score: null }));
    const { projection } = build({ launchers: new Map([['pe-daily', { status }]]) });
    const result = await projection.project({
      learnerId: LEARNER, programStatuses: { 'pe-daily': { doneToday: true } },
    });
    expect(status).not.toHaveBeenCalled();
    expect(result.programStatuses).toEqual({ 'pe-daily': { doneToday: true } });
  });

  it('augmentPlan runs between the planner and the assigned-program append', async () => {
    const { projection } = build();
    const seen = [];
    const result = await projection.project({
      learnerId: LEARNER,
      augmentPlan: (plan) => {
        seen.push(plan.entries.length);
        plan.entries.push({
          unitId: 'reel:today', title: 'Reel', subject: 'language',
          status: 'available', program: null, timingPriority: 3, timingReasons: [],
        });
      },
    });
    expect(seen).toHaveLength(1);
    expect(entryFor(result.plan, 'reel:today')).toBeTruthy();
    expect(result.sections.map((s) => s.subject)).toContain('language');
  });

  it('dedupes identical concurrent projections into one fan-out', async () => {
    const { projection, sessions } = build();
    const spy = vi.spyOn(sessions, 'listForLearner');
    const [a, b] = await Promise.all([
      projection.project({ learnerId: LEARNER }),
      projection.project({ learnerId: LEARNER }),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // …and never across a settle, because a plan goes stale the moment a
    // session opens underneath it.
    await projection.project({ learnerId: LEARNER });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('refuses to be constructed without the reads it exists to share', () => {
    expect(() => new PlanProjection({ assignments: {}, sessions: {} }))
      .toThrow(/curriculum, assignments and sessions/);
  });

  it('requires a learnerId', async () => {
    const { projection } = build();
    await expect(projection.project({ learnerId: '  ' })).rejects.toThrow(/learnerId/);
  });
});

it('combines linked practice and assessed work while keeping the daily program status', async () => {
 const unit = {unitId:'korean-3-2.lesson-01',title:'Korean Lesson 1',subject:'language',courseId:'korean-3-2',sequence:1,practice:{deckId:'language/korean-3-2/lesson-01'}};
 const projection = new PlanProjection({curriculum:{listUnits:async()=>[unit]},assignments:{get:async()=>({courses:['korean-3-2'],programs:[{programId:'flashcards',deckId:unit.practice.deckId,linkedUnitId:unit.unitId,subject:'language'}]})},sessions:{listForLearner:async()=>[]},practiceAssessments:{get:async()=>({stage:'review',resolvedQuestionIds:['q1'],unresolvedQuestionIds:['q2']})},launchers:new Map([['flashcards',{id:'flashcards',status:async()=>({doneToday:true})}]])});
 const {plan} = await projection.project({learnerId:'test-learner'});
 expect(plan.entries).toHaveLength(1);
 expect(plan.entries[0]).toMatchObject({program:'flashcards',linkedUnitId:unit.unitId,assessment:{stage:'review'}});
 expect(plan.available.some((e)=>e.unitId===unit.unitId)).toBe(false);
});
it('retains teacher progression overrides when practice-linked paper targets are unresolved', async()=>{
 const first={unitId:'k.01',courseId:'k',sequence:1,title:'One',subject:'language',practice:{deckId:'language/k/one'}};
 const second={...first,unitId:'k.02',sequence:2,practice:undefined};
 for(const type of ['attested','excused']){
  const projection=new PlanProjection({curriculum:{listUnits:async()=>[first,second]},assignments:{get:async()=>({courses:['k'],programs:[{programId:'flashcards',deckId:first.practice.deckId,linkedUnitId:first.unitId,subject:'language'}]})},sessions:{listForLearner:async()=>[]},practiceAssessments:{get:async()=>({stage:'practice'})},attestations:type==='attested'?{list:()=>[{id:'att1',unitId:first.unitId,at:'2026-10-01T12:00:00Z'}]}:null,curriculumExceptions:type==='excused'?{active:async()=>[{exceptionId:'ex1',learnerId:'test-learner',kind:'excused',resolvedLessonIds:[first.unitId]}]}:null});
  const {plan}=await projection.project({learnerId:'test-learner'});
  expect(plan.entries.find(e=>e.unitId===second.unitId).status).not.toBe('locked');
 }
});

it('offers only the current linked lesson without owing completed or locked decks', async () => {
  const units = [1, 2, 3].map((sequence) => ({ unitId: `k.${sequence}`, courseId: 'k', sequence, title: `Korean ${sequence}`, subject: 'language', practice: { deckId: `language/k/${sequence}` } }));
  const status = vi.fn(async () => ({ doneToday: false }));
  const projection = new PlanProjection({
    curriculum: { listUnits: async () => units },
    assignments: { get: async () => ({ courses: ['k'], programs: units.map((unit) => ({ programId: 'flashcards', deckId: unit.practice.deckId, linkedUnitId: unit.unitId, subject: 'language' })) }) },
    sessions: { listForLearner: async () => [] },
    attestations: { list: () => [{ id: 'a1', unitId: units[0].unitId, at: '2026-10-01T12:00:00Z' }] },
    practiceAssessments: { get: async ({ unitId }) => ({ stage: unitId === 'k.1' ? 'completed' : unitId === 'k.2' ? 'practice' : 'locked' }) },
    launchers: new Map([['flashcards', { status }]]),
  });
  const result = await projection.project({ learnerId: 'test-learner' });
  expect(result.plan.entries.find((e) => e.linkedUnitId === 'k.1').status).toBe('completed');
  expect(result.plan.entries.find((e) => e.linkedUnitId === 'k.3').status).toBe('locked');
  expect(result.sections.find((s) => s.subject === 'language').next.linkedUnitId).toBe('k.2');
  expect(status).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenCalledWith(expect.objectContaining({ programInstance: 'language/k/2' }));
});

it('finishes the current linked daily goal without requiring future lessons today', async () => {
  const units = [1, 2, 3].map((sequence) => ({ unitId: `k.${sequence}`, courseId: 'k', sequence, title: `Korean ${sequence}`, subject: 'language', practice: { deckId: `language/k/${sequence}` } }));
  const projection = new PlanProjection({ curriculum: { listUnits: async () => units },
    assignments: { get: async () => ({ courses: ['k'], programs: units.map((unit) => ({ programId: 'flashcards', deckId: unit.practice.deckId, linkedUnitId: unit.unitId, subject: 'language' })) }) },
    sessions: { listForLearner: async () => [] },
    practiceAssessments: { get: async ({ unitId }) => ({ stage: unitId === 'k.1' ? 'practice' : 'locked' }) },
    launchers: new Map([['flashcards', { status: async ({ programInstance }) => ({ doneToday: programInstance === 'language/k/1' }) }]]),
  });
  const result = await projection.project({ learnerId: 'test-learner' });
  expect(result.sections.find((s) => s.subject === 'language').obligation).toEqual({ state: 'served', reason: null });
});
