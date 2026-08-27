/**
 * Paper in: what a hand-in means, and what a bubble sheet decodes to.
 *
 * EVERY answer below is the REAL bank's answer TEXT ('5/6'), never a bubble
 * letter. That distinction is the whole suite: this file used to grade against a
 * hand-written bank whose `answer` was 'C', so a decoder returning the letter
 * instead of the choice printed under the bubble agreed with the fixture and
 * disagreed with every real sheet — 0 out of 6, green tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { ResolveReviewItem } from '#apps/school/usecases/ResolveReviewItem.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';
import { questionItemIds } from '#domains/school/documents/documentValidation.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeFormMapStore, FakeReviewQueue,
  fakeClock, fakeGrownUps, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, printedFormMap, correctBubbles,
  fixtureBank, fixtureDocument, fixtureUnit, OMR_BANK_ID, MEDIA_BANK_ID, OMR_DOCUMENT_ID,
  WORKSHEET_UNIT, WORKSHEET_DOCUMENT_ID, OMR_UNIT,
} from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_1';

const OMR_BANK = fixtureBank(OMR_BANK_ID);
/** The six items the PAPER poses, in printed order — the score's denominator. */
const PRINTED = questionItemIds(fixtureDocument(OMR_DOCUMENT_ID));
/** itemId → the bank's answer TEXT, which is what a decoded bubble must equal. */
const RIGHT = Object.fromEntries(OMR_BANK.items.map((i) => [i.id, i.answer]));
/** The same, but three of them wrong — a real distractor off the same bank item. */
const wrongFor = (itemId) => OMR_BANK.items.find((i) => i.id === itemId).choices.find((c) => c !== RIGHT[itemId]);
const someWrong = (ids) => ({ ...RIGHT, ...Object.fromEntries(ids.map((id) => [id, wrongFor(id)])) });
const without = (ids) => Object.fromEntries(Object.entries(RIGHT).filter(([id]) => !ids.includes(id)));

/**
 * A stand-in for `SchoolService` with its two grading methods and its attempt
 * shape. It grades by exact match against the bank, which is all the real engine
 * does for a multiple-choice item.
 */
class FakeGrader {
  constructor(banks) { this.banks = banks; this.attempts = []; this.sessions = 0; }

  openSession({ userId, bankId, mode }) {
    this.sessions += 1;
    return { sessionId: `quiz_${this.sessions}`, userId, bankId, mode };
  }

  answer({
    sessionId, itemId, given, transport, provenance = null,
  }) {
    const bank = Object.values(this.banks).find((b) => b.items.some((i) => i.id === itemId));
    const item = bank.items.find((i) => i.id === itemId);
    const correct = item.answer === given;
    const attemptId = `att_${this.attempts.length + 1}`;
    this.attempts.push({
      id: attemptId, sessionId, itemId, given, correct, mode: 'quiz', transport, provenance,
    });
    return { correct, expected: item.answer, attemptId };
  }
}

let clock, sessions, formMaps, reviewQueue, grader, submit, grade, curriculum;

const BANKS = {
  [OMR_BANK_ID]: OMR_BANK,
  [MEDIA_BANK_ID]: fixtureBank(MEDIA_BANK_ID),
};

const build = () => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  formMaps = new FakeFormMapStore();
  reviewQueue = new FakeReviewQueue();
  grader = new FakeGrader(BANKS);
  const bankReader = { getBank: (id) => BANKS[id] ?? null };
  submit = new SubmitPaperWork({ curriculum, sessions, formMaps, reviewQueue, bankReader, clock: clock.now, logger: silentLogger });
  grade = new GradeSubmission({
    curriculum, sessions, reviewQueue, grader, bankReader,
    grownUps: fakeGrownUps(clock), clock: clock.now, logger: silentLogger,
  });
};

const issued = async (unitId = OMR_UNIT, artifactId = 'art_1') => {
  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId });
  return artifactId;
};

beforeEach(() => build());

describe('SubmitPaperWork classification', () => {
  it('scores what it can and records the hand-in', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: RIGHT });
    expect(result).toMatchObject({ status: 'submitted', expectedItems: PRINTED, review: [] });
    expect(result.scorable).toEqual(RIGHT);
    expect(sessions.types(SID)).toEqual(['created', 'issued', 'submitted']);
    expect(sessions.derive(SID).transport).toBe('paper');
  });

  it('sends an AMBIGUOUS row to a person instead of guessing', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: without(['u3-q2']), ambiguous: ['u3-q2'] });
    expect(result.scorable).toEqual(without(['u3-q2']));
    expect(result.review).toEqual([expect.objectContaining({ itemId: 'u3-q2', reason: 'ambiguous' })]);
    expect(await reviewQueue.listForSession(SID)).toHaveLength(1);
  });

  it('sends a BLANK row to a person rather than marking it wrong', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: without(['u3-q2']), blank: ['u3-q2'] });
    expect(result.review[0]).toMatchObject({ itemId: 'u3-q2', reason: 'blank' });
  });

  it('treats a missing answer as blank — the sheet is out of what it printed', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: without(['u3-q6']) });
    expect(result.expectedItems).toEqual(PRINTED);
    expect(result.review).toEqual([expect.objectContaining({ itemId: 'u3-q6', reason: 'blank' })]);
  });

  it('sends free-response work to a person — no bank means nothing to compare', async () => {
    await issued(WORKSHEET_UNIT);
    const written = questionItemIds(fixtureDocument(WORKSHEET_DOCUMENT_ID));
    const result = await submit.execute({
      sessionId: SID, entries: Object.fromEntries(written.map((id, i) => [id, `${i + 1}/12`])),
    });
    expect(result.scorable).toEqual({});
    expect(result.review.map((r) => r.reason)).toEqual(written.map(() => 'free_response'));
    // The unit's own rubric rides along as the rubric — it is HOW to mark, and
    // it is the same on every item, which is why it is not the prompt.
    expect(result.review[0].rubric).toContain('Mark each');
  });

  it('carries the learner and unit into the queue so a parent knows whose work it is', async () => {
    await issued();
    await submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
    expect((await reviewQueue.listPending())[0]).toMatchObject({ learnerId: 'kid1', unitId: OMR_UNIT });
  });
});

describe('SubmitPaperWork refusals', () => {
  it('rejects a DUPLICATE submission and points at the existing result', async () => {
    await issued();
    await submit.execute({ sessionId: SID, entries: RIGHT });
    const second = await submit.execute({ sessionId: SID, entries: someWrong(PRINTED) });
    expect(second.status).toBe('duplicate');
    expect(second.pointsAt).toMatchObject({ state: 'submitted' });
    expect(sessions.types(SID)).toEqual(['created', 'issued', 'submitted']);
  });

  it('refuses work that was never printed', async () => {
    await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: OMR_UNIT });
    expect(await submit.execute({ sessionId: SID, entries: RIGHT })).toMatchObject({ status: 'unavailable' });
  });

  it('explains an unknown session', async () => {
    expect(await submit.execute({ sessionId: 'ses_nope' })).toMatchObject({ status: 'unavailable' });
  });
});

describe('SubmitPaperWork from a bubble sheet', () => {
  const reader = new VirtualOmrReader({ logger: silentLogger });

  it('decodes each bubble to the CHOICE TEXT printed under it, not its letter', async () => {
    const artifactId = await issued();
    const formMap = printedFormMap();
    await formMaps.put(artifactId, formMap);

    const chosen = correctBubbles({ formMap });
    // What a child fills in is a letter…
    expect(Object.values(chosen).every((c) => /^[A-D]$/.test(c))).toBe(true);

    const sheet = reader.scanSheet({ formMap, chosen });
    const result = await submit.fromOmrSheet({ sessionId: SID, sheet });
    // …and what reaches the grader is the answer the bank holds. A decoder that
    // handed the letter over would score every one of these wrong.
    expect(result.scorable).toEqual(RIGHT);
  });

  it('routes a smudged row to review', async () => {
    const artifactId = await issued();
    const formMap = printedFormMap();
    await formMaps.put(artifactId, formMap);
    const chosen = correctBubbles({ formMap });
    delete chosen['u3-q2'];
    const sheet = reader.scanSheet({ formMap, chosen, ambiguous: ['u3-q2'] });
    const result = await submit.fromOmrSheet({ sessionId: SID, sheet });
    expect(result.review).toEqual([expect.objectContaining({ itemId: 'u3-q2', reason: 'ambiguous' })]);
  });

  it('refuses a sheet with no stored form map rather than scoring blind', async () => {
    await issued();
    const formMap = printedFormMap();
    const sheet = reader.scanSheet({ formMap, chosen: correctBubbles({ formMap }) });
    expect(await submit.fromOmrSheet({ sessionId: SID, sheet })).toMatchObject({ status: 'unavailable' });
    expect(sessions.types(SID)).toEqual(['created', 'issued']);
  });

  it('refuses a sheet that does not match the form it claims', async () => {
    const artifactId = await issued();
    await formMaps.put(artifactId, printedFormMap());
    expect(await submit.fromOmrSheet({ sessionId: SID, sheet: { marks: [1, 2, 3, 4] } })).toMatchObject({ status: 'unavailable' });
  });
});

describe('GradeSubmission through the one engine', () => {
  const submitAll = async (entries, extra = {}) => {
    await issued();
    return submit.execute({ sessionId: SID, entries, ...extra });
  };

  it('produces normal quiz attempts carrying transport: paper', async () => {
    await submitAll(RIGHT);
    const result = await grade.execute({ sessionId: SID, entries: RIGHT });
    expect(result).toMatchObject({ status: 'graded', percent: 100, correct: PRINTED.length, expected: PRINTED.length });
    expect(grader.attempts.every((a) => a.transport === 'paper' && a.mode === 'quiz')).toBe(true);
  });

  it('carries correctCount/totalCount on the graded event so the receipt can say "N of M"', async () => {
    const missed = someWrong(['u3-q4', 'u3-q5', 'u3-q6']);
    await submitAll(missed);
    await grade.execute({ sessionId: SID, entries: missed });
    // Same field names `RecordCardScanOutcome` emits — `reduceSession` only
    // projects `gradedCorrectCount`/`gradedTotalCount`, which
    // `CloseSessionOutcome` renders onto the result receipt, from these.
    expect(sessions.events(SID).find((e) => e.type === 'graded'))
      .toMatchObject({ correctCount: 3, totalCount: PRINTED.length });
    expect(sessions.derive(SID))
      .toMatchObject({ gradedCorrectCount: 3, gradedTotalCount: PRINTED.length });
  });

  it('stamps the EFFECTIVE passing bar into the graded event — override first, authored as fallback (M7/A4)', async () => {
    // With an override wired, grading stamps the override; the return says it too.
    const withOverride = new GradeSubmission({
      curriculum, sessions, reviewQueue, grader, bankReader: { getBank: (id) => BANKS[id] ?? null },
      grownUps: fakeGrownUps(clock), passOverrides: { percentFor: () => 55 },
      clock: clock.now, logger: silentLogger,
    });
    await submitAll(RIGHT);
    const result = await withOverride.execute({ sessionId: SID, entries: RIGHT });
    expect(result.passingPercent).toBe(55);
    const gradedEvent = sessions.events(SID).find((e) => e.type === 'graded');
    expect(gradedEvent.passingPercent).toBe(55);
    expect(sessions.derive(SID).gradedPassingPercent).toBe(55);
  });

  it('scores out of what the sheet printed, not out of what came back', async () => {
    const partial = without(['u3-q6']);
    await submitAll(partial);
    const result = await grade.execute({ sessionId: SID, entries: partial });
    // u3-q6 came back blank, so it is outstanding — NOT counted wrong out of five.
    expect(result).toMatchObject({ status: 'awaiting_review', correct: 5, expected: 6, outstanding: ['u3-q6'] });
    expect(sessions.types(SID)).not.toContain('graded');
  });

  it('records the grade only when every question has a verdict', async () => {
    const partial = without(['u3-q6']);
    await submitAll(partial);
    await grade.execute({ sessionId: SID, entries: partial });
    const finished = await grade.execute({ sessionId: SID, verdicts: { 'u3-q6': 'correct' }, gradedBy: 'parent' });
    expect(finished).toMatchObject({ status: 'graded', percent: 100 });
    expect(sessions.derive(SID)).toMatchObject({ state: 'graded', gradedPercent: 100 });
  });

  it('keeps a parent verdict in the review queue, NOT in the attempt log', async () => {
    await submitAll({}, { blank: PRINTED });
    const verdicts = Object.fromEntries(PRINTED.map((id, i) => [id, i === 0 ? 'incorrect' : 'correct']));
    await grade.execute({ sessionId: SID, verdicts, gradedBy: 'parent' });
    expect(grader.attempts).toEqual([]);
    const queue = await reviewQueue.listForSession(SID);
    expect(queue.map((i) => [i.itemId, i.verdict, i.gradedBy]))
      .toEqual(PRINTED.map((id, i) => [id, i === 0 ? 'incorrect' : 'correct', 'parent']));
  });

  it('points a wholly parent-marked sheet at its own session for evidence', async () => {
    await submitAll({}, { blank: PRINTED });
    const result = await grade.execute({
      sessionId: SID, verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])), gradedBy: 'parent',
    });
    expect(result.attemptIds).toEqual([`review:${SID}`]);
  });

  it('marks a wrong answer wrong', async () => {
    const missed = someWrong(['u3-q4', 'u3-q5', 'u3-q6']);
    await submitAll(missed);
    expect(await grade.execute({ sessionId: SID, entries: missed }))
      .toMatchObject({ status: 'graded', percent: 50, correct: 3 });
  });

  it('rejects a second marking and points at the first result', async () => {
    await submitAll(RIGHT);
    await grade.execute({ sessionId: SID, entries: RIGHT });
    const second = await grade.execute({ sessionId: SID, entries: someWrong(PRINTED) });
    expect(second).toMatchObject({ status: 'duplicate', percent: 100 });
    expect(sessions.types(SID).filter((t) => t === 'graded')).toHaveLength(1);
  });

  it('refuses to mark work that was never handed in', async () => {
    await issued();
    expect(await grade.execute({ sessionId: SID, entries: RIGHT })).toMatchObject({ status: 'unavailable' });
  });

  it('opens exactly one quiz session for a whole sheet', async () => {
    await submitAll(RIGHT);
    await grade.execute({ sessionId: SID, entries: RIGHT });
    expect(grader.sessions).toBe(1);
  });

  it('a screen-graded paper submission records the WORK session id, not only the throwaway grader session', async () => {
    await submitAll(RIGHT);
    await grade.execute({ sessionId: SID, entries: RIGHT });
    // grader.sessions opened its own disposable quiz_1 session (asserted above);
    // every machine-graded attempt must still carry the WORK session (SID) that
    // will not otherwise appear anywhere on the attempt itself.
    expect(grader.attempts.every((a) => a.sessionId !== SID)).toBe(true);
    expect(grader.attempts).not.toHaveLength(0);
    expect(grader.attempts.every((a) => a.provenance && a.provenance.kind === 'review-grade'
      && a.provenance.workSessionId === SID)).toBe(true);
  });
});

/**
 * A question nobody could mark (teacher-coverage 1.1).
 *
 * `void` is not a third way of being wrong. It says the EVIDENCE ran out — a
 * torn scan, a question that needs the child in the room — so the question
 * leaves the denominator rather than costing the kid a mark. The arithmetic is
 * the whole risk here: a voided item that stays in `expectedItems` reads as
 * outstanding forever and the session never grades at all, and one that lands
 * in `marked` as `false` quietly counts an unreadable answer as a wrong one.
 */
describe('a question nobody could mark leaves the denominator', () => {
  const submitAllBlank = async () => {
    await issued();
    return submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
  };
  /**
   * Voiding happens on the REVIEW route, never on the grading call: that is
   * the only lane with somewhere to put the note the child is owed. These
   * tests drive it the way the console does.
   */
  const voidItem = (itemId, note = 'The scan tore across this one — bring me the paper.') => (
    new ResolveReviewItem({ reviewQueue, grownUps: fakeGrownUps(clock), clock: clock.now, logger: silentLogger })
      .execute({ sessionId: SID, itemId, verdict: 'void', gradedBy: 'parent', note })
  );
  /** Four right, one wrong — the sixth is voided separately. */
  const FOUR_AND_ONE = Object.fromEntries(PRINTED.slice(0, 5).map((id, i) => [id, i === 4 ? 'incorrect' : 'correct']));
  const VOIDED = PRINTED[5];

  it('scores 4 of 5, not 4 of 6 and not 5 of 6', async () => {
    await submitAllBlank();
    await voidItem(VOIDED);
    const result = await grade.execute({ sessionId: SID, verdicts: FOUR_AND_ONE, gradedBy: 'parent' });
    expect(result).toMatchObject({
      status: 'graded', correct: 4, expected: 5, percent: 80, voidedItemIds: [VOIDED],
    });
    // The two wrong answers this rules out, named so a regression says which:
    expect(result.percent).not.toBeCloseTo(66.67, 1); // 4/6 — voided counted wrong
    expect(result.percent).not.toBe(83.33);           // 5/6 — voided counted right
    expect(result.message).toBe('Marked: 4 of 5.');
  });

  it('does NOT leave the voided question outstanding — the session actually grades', async () => {
    await submitAllBlank();
    await voidItem(VOIDED);
    const result = await grade.execute({ sessionId: SID, verdicts: FOUR_AND_ONE, gradedBy: 'parent' });
    expect(result.outstanding).toEqual([]);
    expect(sessions.derive(SID).state).toBe('graded');
  });

  it('the voided ids reach the STORED graded event — the field survives the whitelist', async () => {
    await submitAllBlank();
    await voidItem(VOIDED);
    await grade.execute({ sessionId: SID, verdicts: FOUR_AND_ONE, gradedBy: 'parent' });
    // Asserting on what was WRITTEN, not on what was passed in: `createEvent`
    // silently drops any field the schema's `fields` array does not declare,
    // so a stamp that never reached the log would still look fine at the call
    // site. This is the declaration under test.
    const graded = sessions.events(SID).find((e) => e.type === 'graded');
    expect(graded).toMatchObject({ correctCount: 4, totalCount: 5, voidedItemIds: [VOIDED] });
    expect(sessions.derive(SID)).toMatchObject({
      gradedCorrectCount: 4, gradedTotalCount: 5, voidedItemIds: [VOIDED],
    });
  });

  it('says nothing at all when nothing was voided — an absent stamp is the honest default', async () => {
    await submitAllBlank();
    await grade.execute({
      sessionId: SID, verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])), gradedBy: 'parent',
    });
    expect(sessions.events(SID).find((e) => e.type === 'graded')).not.toHaveProperty('voidedItemIds');
    expect(sessions.derive(SID).voidedItemIds).toEqual([]);
  });

  it('REFUSES a void on the grading lane, and names the lane that can carry the note', async () => {
    // The map is `itemId -> string`: there is nowhere to put the sentence the
    // child is owed, and the queue neither erases nor invents a missing note.
    // An accepted-but-note-free void would drop a question from a score in
    // silence over HTTP, so this lane turns it away instead.
    await submitAllBlank();
    await expect(grade.execute({ sessionId: SID, verdicts: { [VOIDED]: 'void' }, gradedBy: 'parent' }))
      .rejects.toMatchObject({ name: 'ValidationError' });
    await expect(grade.execute({ sessionId: SID, verdicts: { [VOIDED]: 'void' }, gradedBy: 'parent' }))
      .rejects.toThrow(/review/);
    // Nothing was written: the refusal happens before the queue is touched.
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === null)).toBe(true);
    expect(sessions.types(SID)).not.toContain('graded');
  });

  it('UN-VOIDING through the grading lane returns the question to the denominator', async () => {
    // A question voided yesterday, marked today: the queue row is overwritten,
    // so the `voided` set read off that queue moments earlier has to let go of
    // it too. Left stale, the append-only `graded` event would stamp a
    // question a grown-up had just marked and the denominator would be short
    // by one — neither repairable in place afterwards.
    await submitAllBlank();
    await voidItem(VOIDED);
    const all = Object.fromEntries(PRINTED.map((id, i) => [id, i === 4 ? 'incorrect' : 'correct']));
    const result = await grade.execute({ sessionId: SID, verdicts: all, gradedBy: 'parent' });
    expect(result).toMatchObject({ status: 'graded', correct: 5, expected: 6, voidedItemIds: [] });
    const graded = sessions.events(SID).find((e) => e.type === 'graded');
    expect(graded).toMatchObject({ correctCount: 5, totalCount: 6 });
    expect(graded).not.toHaveProperty('voidedItemIds');
  });

  it('a void recorded EARLIER, in its own call, still leaves the denominator', async () => {
    // The queue is the durable verdict sheet: a void filed yesterday has to be
    // read back on a later grading call, not merely honoured in the act.
    await submitAllBlank();
    await voidItem(VOIDED);
    const rest = Object.fromEntries(PRINTED.slice(0, 5).map((id) => [id, 'correct']));
    const result = await grade.execute({ sessionId: SID, verdicts: rest, gradedBy: 'parent' });
    expect(result).toMatchObject({ status: 'graded', correct: 5, expected: 5, percent: 100 });
  });

  it('voiding EVERY question writes no graded event and does not throw', async () => {
    // `graded`'s own validator requires `totalCount >= 1`, so there is no
    // honest event to write. The session says so and waits for a grown-up to
    // settle it by hand rather than telling a child they scored zero.
    await submitAllBlank();
    for (const itemId of PRINTED) await voidItem(itemId); // eslint-disable-line no-await-in-loop
    const result = await grade.execute({ sessionId: SID });
    expect(result.status).toBe('unavailable');
    expect(result.message).toMatch(/none of them could be marked/);
    expect(sessions.types(SID)).not.toContain('graded');
    expect(sessions.derive(SID).state).toBe('submitted');
    // The verdicts themselves are still on record — the work of marking is
    // not thrown away just because it produced no score.
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === 'void')).toBe(true);
  });

  it('needs a grown-up to void, exactly as it does to mark', async () => {
    await submitAllBlank();
    const uc = new ResolveReviewItem({
      reviewQueue, grownUps: fakeGrownUps(clock), clock: clock.now, logger: silentLogger,
    });
    await expect(uc.execute({
      sessionId: SID, itemId: VOIDED, verdict: 'void', gradedBy: 'kid1', note: 'too hard',
    })).rejects.toBeInstanceOf(GuestForbiddenError);
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === null)).toBe(true);
  });

  it('the ENGINE never marks a question a person has already voided', async () => {
    // The row came back unreadable, so it went to a person; the person could
    // not mark it either. If a later call arrives carrying an answer for it —
    // a re-fed card, a retyped sheet — the grader must NOT overrule the
    // grown-up with a truth value they already said could not be established.
    await issued();
    await submit.execute({ sessionId: SID, entries: without([VOIDED]) });
    await grade.execute({ sessionId: SID, entries: without([VOIDED]) });
    await voidItem(VOIDED);
    const result = await grade.execute({ sessionId: SID, entries: RIGHT });
    expect(grader.attempts.map((a) => a.itemId)).not.toContain(VOIDED);
    expect(result).toMatchObject({ status: 'graded', correct: 5, expected: 5, percent: 100 });
  });
});

/**
 * A parent's verdict overrides the engine, so `gradedBy` is authority, not a
 * label. The route that carries it takes it from a request body — which is why
 * the roster check has to be here, in front of the write, and not in the UI that
 * happens to send the right id today.
 */
describe('who may mark a child\'s work', () => {
  const submitBlank = async () => {
    await issued();
    return submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
  };

  it('lets a grown-up mark', async () => {
    await submitBlank();
    const result = await grade.execute({
      sessionId: SID, verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])), gradedBy: 'parent',
    });
    expect(result).toMatchObject({ status: 'graded', percent: 100 });
  });

  it('REFUSES a verdict attributed to the child whose work it is', async () => {
    await submitBlank();
    await expect(grade.execute({ sessionId: SID, verdicts: { 'u3-q1': 'correct' }, gradedBy: 'kid1' }))
      .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === null)).toBe(true);
    expect(sessions.types(SID)).not.toContain('graded');
  });

  it('REFUSES an unknown marker, a birthyear-less one, and an anonymous one', async () => {
    await submitBlank();
    for (const gradedBy of ['mr-nobody', 'aunty', null]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(grade.execute({ sessionId: SID, verdicts: { 'u3-q1': 'correct' }, gradedBy }))
        .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    }
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === null)).toBe(true);
  });

  it('needs no identity when nothing but the ENGINE is marking', async () => {
    // A machine-scorable sheet coming back from the reader carries no person.
    await issued();
    await submit.execute({ sessionId: SID, entries: RIGHT });
    expect(await grade.execute({ sessionId: SID, entries: RIGHT })).toMatchObject({ status: 'graded', percent: 100 });
  });

  it('cannot be built without a grown-up gate', () => {
    expect(() => new GradeSubmission({ curriculum: {}, sessions, reviewQueue, grader, clock: clock.now }))
      .toThrow(/grownUps/);
  });
});

/**
 * PIN on the human grading lane (readiness punch 2). The grown-up rule STAYS —
 * it is the floor, not something the gate replaces — and a wired TeacherGate
 * adds the console PIN on top, ONLY when a person's verdicts are actually on
 * the call. `ResolveReviewItem`'s self-closing finisher calls
 * `execute({sessionId})` with no verdicts at all — already behind the gated
 * resolve — and that lane must never re-assert.
 */
describe('TeacherGate on the grading lane (readiness punch 2)', () => {
  const submitBlank = async () => {
    await issued();
    return submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
  };

  const withGate = (teacherGate) => new GradeSubmission({
    curriculum, sessions, reviewQueue, grader, bankReader: { getBank: (id) => BANKS[id] ?? null },
    grownUps: fakeGrownUps(clock), teacherGate, clock: clock.now, logger: silentLogger,
  });

  it('a refusing gate stops a human verdict and leaves the review queue untouched', async () => {
    await submitBlank();
    const teacherGate = { assert: vi.fn(() => { throw new GuestForbiddenError('The teacher PIN is missing or wrong.'); }) };
    const gated = withGate(teacherGate);
    await expect(gated.execute({
      sessionId: SID, verdicts: { 'u3-q1': 'correct' }, gradedBy: 'parent', pin: 'wrong',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(teacherGate.assert).toHaveBeenCalledWith({
      userId: 'parent', pin: 'wrong', action: 'sessions.grade', context: { sessionId: SID },
    });
    expect((await reviewQueue.listForSession(SID)).every((i) => i.verdict === null)).toBe(true);
    expect(sessions.types(SID)).not.toContain('graded');
  });

  it('with no gate wired, a pin is ignored and the legacy grown-up rule alone governs', async () => {
    await submitBlank();
    const result = await grade.execute({
      sessionId: SID,
      verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])),
      gradedBy: 'parent',
      pin: 'wrong',
    });
    expect(result).toMatchObject({ status: 'graded', percent: 100 });
  });

  it('a passing gate lets a grown-up\'s verdict through', async () => {
    await submitBlank();
    const teacherGate = { assert: vi.fn() };
    const gated = withGate(teacherGate);
    const result = await gated.execute({
      sessionId: SID,
      verdicts: Object.fromEntries(PRINTED.map((id) => [id, 'correct'])),
      gradedBy: 'parent',
      pin: 'right',
    });
    expect(result).toMatchObject({ status: 'graded', percent: 100 });
    expect(teacherGate.assert).toHaveBeenCalledTimes(1);
  });
});

/**
 * WHAT WAS ASKED, AND HOW TO MARK IT — two different things.
 *
 * Every review item used to carry the unit's whole-sheet rubric in a field
 * called `prompt`. A parent grading six questions read the same sentence six
 * times and could not tell which question they were marking. The question is on
 * the bank item (and, for a sheet with no bank, printed in the document); the
 * rubric is the unit's. Both belong on the item, under their own names.
 */
describe('a review item says which question it is', () => {
  it('carries the BANK item\'s own prompt, different on every question', async () => {
    await issued(OMR_UNIT);
    const result = await submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });

    const prompts = Object.fromEntries(result.review.map((i) => [i.itemId, i.prompt]));
    expect(prompts['u3-q1']).toBe(OMR_BANK.items.find((i) => i.id === 'u3-q1').prompt);
    expect(new Set(Object.values(prompts)).size).toBe(PRINTED.length);
  });

  it('carries the question NUMBER, which is how a parent finds it on the paper', async () => {
    await issued(OMR_UNIT);
    const result = await submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
    expect(result.review.map((i) => i.questionNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps the unit\'s marking rubric as its own field, not as the prompt', async () => {
    await issued(WORKSHEET_UNIT);
    const printed = questionItemIds(fixtureDocument(WORKSHEET_DOCUMENT_ID));
    const result = await submit.execute({ sessionId: SID, entries: {}, blank: printed });

    const rubric = fixtureUnit(WORKSHEET_UNIT).review.rubric;
    expect(result.review.every((i) => i.rubric === rubric)).toBe(true);
    // ...and the prompt is the PRINTED question, which differs per item.
    expect(result.review[0].prompt).toBe('Add. Write the result in simplest form.');
    expect(new Set(result.review.map((i) => i.prompt)).size).toBeGreaterThan(1);
  });

  it('falls back to the PRINTED question when the bank has no wording, and to nothing when neither does', async () => {
    await issued(OMR_UNIT);
    // A bank whose items carry no prompt at all — the sheet is then the only
    // place the question exists.
    BANKS[OMR_BANK_ID] = {
      ...fixtureBank(OMR_BANK_ID),
      items: OMR_BANK.items.map(({ prompt, ...rest }) => rest),
    };
    try {
      const result = await submit.execute({ sessionId: SID, entries: {}, blank: PRINTED });
      const prompts = Object.fromEntries(result.review.map((i) => [i.itemId, i.prompt]));
      // u3-q3 is printed with a stem; u3-q1 is a bare equation, so there is no
      // wording to show and nothing is invented.
      expect(prompts['u3-q3']).toBe('Which fraction is equivalent to the one below?');
      expect(prompts['u3-q1']).toBeNull();
      expect(result.review.every((i) => typeof i.questionNumber === 'number')).toBe(true);
    } finally {
      BANKS[OMR_BANK_ID] = OMR_BANK;
    }
  });

  it('puts the same two fields on a MACHINE mark, so the record reads the same later', async () => {
    await issued(OMR_UNIT);
    await submit.execute({ sessionId: SID, entries: RIGHT });
    await grade.execute({ sessionId: SID, entries: RIGHT });

    const queue = await reviewQueue.listForSession(SID);
    expect(queue).toHaveLength(PRINTED.length);
    expect(queue[0]).toMatchObject({
      reason: 'machine',
      prompt: OMR_BANK.items.find((i) => i.id === queue[0].itemId).prompt,
      questionNumber: 1,
    });
  });
});

/**
 * A print-document unit (spec §9, Task 7) has no `bank` at all — its answers
 * were never in a bank to begin with, only ever in the review queue the scan
 * bridge (`RecordCardScanOutcome`) fills. `questionItemIds(document)` cannot
 * derive the roster because there is no catalog `document` to walk (the ref
 * points at a print-time artefact, not a curriculum document), and the
 * bank-select expansion the printer performs is something no static walk can
 * reproduce anyway. So for THIS unit shape the review queue itself — every
 * machine-resolved mark plus every pending item the scan enqueued — is the
 * roster.
 */
describe('GradeSubmission on a print-document unit', () => {
  const PRINT_DOCUMENT_REF = 'print/science/biology/quiz-1@abcdef123';

  /** A fresh curriculum/session/queue/grade set, isolated from the shared beforeEach. */
  const buildPrintCase = ({ teacherGate = null } = {}) => {
    const clock = fakeClock();
    const catalog = new FakeCatalog({
      units: rawUnits({ [OMR_UNIT]: { document: PRINT_DOCUMENT_REF, bank: undefined } }),
      documents: rawDocuments(),
      manifests: rawManifests(),
    });
    curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
    const printSessions = new FakeSessionRepository();
    const printReviewQueue = new FakeReviewQueue();
    const printGrader = new FakeGrader(BANKS);
    const bankReader = { getBank: (id) => BANKS[id] ?? null };
    const printGrade = new GradeSubmission({
      curriculum, sessions: printSessions, reviewQueue: printReviewQueue, grader: printGrader, bankReader,
      grownUps: fakeGrownUps(clock), teacherGate, clock: clock.now, logger: silentLogger,
    });
    return {
      clock, sessions: printSessions, reviewQueue: printReviewQueue, grade: printGrade,
    };
  };

  const submittedAt = async (sessions, clock) => {
    await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: OMR_UNIT });
    await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'card-1' });
    await sessions.appendEvent(SID, { type: 'submitted', at: clock.iso(), sessionId: SID, transport: 'paper' });
  };

  /** Two machine-resolved marks and one pending free-response item — exactly
   * what `RecordCardScanOutcome`'s review-queue bridge enqueues for a
   * complete-but-unfinished card. */
  const seedMachineMarks = (reviewQueue, at) => reviewQueue.enqueue([
    {
      sessionId: SID, itemId: 'q1', learnerId: 'kid1', unitId: OMR_UNIT, reason: 'machine', given: 'blue',
      prompt: 'P1', questionNumber: 1, rubric: null, enqueuedAt: at,
      verdict: 'correct', gradedBy: 'engine', gradedAt: at, attemptId: 'att-1',
    },
    {
      sessionId: SID, itemId: 'q2', learnerId: 'kid1', unitId: OMR_UNIT, reason: 'machine', given: 'fox',
      prompt: 'P2', questionNumber: 2, rubric: null, enqueuedAt: at,
      verdict: 'incorrect', gradedBy: 'engine', gradedAt: at, attemptId: 'att-2',
    },
  ]);

  const seedPendingEssay = (reviewQueue, at) => reviewQueue.enqueue([{
    sessionId: SID, itemId: 'w-essay', learnerId: 'kid1', unitId: OMR_UNIT, reason: 'free_response', given: null,
    prompt: 'Explain.', questionNumber: null, rubric: null, enqueuedAt: at,
  }]);

  it('grades from the review-queue roster once every verdict is in', async () => {
    const { clock, sessions, reviewQueue, grade } = buildPrintCase();
    await submittedAt(sessions, clock);
    const at = clock.iso();
    await seedMachineMarks(reviewQueue, at);
    await seedPendingEssay(reviewQueue, at);
    await reviewQueue.resolve({ sessionId: SID, itemId: 'w-essay', verdict: 'correct', gradedBy: 'dad', at });

    const result = await grade.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'graded', correct: 2, expected: 3 });
    expect(result.percent).toBeCloseTo(66.67, 2);
    expect(sessions.derive(SID)).toMatchObject({ state: 'graded' });
    const queueItemIds = (await reviewQueue.listForSession(SID)).map((i) => i.itemId);
    expect(new Set(queueItemIds)).toEqual(new Set(['q1', 'q2', 'w-essay']));

    // F3 (re-review wave 2): the graded event must carry the GENUINE scan
    // attempt ids the queue items own (`att-1`/`att-2`, seeded by
    // `seedMachineMarks`) — not the synthetic `review:<sessionId>` pointer,
    // which would discard them. `w-essay` was resolved by a parent with no
    // attemptId of its own, so it contributes nothing to the set.
    expect(result.attemptIds).toEqual(['att-1', 'att-2']);
    const gradedEvent = (await sessions.readEvents(SID)).find((e) => e.type === 'graded');
    expect(gradedEvent.attemptIds).toEqual(['att-1', 'att-2']);
  });

  it('holds at awaiting_review while any queued item still has no verdict', async () => {
    const { clock, sessions, reviewQueue, grade } = buildPrintCase();
    await submittedAt(sessions, clock);
    const at = clock.iso();
    await seedMachineMarks(reviewQueue, at);
    await seedPendingEssay(reviewQueue, at); // left unresolved

    const result = await grade.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'awaiting_review', outstanding: ['w-essay'] });
    expect(sessions.types(SID)).not.toContain('graded');
  });

  // Readiness punch 2: this is the EXACT call shape `ResolveReviewItem`'s
  // self-closing finisher makes on itself (`execute({sessionId})`, no
  // verdicts) — it must never reach a wired gate, on a print-document unit or
  // any other.
  it('the self-closing finisher call — execute({sessionId}) alone — never reaches a wired gate', async () => {
    const teacherGate = { assert: vi.fn(() => { throw new GuestForbiddenError('nope'); }) };
    const { clock, sessions, reviewQueue, grade } = buildPrintCase({ teacherGate });
    await submittedAt(sessions, clock);
    const at = clock.iso();
    await seedMachineMarks(reviewQueue, at);
    await seedPendingEssay(reviewQueue, at);
    await reviewQueue.resolve({ sessionId: SID, itemId: 'w-essay', verdict: 'correct', gradedBy: 'dad', at });

    const result = await grade.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'graded' });
    expect(teacherGate.assert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The producer and the consumer of the graded event's counts, joined.
//
// `CloseSessionOutcome` renders `correctCount`/`totalCount` onto the printed
// result receipt, but it can only read them off the session state, which
// `reduceSession` fills from the graded event. Grading a sheet and closing it
// are tested apart everywhere else — which is exactly how `GradeSubmission`
// went for so long emitting no counts at all while `closeOutcome.test.mjs`
// went on passing, because it hand-writes its own graded events. This drives
// the real grader into the real close.
// ---------------------------------------------------------------------------

describe('the result receipt counts what GradeSubmission marked', () => {
  it('says "3 of 6", not nulls, for a screen/paper-marked session', async () => {
    const { CloseSessionOutcome } = await import('#apps/school/usecases/CloseSessionOutcome.mjs');
    const { ReceiptPrinting } = await import('#apps/school/ReceiptPrinting.mjs');
    const {
      FakeTokenRegistry, FakeAssignmentStore, FakeEconomy,
      FakeReceiptPrinter, FakeReceiptRenderer, seededRng,
    } = await import('#testlib/school/lifecycleFakes.mjs');

    const missed = someWrong(['u3-q4', 'u3-q5', 'u3-q6']);
    await issued();
    await submit.execute({ sessionId: SID, entries: missed });
    const marked = await grade.execute({ sessionId: SID, entries: missed });
    expect(marked).toMatchObject({ status: 'graded', correct: 3, expected: 6 });

    const close = new CloseSessionOutcome({
      curriculum,
      sessions,
      tokens: new FakeTokenRegistry(),
      assignments: new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]),
      economy: new FakeEconomy(),
      economyEnabled: false,
      receipts: new ReceiptPrinting({
        renderer: new FakeReceiptRenderer(), printer: new FakeReceiptPrinter(), logger: silentLogger,
      }),
      grownUps: fakeGrownUps(clock),
      reviewQueue,
      clock: clock.now,
      rng: seededRng(5),
      logger: silentLogger,
    });

    const { document } = await close.execute({ sessionId: SID });
    // The renderers key off BOTH being integers — `DocumentEscPosRenderer`
    // prints "3 of 6 correct" and a per-question tick row only then, and
    // drops the line entirely when either is null.
    expect(document.blocks.find((block) => block.type === 'result_summary'))
      .toMatchObject({ correctCount: 3, totalCount: PRINTED.length });
  });
});
