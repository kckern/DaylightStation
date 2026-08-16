/**
 * The frozen roster: an INSTANCE is marked against its own snapshot, never
 * against the class it was drawn from.
 *
 * A unit that declares a `bank` and no `document` is a worksheet-instance unit:
 * at issue time a subset of the live bank is sampled, frozen onto the sheet the
 * child physically receives, and written down as `itemIds` on the instance. The
 * bank keeps growing afterwards — that is the point of a bank.
 *
 * Grading therefore has exactly one legitimate denominator: what the sheet
 * asked. Reading the LIVE bank back at grading time makes a perfect ten-question
 * paper score ten out of twenty, and parks the ten questions that were never
 * printed on a grown-up's to-do list forever — they cannot be marked, because
 * they were never asked.
 *
 * The fallback below matters just as much: a session with no instance (an older
 * screen-path hand-in that never minted one) must keep marking against the bank
 * exactly as it always did.
 */
import { describe, it, expect } from 'vitest';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeFormMapStore, FakeReviewQueue,
  fakeClock, fakeGrownUps, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_BANK_ID, MEDIA_UNIT,
} from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_ws';

/**
 * The CLASS: a live bank of twenty. `math-fractions.01` is the fixture unit
 * shaped like the real `atlas-us-p006-united-states` — `bank:` and no
 * `document:` — so the only thing swapped out here is how many items the bank
 * holds, which is exactly the variable under test.
 */
const BANK = {
  id: MEDIA_BANK_ID,
  title: 'Twenty questions',
  subject: 'math',
  items: Array.from({ length: 20 }, (unused, index) => {
    const n = index + 1;
    return {
      id: `b-q${n}`,
      type: 'multiple_choice',
      prompt: `Question ${n}?`,
      choices: [`right-${n}`, `wrong-${n}-a`, `wrong-${n}-b`, `wrong-${n}-c`],
      answer: `right-${n}`,
    };
  }),
};
const ALL_IDS = BANK.items.map((item) => item.id);
const ANSWER = Object.fromEntries(BANK.items.map((item) => [item.id, item.answer]));
const WRONG = Object.fromEntries(BANK.items.map((item) => [item.id, item.choices[1]]));

/** Answers for a set of items: all right, or the named few wrong. */
const answers = (ids, wrong = []) => Object.fromEntries(
  ids.map((id) => [id, wrong.includes(id) ? WRONG[id] : ANSWER[id]]),
);

/** The ten the sampler actually put on the sheet — scattered, as a real draw is. */
const SAMPLED = Object.freeze(['b-q17', 'b-q3', 'b-q11', 'b-q1', 'b-q20', 'b-q8', 'b-q14', 'b-q5', 'b-q19', 'b-q9']);
/** The ten the child never saw. Nobody can ever mark these. */
const NEVER_PRINTED = ALL_IDS.filter((id) => !SAMPLED.includes(id));
/** A remediation reprint: fewer still. */
const REMEDIATION = Object.freeze(['b-q3', 'b-q14', 'b-q19']);

/** The instance as `createWorksheetInstance` freezes it: `itemIds` + `questions`. */
const instanceFor = (itemIds) => ({
  schema: 'school.worksheet-instance/v1',
  id: `math/math-fractions/ws-${SID}`,
  sessionId: SID,
  issuedAt: '2026-07-27T09:00:00.000Z',
  learnerId: 'kid1',
  enrollmentId: 'enr_1',
  lessonId: MEDIA_UNIT,
  profile: 'lower',
  bankId: MEDIA_BANK_ID,
  bankRevision: 'r1',
  seed: `${SID}:0`,
  itemIds: [...itemIds],
  questions: itemIds.map((itemId) => ({
    itemId, type: 'multiple_choice', prompt: `Question ${itemId}`, source: null, options: [],
  })),
});

/** Marks by exact match against the bank — all the real engine does for MC. */
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

/**
 * @param {object|null|undefined} instance - the frozen sheet; `null` for a
 *   session that never minted one, `undefined` to leave the dependency
 *   unwired altogether (a pre-worksheet-instance install).
 */
async function build(instance) {
  const clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  const sessions = new FakeSessionRepository();
  const reviewQueue = new FakeReviewQueue();
  const grader = new FakeGrader();
  const bankReader = { getBank: (id) => (id === BANK.id ? BANK : null) };
  const worksheetInstances = instance === undefined ? undefined : {
    async findBySession(sessionId) {
      return instance && instance.sessionId === sessionId ? instance : null;
    },
  };

  const submit = new SubmitPaperWork({
    curriculum, sessions, formMaps: new FakeFormMapStore(), reviewQueue, bankReader,
    worksheetInstances, clock: clock.now, logger: silentLogger,
  });
  const grade = new GradeSubmission({
    curriculum, sessions, reviewQueue, grader, bankReader, worksheetInstances,
    grownUps: fakeGrownUps(clock), clock: clock.now, logger: silentLogger,
  });

  await sessions.appendEvent(SID, {
    type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: MEDIA_UNIT,
  });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });

  return { clock, sessions, reviewQueue, grader, submit, grade };
}

describe('an issued worksheet is marked out of what it asked', () => {
  it('scores a perfect ten-question sheet 100%, not 50% of a twenty-item bank', async () => {
    const { submit, grade } = await build(instanceFor(SAMPLED));
    await submit.execute({ sessionId: SID, entries: answers(SAMPLED) });

    const result = await grade.execute({ sessionId: SID, entries: answers(SAMPLED) });

    expect(result).toMatchObject({
      status: 'graded', percent: 100, correct: 10, expected: 10, outstanding: [],
    });
  });

  it('never leaves a question that was never printed on a grown-up\'s list', async () => {
    const { submit, grade, reviewQueue } = await build(instanceFor(SAMPLED));
    await submit.execute({ sessionId: SID, entries: answers(SAMPLED, ['b-q3', 'b-q19']) });

    const result = await grade.execute({ sessionId: SID, entries: answers(SAMPLED, ['b-q3', 'b-q19']) });

    expect(result).toMatchObject({ status: 'graded', percent: 80, correct: 8, expected: 10 });
    expect(result.outstanding).toEqual([]);
    const queued = (await reviewQueue.listForSession(SID)).map((item) => item.itemId);
    expect(queued.filter((id) => NEVER_PRINTED.includes(id))).toEqual([]);
  });

  it('hands in ten without inventing ten blank ones for a grown-up to mark', async () => {
    const { submit, reviewQueue } = await build(instanceFor(SAMPLED));

    const handIn = await submit.execute({ sessionId: SID, entries: answers(SAMPLED) });

    expect(handIn.status).toBe('submitted');
    expect(handIn.expectedItems).toEqual([...SAMPLED]);
    expect(handIn.review).toEqual([]);
    expect(await reviewQueue.listForSession(SID)).toEqual([]);
  });

  it('marks a REMEDIATION reprint out of the three it reprinted', async () => {
    const { submit, grade } = await build(instanceFor(REMEDIATION));
    await submit.execute({ sessionId: SID, entries: answers(REMEDIATION) });

    const result = await grade.execute({ sessionId: SID, entries: answers(REMEDIATION) });

    expect(result).toMatchObject({ status: 'graded', percent: 100, correct: 3, expected: 3 });
  });

  it('takes the roster from `questions` when an instance carries no `itemIds`', async () => {
    const { itemIds, ...withoutItemIds } = instanceFor(SAMPLED);
    const { submit, grade } = await build(withoutItemIds);
    await submit.execute({ sessionId: SID, entries: answers(SAMPLED) });

    const result = await grade.execute({ sessionId: SID, entries: answers(SAMPLED) });

    expect(result).toMatchObject({ status: 'graded', percent: 100, expected: 10 });
  });

  it('falls back to the bank rather than dead-ending when an instance names nothing', async () => {
    // A roster of zero is a corrupt instance, not a sheet with no questions —
    // answering "there is nothing to mark" would strand the session for good.
    const { submit, grade } = await build({ ...instanceFor(SAMPLED), itemIds: [], questions: [] });
    await submit.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    const result = await grade.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    expect(result).toMatchObject({ status: 'graded', percent: 100, expected: 20 });
  });
});

describe('a session with no instance keeps its old behaviour exactly', () => {
  it('marks the whole bank when nothing was ever frozen', async () => {
    const { submit, grade } = await build(null);
    await submit.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    const result = await grade.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    expect(result).toMatchObject({ status: 'graded', percent: 100, correct: 20, expected: 20 });
  });

  it('still waits on a grown-up for the bank items no answer came back for', async () => {
    const { submit, grade } = await build(null);
    const handIn = await submit.execute({ sessionId: SID, entries: answers(SAMPLED) });
    expect(handIn.expectedItems).toEqual(ALL_IDS);
    expect(handIn.review.map((item) => item.itemId).sort()).toEqual([...NEVER_PRINTED].sort());

    const result = await grade.execute({ sessionId: SID, entries: answers(SAMPLED) });

    expect(result).toMatchObject({ status: 'awaiting_review', percent: null, correct: 10, expected: 20 });
    expect([...result.outstanding].sort()).toEqual([...NEVER_PRINTED].sort());
  });

  it('behaves identically when the store is not wired at all', async () => {
    const { submit, grade } = await build(undefined);
    await submit.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    const result = await grade.execute({ sessionId: SID, entries: answers(ALL_IDS) });

    expect(result).toMatchObject({ status: 'graded', percent: 100, correct: 20, expected: 20 });
  });
});
