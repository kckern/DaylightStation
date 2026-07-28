import { describe, it, expect, beforeEach } from 'vitest';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { questionItemIds } from '#domains/school/documents/documentValidation.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeFormMapStore, FakeReviewQueue,
  fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, OMR_UNIT,
  fixtureBank, fixtureDocument, OMR_BANK_ID, OMR_DOCUMENT_ID,
} from '#testlib/school/lifecycleFixtures.mjs';

/**
 * Marking a paper sheet is not one moment. The engine reads the bubbles now; a
 * parent may read the handwriting tomorrow, from a different device, holding
 * nothing but the queue. These are the tests that pin that seam.
 *
 * Answers are the real bank's answer TEXT throughout.
 */

const SID = 'ses_1';
const BANK = fixtureBank(OMR_BANK_ID);
const PRINTED = questionItemIds(fixtureDocument(OMR_DOCUMENT_ID));
/** The item the reader smudges, so a person has to finish the sheet. */
const SMUDGED = PRINTED[PRINTED.length - 1];
const MACHINE_READ = PRINTED.filter((id) => id !== SMUDGED);

const answerFor = (id) => BANK.items.find((i) => i.id === id).answer;
const distractorFor = (id) => BANK.items.find((i) => i.id === id).choices.find((c) => c !== answerFor(id));

/** Five bubbles the reader could read: three right, two wrong. */
const READ = Object.fromEntries(MACHINE_READ.map((id, i) => [id, i < 3 ? answerFor(id) : distractorFor(id)]));

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

const handIn = (entries = READ) => submit.execute({ sessionId: SID, entries, ambiguous: [SMUDGED] });

describe('machine now, parent later', () => {
  it('the parent finishes the sheet WITHOUT re-sending the answers', async () => {
    await handIn();
    const first = await grade.execute({ sessionId: SID, entries: READ });
    expect(first).toMatchObject({ status: 'awaiting_review', outstanding: [SMUDGED] });

    clock.advanceDays(1);
    // A day later, from the parent surface: a verdict and nothing else.
    const second = await grade.execute({ sessionId: SID, verdicts: { [SMUDGED]: 'incorrect' }, gradedBy: 'parent' });
    expect(second).toMatchObject({ status: 'graded', percent: 50, correct: 3, expected: 6 });
  });

  it('does not re-grade an item the engine already marked', async () => {
    await handIn();
    await grade.execute({ sessionId: SID, entries: READ });
    await grade.execute({ sessionId: SID, entries: READ, verdicts: { [SMUDGED]: 'correct' }, gradedBy: 'parent' });
    expect(grader.attempts).toHaveLength(MACHINE_READ.length);
  });

  it('keeps the engine\'s marks off the parent\'s pending list', async () => {
    await handIn();
    await grade.execute({ sessionId: SID, entries: READ });
    expect((await reviewQueue.listPending()).map((i) => i.itemId)).toEqual([SMUDGED]);
  });

  it('records who marked each item — engine or person', async () => {
    await handIn();
    await grade.execute({ sessionId: SID, entries: READ });
    await grade.execute({ sessionId: SID, verdicts: { [SMUDGED]: 'correct' }, gradedBy: 'parent' });
    const queue = await reviewQueue.listForSession(SID);
    expect(queue.map((i) => [i.itemId, i.gradedBy]))
      .toEqual([[SMUDGED, 'parent'], ...MACHINE_READ.map((id) => [id, 'engine'])]);
  });

  it('a parent may overrule the engine before the sheet is closed', async () => {
    const allWrong = Object.fromEntries(MACHINE_READ.map((id) => [id, distractorFor(id)]));
    await handIn(allWrong);
    await grade.execute({ sessionId: SID, entries: allWrong }); // every one wrong per the bank
    const result = await grade.execute({
      sessionId: SID,
      verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])),
      gradedBy: 'parent',
    });
    expect(result).toMatchObject({ status: 'graded', percent: 100 });
  });
});
