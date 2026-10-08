// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { PlanProjection } from './PlanProjection.mjs';
import { PracticeAssessmentService } from './PracticeAssessmentService.mjs';
import { FakeSessionRepository } from '../../../../tests/_lib/school/lifecycleFakes.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
const practice = { programId: 'flashcards', deckId: 'language/test/one', requiredCardIds: ['a'], questionCards: { q1: { cardIds: ['a'], kind: 'application', explanation: 'Permission.' } } };
const unit = { unitId: 'test.01', title: 'Test', courseId: 'test', sequence: 1, practice, document: 'print/test-a@123456789', assessmentForms: ['print/test-a@123456789', 'print/test-b@123456789'] };
function fixture() {
  const sessions = new FakeSessionRepository();
  let evidence = { status: { words: {} }, dayFiles: [] };
  const service = new PracticeAssessmentService({ curriculum: { getUnit: async () => unit, listUnits: async () => [unit] }, assignments: { get: async (id) => id === 'test-learner' ? { courses: ['test'], programs: [{ programId: 'flashcards', deckId: practice.deckId, linkedUnitId: unit.unitId, policy: { mode: 'card-ladder' } }] } : {} }, sessions,
    cardLadder: { courseEvidence: async () => evidence }, clock: () => new Date('2026-10-07T13:00:00Z'),
  });
  return { service, sessions, ready: () => { evidence.status.words.a = { state: 'mastered', recognizedCount: 1, matched: true }; } };
}
describe('PracticeAssessmentService', () => {
  it('checks assignment and refuses premature document issuance', async () => {
    const f = fixture();
    await expect(f.service.get({ learnerId: 'other', unitId: unit.unitId })).rejects.toThrow(/assigned/);
    const created = createEvent({ type: 'created', at: '2026-10-07T12:00:00Z', sessionId: 's1', learnerId: 'test-learner', unitId: unit.unitId });
    await f.sessions.appendEvent('s1', created.event);
    await expect(f.service.prepare({ state: reduceSession(await f.sessions.readEvents('s1')), unit })).rejects.toThrow(/practice/);
    f.ready();
    const snapshot = await f.service.prepare({ state: reduceSession(await f.sessions.readEvents('s1')), unit });
    expect(snapshot).toMatchObject({ practice, questionIds: ['q1'], document: unit.document });
    expect(reduceSession(await f.sessions.readEvents('s1')).practiceAssessment).toEqual(snapshot);
    const again = await f.service.prepare({ state: reduceSession(await f.sessions.readEvents('s1')), unit });
    expect(again).toEqual(snapshot);
    expect((await f.sessions.readEvents('s1')).filter((e) => e.type === 'practice_prepared')).toHaveLength(1);
  });
  it('rejects mismatched sibling enrollment linkage', async () => {
    const f = fixture();
    await expect(f.service.get({ learnerId: 'test-learner', unitId: 'unknown' })).rejects.toThrow();
  });
});

it('demotes only vocabulary misses through idempotent paper feedback', async () => {
  const f = fixture();
  const coursePaperFeedback = vi.fn();
  const service = new PracticeAssessmentService({ curriculum: {}, assignments: {}, sessions: f.sessions, cardLadder: { coursePaperFeedback } });
  await service.recordFeedback({ state: { learnerId: 'test-learner', sessionId: 's1', gradedAt: '2026-10-07T13:00:00Z', missedItemIds: ['grammar', 'word'], practiceAssessment: { practice: { ...practice, questionCards: { grammar: { kind: 'application', cardIds: ['a'] }, word: { kind: 'vocabulary', cardIds: ['b'] } } } } } });
  expect(coursePaperFeedback).toHaveBeenCalledWith(expect.objectContaining({ cardIds: ['b'], attemptKey: 's1:2026-10-07T13:00:00Z' }));
});

it('refuses an alternate form with a different question roster', async () => {
  const f = fixture(); f.ready();
  f.service.configurePrinting({ printDocuments: { getPublished: async () => ({ blocks: [{ type: 'question', itemId: 'unknown' }] }) } });
  const event = createEvent({ type: 'created', at: '2026-10-07T12:00:00Z', sessionId: 's1', learnerId: 'test-learner', unitId: unit.unitId });
  await f.sessions.appendEvent('s1', event.event);
  await expect(f.service.prepare({ state: reduceSession(await f.sessions.readEvents('s1')), unit })).rejects.toThrow(/question roster/);
});
it('allows a linked successor after a teacher attests its predecessor', async()=>{
 const predecessor={...unit,unitId:'test.00',sequence:1};
 const successor={...unit,sequence:2};
 const service=new PracticeAssessmentService({curriculum:{getUnit:async()=>successor,listUnits:async()=>[predecessor,successor]},assignments:{get:async()=>({courses:['test'],programs:[{programId:'flashcards',deckId:practice.deckId,linkedUnitId:successor.unitId,policy:{mode:'card-ladder'}}]})},sessions:new FakeSessionRepository(),cardLadder:{courseEvidence:async()=>({status:{words:{a:{state:'mastered',recognizedCount:1,matched:true}}},dayFiles:[]})},attestations:{list:()=>[{id:'att1',unitId:predecessor.unitId,at:'2026-10-01T12:00:00Z'}]}});
 expect((await service.get({learnerId:'test-learner',unitId:successor.unitId})).stage).toBe('quiz_ready');
});

it('keeps academic readiness separate from paused access', async () => {
  const sessions = new FakeSessionRepository();
  const service = new PracticeAssessmentService({ curriculum: { listUnits: async () => [unit] },
    assignments: { get: async () => ({ courses: ['test'], programs: [{ programId: 'flashcards', deckId: practice.deckId, linkedUnitId: unit.unitId, policy: { mode: 'card-ladder' } }] }) }, sessions,
    curriculumExceptions: { active: async () => [{ learnerId: null, scope: { courseId: unit.courseId }, kind: 'paused', resolvedLessonIds: [unit.unitId], reason: 'Teacher pause' }] },
    cardLadder: { courseEvidence: async () => ({ status: { words: { a: { state: 'mastered', recognizedCount: 1, matched: true } } } }) } });
  const progress = await service.get({ learnerId: 'test-learner', unitId: unit.unitId });
  expect(progress.stage).toBe('quiz_ready');
  expect(progress.access.allowed).toBe(false);
  service.configurePrinting({ issueDocument: { execute: vi.fn() } });
  await expect(service.review({ learnerId: 'test-learner', unitId: unit.unitId })).rejects.toThrow(/paused/);
  const append = (type, fields = {}) => sessions.appendEvent('paused-sheet', { type, at: '2026-10-07T12:00:00Z', sessionId: 'paused-sheet', ...fields });
  await append('created', { learnerId: 'test-learner', unitId: unit.unitId });
  await expect(service.prepare({ state: reduceSession(await sessions.readEvents('paused-sheet')), unit })).rejects.toThrow(/paused/);
  const snapshot = { practice, assessmentForms: unit.assessmentForms, document: unit.document, questionIds: ['q1'], readyAt: '2026-10-07T12:00:00Z' };
  await append('practice_prepared', { assessment: snapshot });
  await append('issued', { artifactId: 'a' });
  const issued = reduceSession(await sessions.readEvents('paused-sheet'));
  expect(await service.prepare({ state: issued, unit })).toEqual(snapshot);
  await append('submitted', { transport: 'paper' });
  await append('graded', { percent: 100, attemptIds: ['a1'], missedItemIds: [] });
  const completed = await service.get({ learnerId: 'test-learner', unitId: unit.unitId });
  expect(completed.stage).toBe('completed');
  expect(completed.access.allowed).toBe(false);
});

it('does not borrow current mastery for a historical projection', async () => {
  const f = fixture(); f.ready();
  const progress = await f.service.get({ learnerId: 'test-learner', unitId: unit.unitId, historyUntil: '2026-10-01T00:00:00Z' });
  expect(progress.stage).toBe('unknown');
  expect(progress.readinessKnown).toBe(false);
});

it('replays the old paper grade before a later correction', async () => {
  const f = fixture(); f.ready();
  const append = (type, at, fields = {}) => f.sessions.appendEvent('s1', { type, at, sessionId: 's1', ...fields });
  await append('created', '2026-10-01T12:00:00Z', { learnerId: 'test-learner', unitId: unit.unitId });
  await f.service.prepare({ state: reduceSession(await f.sessions.readEvents('s1')), unit });
  await append('issued', '2026-10-07T13:01:00Z', { artifactId: 'a1' });
  await append('submitted', '2026-10-07T13:02:00Z', { transport: 'paper' });
  await append('graded', '2026-10-07T13:03:00Z', { percent: 100, attemptIds: ['a1'], missedItemIds: [] });
  await append('outcome_recorded', '2026-10-07T13:04:00Z', { outcomeId: 'out:s1', result: 'passed' });
  await append('grade_adjusted', '2026-10-08T13:00:00Z', { adjustmentId: 'adj1', adjustedBy: 'parent', reason: 'corrected', percent: 0, missedItemIds: ['q1'] });
  const then = await f.service.get({ learnerId: 'test-learner', unitId: unit.unitId, historyUntil: '2026-10-08T00:00:00Z' });
  expect(then.stage).toBe('completed');
  expect((await f.service.get({ learnerId: 'test-learner', unitId: unit.unitId })).stage).toBe('review');
});

it('refuses changed question-to-card links against frozen academic credits', async () => {
  const f = fixture(); f.ready();
  await f.sessions.appendEvent('s1', { type: 'created', at: '2026-10-07T12:00:00Z', sessionId: 's1', learnerId: 'test-learner', unitId: unit.unitId });
  const state = reduceSession(await f.sessions.readEvents('s1'));
  await expect(f.service.prepare({ state, unit: { ...unit, practice: { ...practice, questionCards: { q1: { ...practice.questionCards.q1, cardIds: ['b'] } } } } })).rejects.toThrow(/card links/);
});


it('resolves the shared projection launcher -> course access loop without self-await', async () => {
  const sessions = new FakeSessionRepository();
  const curriculum = { listUnits: async () => [unit] };
  const assignments = { get: async () => ({ courses: ['test'], programs: [{ programId: 'flashcards', subject: 'language', deckId: practice.deckId, linkedUnitId: unit.unitId, policy: { mode: 'card-ladder' } }] }) };
  const service = new PracticeAssessmentService({ curriculum, assignments, sessions,
    cardLadder: { courseEvidence: async () => ({ status: { words: {} }, dayFiles: [] }) } });
  const status = vi.fn(async () => {
    const assessment = await service.forDeck({ learnerId: 'test-learner', deckId: practice.deckId });
    return { doneToday: false, assessment };
  });
  const projection = new PlanProjection({ curriculum, assignments, sessions, practiceAssessments: service,
    launchers: new Map([['flashcards', { id: 'flashcards', status }]]) });
  service.configureProjection(projection);
  let timeout;
  try {
    const projected = await Promise.race([projection.project({ learnerId: 'test-learner' }), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('projection self-await')), 1000);
    })]);
    expect(projected.assessmentByUnit.get(unit.unitId).stage).toBe('practice');
    expect(status).toHaveBeenCalledTimes(1);
  } finally { clearTimeout(timeout); }
});
