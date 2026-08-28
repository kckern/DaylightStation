/**
 * A SHEET SENT TO REVIEW STILL OWES ITS FINISH CODE (Task 11, part A).
 *
 * Task 10 put the gate verdict on the `graded` event. That is the right place
 * for a sheet the scanner can mark end to end — and it is the ONLY place, which
 * left a hole wide enough to drive the whole feature through:
 *
 *   `RecordCardScanOutcome#bridgeSession` returns at `awaiting-review` — one
 *   double-bubbled question, one write-on — BEFORE it writes any `graded`
 *   event. `GradeSubmission` writes its own `graded` later, from the verdict
 *   sheet, and it has never heard of a finish-code row. So the gate verdict
 *   the scanner read was never recorded anywhere, and `CloseSessionOutcome`
 *   closed the sheet with nothing to veto it.
 *
 * One ambiguous bubble was therefore enough to pass a sheet whose read-along
 * was never played. This suite drives the real review lane — scan bridge,
 * grown-up's verdict through the real `GradeSubmission`, close — and asserts
 * the verdict survives all three.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore,
  fakeClock, fakeGrownUps, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT } from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_review_1';

/**
 * The worksheet unit as a PRINT unit with a required companion. `document`
 * has to be a `print/<id>@<rev>` ref or `GradeSubmission` will not read the
 * review queue as the sheet's roster — which is exactly the lane under test.
 */
const GATED_PRINT_UNIT = {
  document: 'print/gated-sheet@abcdef123',
  companion: { participation: 'required', label: 'Read Along' },
  reading: 'Psalm 70',
};

let clock, sessions, reviewQueue, record, grade, close;

function fakeDatastore() {
  const byLearner = new Map();
  return {
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) { return structuredClone(byLearner.get(learnerId) ?? []); },
  };
}

function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
    async resolve({ sessionId, itemId, verdict, gradedBy, at }) {
      const row = items.find((i) => i.sessionId === sessionId && i.itemId === itemId);
      if (!row) return null;
      Object.assign(row, { verdict, gradedBy, gradedAt: at });
      return structuredClone(row);
    },
  };
}

const build = ({ gated = true } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({
    units: rawUnits({
      [WORKSHEET_UNIT]: gated
        ? GATED_PRINT_UNIT
        : { document: GATED_PRINT_UNIT.document },
    }),
    documents: rawDocuments(),
    manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  reviewQueue = fakeReviewQueue();
  record = new RecordCardScanOutcome({
    datastore: fakeDatastore(), sessions, reviewQueue, clock: clock.now, logger: silentLogger,
  });
  grade = new GradeSubmission({
    curriculum, sessions, reviewQueue,
    grader: { openSession: () => ({ sessionId: 'q1' }), answer: () => ({ correct: true }) },
    grownUps: { assert: () => {} },
    clock: clock.now, logger: silentLogger,
  });
  close = new CloseSessionOutcome({
    curriculum,
    sessions,
    tokens: new FakeTokenRegistry(),
    assignments: new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]),
    grownUps: fakeGrownUps(clock),
    clock: clock.now,
    rng: seededRng(5),
    logger: silentLogger,
  });
};

/**
 * One scanned card: question 1 read cleanly, question 2 double-bubbled — the
 * ambiguous row is what routes this sheet to a grown-up instead of to `graded`.
 */
const card = ({ companionGate } = {}) => ({
  cardId: '7654321',
  recordId: 'math/gated@abcdef123:v0:1-3',
  documentId: 'math/gated',
  rev: 'abcdef123',
  variant: 0,
  learnerId: 'kid1',
  sessionId: SID,
  renderedAt: '2026-07-27T00:00:00.000Z',
  results: [
    { row: 2, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'A', points: 1, earned: 1, concepts: [] },
    { row: 3, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0, concepts: [] },
  ],
  totalPoints: 2,
  earnedPoints: 1,
  unscannedItems: [],
  ...(companionGate
    ? { companionGate: { itemId: COMPANION_GATE_ITEM_ID, row: 1, ...companionGate } }
    : {}),
});

/** Seed the session, scan the card, and let a grown-up mark the ambiguous row. */
const throughReview = async (companionGate = null) => {
  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
  const scanned = await record.execute({ testId: '7654321', card: card({ companionGate }) });
  const graded = await grade.execute({ sessionId: SID, verdicts: { q2: 'correct' }, gradedBy: 'parent1' });
  return { scanned, graded };
};

beforeEach(() => build());

describe('the scan routes to a grown-up', () => {
  it('holds at submitted with the ambiguous row pending — the lane this suite is about', async () => {
    const { scanned, graded } = await throughReview({ status: 'blank', given: null });
    expect(scanned.session).toMatchObject({ advancedTo: 'submitted', reason: 'awaiting-review' });
    expect(graded).toMatchObject({ status: 'graded', percent: 100 });
  });
});

describe('a gated sheet that went through review', () => {
  it('does NOT pass with a blank gate row, however the grown-up marked it', async () => {
    await throughReview({ status: 'blank', given: null });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'needs_remediation', percent: 100 });
    expect(reduceSession(await sessions.readEvents(SID)).outcome)
      .toMatchObject({ reason: 'companion_incomplete' });
  });

  it('passes normally once the gate row carries the right code', async () => {
    await throughReview({ status: 'satisfied', given: ['A', 'C', 'E'] });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'passed', percent: 100 });
    expect(reduceSession(await sessions.readEvents(SID)).outcome)
      .toMatchObject({ reason: 'met_passing' });
  });
});

describe('a sheet with no companion', () => {
  it('goes through review exactly as it always did — no gate, no veto', async () => {
    build({ gated: false });
    await throughReview();
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'passed', percent: 100 });
    const state = reduceSession(await sessions.readEvents(SID));
    expect(state.companionGate).toBeNull();
    expect(state.outcome).toMatchObject({ reason: 'met_passing' });
    expect(state.errors).toEqual([]);
  });
});
