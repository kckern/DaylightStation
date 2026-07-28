import { describe, it, expect, beforeEach } from 'vitest';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeFormMapStore, FakeReviewQueue,
  fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, omrFormMap, omrBank,
  WORKSHEET_UNIT, OMR_UNIT,
} from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_1';

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

  answer({ sessionId, itemId, given, transport }) {
    const bank = Object.values(this.banks).find((b) => b.items.some((i) => i.id === itemId));
    const item = bank.items.find((i) => i.id === itemId);
    const correct = item.answer === given;
    const attemptId = `att_${this.attempts.length + 1}`;
    this.attempts.push({ id: attemptId, sessionId, itemId, given, correct, mode: 'quiz', transport });
    return { correct, expected: item.answer, attemptId };
  }
}

let clock, sessions, formMaps, reviewQueue, grader, submit, grade;

const BANKS = {
  'fractions-03-bank': omrBank(),
  'fractions-01-quiz': { id: 'fractions-01-quiz', items: [{ id: 'q1', type: 'multiple_choice', answer: 'A' }] },
};

const build = () => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  formMaps = new FakeFormMapStore();
  reviewQueue = new FakeReviewQueue();
  grader = new FakeGrader(BANKS);
  const bankReader = { getBank: (id) => BANKS[id] ?? null };
  submit = new SubmitPaperWork({ curriculum, sessions, formMaps, reviewQueue, bankReader, clock: clock.now, logger: silentLogger });
  grade = new GradeSubmission({ curriculum, sessions, reviewQueue, grader, bankReader, clock: clock.now, logger: silentLogger });
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
    const result = await submit.execute({ sessionId: SID, entries: { q1: 'C', q2: 'B' } });
    expect(result).toMatchObject({ status: 'submitted', expectedItems: ['q1', 'q2'], review: [] });
    expect(result.scorable).toEqual({ q1: 'C', q2: 'B' });
    expect(sessions.types(SID)).toEqual(['created', 'issued', 'submitted']);
    expect(sessions.derive(SID).transport).toBe('paper');
  });

  it('sends an AMBIGUOUS row to a person instead of guessing', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: { q1: 'C' }, ambiguous: ['q2'] });
    expect(result.scorable).toEqual({ q1: 'C' });
    expect(result.review).toEqual([expect.objectContaining({ itemId: 'q2', reason: 'ambiguous' })]);
    expect(await reviewQueue.listForSession(SID)).toHaveLength(1);
  });

  it('sends a BLANK row to a person rather than marking it wrong', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: { q1: 'C' }, blank: ['q2'] });
    expect(result.review[0]).toMatchObject({ itemId: 'q2', reason: 'blank' });
  });

  it('treats a missing answer as blank — the sheet is out of what it printed', async () => {
    await issued();
    const result = await submit.execute({ sessionId: SID, entries: { q1: 'C' } });
    expect(result.expectedItems).toEqual(['q1', 'q2']);
    expect(result.review[0]).toMatchObject({ itemId: 'q2', reason: 'blank' });
  });

  it('sends free-response work to a person — no bank means nothing to compare', async () => {
    await issued(WORKSHEET_UNIT);
    const result = await submit.execute({ sessionId: SID, entries: { q1: '11/12', q2: '7/12' } });
    expect(result.scorable).toEqual({});
    expect(result.review.map((r) => r.reason)).toEqual(['free_response', 'free_response']);
    expect(result.review[0].prompt).toContain('Mark each');
  });

  it('carries the learner and unit into the queue so a parent knows whose work it is', async () => {
    await issued();
    await submit.execute({ sessionId: SID, entries: {}, blank: ['q1', 'q2'] });
    expect((await reviewQueue.listPending())[0]).toMatchObject({ learnerId: 'kid1', unitId: OMR_UNIT });
  });
});

describe('SubmitPaperWork refusals', () => {
  it('rejects a DUPLICATE submission and points at the existing result', async () => {
    await issued();
    await submit.execute({ sessionId: SID, entries: { q1: 'C', q2: 'B' } });
    const second = await submit.execute({ sessionId: SID, entries: { q1: 'A', q2: 'A' } });
    expect(second.status).toBe('duplicate');
    expect(second.pointsAt).toMatchObject({ state: 'submitted' });
    expect(sessions.types(SID)).toEqual(['created', 'issued', 'submitted']);
  });

  it('refuses work that was never printed', async () => {
    await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: OMR_UNIT });
    expect(await submit.execute({ sessionId: SID, entries: { q1: 'C' } })).toMatchObject({ status: 'unavailable' });
  });

  it('explains an unknown session', async () => {
    expect(await submit.execute({ sessionId: 'ses_nope' })).toMatchObject({ status: 'unavailable' });
  });
});

describe('SubmitPaperWork from a bubble sheet', () => {
  const reader = new VirtualOmrReader({ logger: silentLogger });

  it('reads the real form map the printer produced', async () => {
    const artifactId = await issued();
    await formMaps.put(artifactId, omrFormMap());
    const sheet = reader.scanSheet({ formMap: omrFormMap(), chosen: { q1: 'C', q2: 'B' } });
    const result = await submit.fromOmrSheet({ sessionId: SID, sheet });
    expect(result.scorable).toEqual({ q1: 'C', q2: 'B' });
  });

  it('routes a smudged row to review', async () => {
    const artifactId = await issued();
    await formMaps.put(artifactId, omrFormMap());
    const sheet = reader.scanSheet({ formMap: omrFormMap(), chosen: { q1: 'C' }, ambiguous: ['q2'] });
    const result = await submit.fromOmrSheet({ sessionId: SID, sheet });
    expect(result.review).toEqual([expect.objectContaining({ itemId: 'q2', reason: 'ambiguous' })]);
  });

  it('refuses a sheet with no stored form map rather than scoring blind', async () => {
    await issued();
    const sheet = reader.scanSheet({ formMap: omrFormMap(), chosen: { q1: 'C' } });
    expect(await submit.fromOmrSheet({ sessionId: SID, sheet })).toMatchObject({ status: 'unavailable' });
    expect(sessions.types(SID)).toEqual(['created', 'issued']);
  });

  it('refuses a sheet that does not match the form it claims', async () => {
    const artifactId = await issued();
    await formMaps.put(artifactId, omrFormMap());
    expect(await submit.fromOmrSheet({ sessionId: SID, sheet: { marks: [1, 2, 3, 4] } })).toMatchObject({ status: 'unavailable' });
  });
});

describe('GradeSubmission through the one engine', () => {
  const submitAll = async (entries, extra = {}) => {
    await issued();
    return submit.execute({ sessionId: SID, entries, ...extra });
  };

  it('produces normal quiz attempts carrying transport: paper', async () => {
    await submitAll({ q1: 'C', q2: 'B' });
    const result = await grade.execute({ sessionId: SID, entries: { q1: 'C', q2: 'B' } });
    expect(result).toMatchObject({ status: 'graded', percent: 100, correct: 2, expected: 2 });
    expect(grader.attempts.every((a) => a.transport === 'paper' && a.mode === 'quiz')).toBe(true);
  });

  it('scores out of what the sheet printed, not out of what came back', async () => {
    await submitAll({ q1: 'C' });
    const result = await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    // q2 came back blank, so it is outstanding — NOT counted wrong out of one.
    expect(result).toMatchObject({ status: 'awaiting_review', correct: 1, expected: 2, outstanding: ['q2'] });
    expect(sessions.types(SID)).not.toContain('graded');
  });

  it('records the grade only when every question has a verdict', async () => {
    await submitAll({ q1: 'C' });
    await grade.execute({ sessionId: SID, entries: { q1: 'C' } });
    const finished = await grade.execute({ sessionId: SID, verdicts: { q2: 'correct' }, gradedBy: 'parent' });
    expect(finished).toMatchObject({ status: 'graded', percent: 100 });
    expect(sessions.derive(SID)).toMatchObject({ state: 'graded', gradedPercent: 100 });
  });

  it('keeps a parent verdict in the review queue, NOT in the attempt log', async () => {
    await submitAll({}, { blank: ['q1', 'q2'] });
    await grade.execute({ sessionId: SID, verdicts: { q1: 'correct', q2: 'incorrect' }, gradedBy: 'parent' });
    expect(grader.attempts).toEqual([]);
    const queue = await reviewQueue.listForSession(SID);
    expect(queue.map((i) => [i.itemId, i.verdict, i.gradedBy])).toEqual([['q1', 'correct', 'parent'], ['q2', 'incorrect', 'parent']]);
  });

  it('points a wholly parent-marked sheet at its own session for evidence', async () => {
    await submitAll({}, { blank: ['q1', 'q2'] });
    const result = await grade.execute({ sessionId: SID, verdicts: { q1: 'correct', q2: 'correct' }, gradedBy: 'parent' });
    expect(result.attemptIds).toEqual([`review:${SID}`]);
  });

  it('marks a wrong answer wrong', async () => {
    await submitAll({ q1: 'A', q2: 'B' });
    expect(await grade.execute({ sessionId: SID, entries: { q1: 'A', q2: 'B' } }))
      .toMatchObject({ status: 'graded', percent: 50, correct: 1 });
  });

  it('rejects a second marking and points at the first result', async () => {
    await submitAll({ q1: 'C', q2: 'B' });
    await grade.execute({ sessionId: SID, entries: { q1: 'C', q2: 'B' } });
    const second = await grade.execute({ sessionId: SID, entries: { q1: 'A', q2: 'A' } });
    expect(second).toMatchObject({ status: 'duplicate', percent: 100 });
    expect(sessions.types(SID).filter((t) => t === 'graded')).toHaveLength(1);
  });

  it('refuses to mark work that was never handed in', async () => {
    await issued();
    expect(await grade.execute({ sessionId: SID, entries: { q1: 'C' } })).toMatchObject({ status: 'unavailable' });
  });

  it('opens exactly one quiz session for a whole sheet', async () => {
    await submitAll({ q1: 'C', q2: 'B' });
    await grade.execute({ sessionId: SID, entries: { q1: 'C', q2: 'B' } });
    expect(grader.sessions).toBe(1);
  });
});
