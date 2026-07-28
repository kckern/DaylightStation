import { describe, it, expect, beforeEach } from 'vitest';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeFormMapStore, FakeReviewQueue,
  fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, omrBank, OMR_UNIT,
} from '#testlib/school/lifecycleFixtures.mjs';

/**
 * Marking a paper sheet is not one moment. The engine reads the bubbles now; a
 * parent may read the handwriting tomorrow, from a different device, holding
 * nothing but the queue. These are the tests that pin that seam.
 */

const SID = 'ses_1';
const BANK = omrBank();

class FakeGrader {
  constructor() { this.attempts = []; this.sessions = 0; }

  openSession() { this.sessions += 1; return { sessionId: `quiz_${this.sessions}` }; }

  answer({ itemId, given, transport }) {
    const item = BANK.items.find((i) => i.id === itemId);
    const attemptId = `att_${this.attempts.length + 1}`;
    this.attempts.push({ id: attemptId, itemId, given, transport });
    return { correct: item.answer === given, expected: item.answer, attemptId };
  }
}

let clock, sessions, reviewQueue, grader, submit, grade;

beforeEach(async () => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  reviewQueue = new FakeReviewQueue();
  grader = new FakeGrader();
  const bankReader = { getBank: (id) => (id === BANK.id ? BANK : null) };
  submit = new SubmitPaperWork({
    curriculum, sessions, formMaps: new FakeFormMapStore(), reviewQueue, bankReader,
    clock: clock.now, logger: silentLogger,
  });
  grade = new GradeSubmission({ curriculum, sessions, reviewQueue, grader, bankReader, clock: clock.now, logger: silentLogger });

  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: OMR_UNIT });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
});

describe('machine now, parent later', () => {
  it('the parent finishes the sheet WITHOUT re-sending the answers', async () => {
    await submit.execute({ sessionId: SID, entries: { q1: 'C' }, ambiguous: ['q2'] });
    const first = await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    expect(first).toMatchObject({ status: 'awaiting_review', outstanding: ['q2'] });

    clock.advanceDays(1);
    // A day later, from the parent surface: a verdict and nothing else.
    const second = await grade.execute({ sessionId: SID, verdicts: { q2: 'incorrect' }, gradedBy: 'parent' });
    expect(second).toMatchObject({ status: 'graded', percent: 50, correct: 1, expected: 2 });
  });

  it('does not re-grade an item the engine already marked', async () => {
    await submit.execute({ sessionId: SID, entries: { q1: 'C' }, ambiguous: ['q2'] });
    await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    await grade.execute({ sessionId: SID, entries: { q1: 'C' }, verdicts: { q2: 'correct' }, gradedBy: 'parent' });
    expect(grader.attempts).toHaveLength(1);
  });

  it('keeps the engine\'s marks off the parent\'s pending list', async () => {
    await submit.execute({ sessionId: SID, entries: { q1: 'C' }, ambiguous: ['q2'] });
    await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    expect((await reviewQueue.listPending()).map((i) => i.itemId)).toEqual(['q2']);
  });

  it('records who marked each item — engine or person', async () => {
    await submit.execute({ sessionId: SID, entries: { q1: 'C' }, ambiguous: ['q2'] });
    await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    await grade.execute({ sessionId: SID, verdicts: { q2: 'correct' }, gradedBy: 'parent' });
    const queue = await reviewQueue.listForSession(SID);
    expect(queue.map((i) => [i.itemId, i.gradedBy])).toEqual([['q2', 'parent'], ['q1', 'engine']]);
  });

  it('a parent may overrule the engine before the sheet is closed', async () => {
    await submit.execute({ sessionId: SID, entries: { q1: 'A' }, ambiguous: ['q2'] });
    await grade.execute({ sessionId: SID, entries: { q1: 'A' } }); // wrong per the bank
    const result = await grade.execute({
      sessionId: SID, verdicts: { q1: 'correct', q2: 'correct' }, gradedBy: 'parent',
    });
    expect(result).toMatchObject({ status: 'graded', percent: 100 });
  });
});
