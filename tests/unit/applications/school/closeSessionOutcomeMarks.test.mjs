/**
 * CloseSessionOutcome threads per-question marks onto the result receipt
 * (regression, 2026-08-22): a real child's paper missed question 7 of a
 * 12-question sheet — the FIRST question — and the printed receipt's
 * numbered boxes blamed 11 and 12 instead, because the renderer used to fill
 * boxes left-to-right by `correctCount` rather than reading each box's own
 * result.
 *
 * Per-question correctness DOES exist upstream (the card scan's own
 * `results` row-by-row, surfaced here as `missedItemIds` on the `graded`
 * event) and the worksheet instance carries the printed question ORDER
 * (`questions[].itemId`, in the same order `questionStart + index` numbers
 * the boxes). This suite proves `CloseSessionOutcome` cross-references the
 * two into a `marks` array on the result document — the thing `DocumentReceiptRenderer`
 * now reads instead of guessing positionally.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore,
  fakeClock, fakeGrownUps, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT } from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_1';

let clock, sessions, close;

/** A worksheet-instance double: six questions, printed order q1..q6. */
function fakeWorksheetInstances(instance) {
  return { findBySession: async (sessionId) => (sessionId === SID ? instance : null) };
}

const SIX_QUESTIONS = Object.freeze(
  Array.from({ length: 6 }, (_, i) => Object.freeze({ itemId: `q${i + 1}`, source: { page: 'p. 4', zone: `4.${i + 1}` } })),
);

const build = ({ worksheetInstances = null } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  const tokens = new FakeTokenRegistry();
  const assignments = new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]);
  close = new CloseSessionOutcome({
    curriculum, sessions, tokens, assignments,
    grownUps: fakeGrownUps(clock),
    worksheetInstances,
    clock: clock.now, rng: seededRng(5), logger: silentLogger,
  });
};

/** Drive a session to `graded` with the given per-item evidence. */
const graded = async ({
  correctCount, totalCount, missedItemIds, questionStart = 1,
} = {}) => {
  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
  await sessions.appendEvent(SID, { type: 'submitted', at: clock.iso(), sessionId: SID, transport: 'paper' });
  await sessions.appendEvent(SID, {
    type: 'graded', at: clock.iso(), sessionId: SID, attemptIds: ['att_1'], percent: Math.round((correctCount / totalCount) * 100),
    correctCount, totalCount, missedItemIds,
  });
  return questionStart;
};

beforeEach(() => build());

describe('marks: reachable per-question evidence is threaded onto the document', () => {
  it('marks the FIRST question wrong when it — and only it — was missed (not the last)', async () => {
    build({
      worksheetInstances: fakeWorksheetInstances({
        questions: SIX_QUESTIONS,
        omr: { cardId: 'card_1', recordId: 'rec_1', rowRange: { start: 1 } },
      }),
    });
    await graded({ correctCount: 5, totalCount: 6, missedItemIds: ['q1'] });
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((b) => b.type === 'result_summary');
    expect(summary).toMatchObject({ correctCount: 5, totalCount: 6, questionStart: 1 });
    // The positional bug (`index < correctCount`) would have produced
    // [true, true, true, true, true, false] here — blaming question 6.
    expect(summary.marks).toEqual([false, true, true, true, true, true]);
  });

  it('marks a MIDDLE question wrong — a shape positional fill can never produce for a single miss', async () => {
    build({
      worksheetInstances: fakeWorksheetInstances({
        questions: SIX_QUESTIONS,
        omr: { cardId: 'card_1', recordId: 'rec_1', rowRange: { start: 1 } },
      }),
    });
    await graded({ correctCount: 5, totalCount: 6, missedItemIds: ['q4'] });
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((b) => b.type === 'result_summary');
    expect(summary.marks).toEqual([true, true, true, false, true, true]);
  });

  it('marks every box correct on a clean sheet', async () => {
    build({
      worksheetInstances: fakeWorksheetInstances({
        questions: SIX_QUESTIONS,
        omr: { cardId: 'card_1', recordId: 'rec_1', rowRange: { start: 1 } },
      }),
    });
    await graded({ correctCount: 6, totalCount: 6, missedItemIds: [] });
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((b) => b.type === 'result_summary');
    expect(summary.marks).toEqual([true, true, true, true, true, true]);
  });

  it('prints the physical-book remediation reference for a missed original question', async () => {
    const questions = SIX_QUESTIONS.map((question, index) => (index === 0 ? {
      ...question,
      reviewReference: { title: 'Beast Academy 2A Guide', pages: [24, 25, 26, 27], section: 'Ones, Tens, Hundreds' },
    } : question));
    build({
      worksheetInstances: fakeWorksheetInstances({
        questions, omr: { cardId: 'card_1', recordId: 'rec_1', rowRange: { start: 1 } },
      }),
    });
    await graded({ correctCount: 5, totalCount: 6, missedItemIds: ['q1'] });
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((block) => block.type === 'result_summary');
    expect(summary.reviewHints).toEqual([
      '1: review Beast Academy 2A Guide, pages 24–27 · Ones, Tens, Hundreds.',
    ]);
  });
});

describe('marks: unreachable per-question evidence is never faked', () => {
  it('omits marks when no worksheet instance is wired at all', async () => {
    build({ worksheetInstances: null });
    await graded({ correctCount: 5, totalCount: 6, missedItemIds: ['q1'] });
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((b) => b.type === 'result_summary');
    expect(summary.marks).toBeUndefined();
  });

  it('omits marks when the worksheet roster length disagrees with the graded totalCount, rather than mis-index it', async () => {
    build({
      worksheetInstances: fakeWorksheetInstances({
        questions: SIX_QUESTIONS, // 6 questions on file
        omr: { cardId: 'card_1', recordId: 'rec_1', rowRange: { start: 1 } },
      }),
    });
    await graded({ correctCount: 4, totalCount: 5, missedItemIds: ['q1'] }); // but graded against 5
    const result = await close.execute({ sessionId: SID });
    const summary = result.document.blocks.find((b) => b.type === 'result_summary');
    expect(summary.marks).toBeUndefined();
  });
});
