// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
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
