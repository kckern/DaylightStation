/**
 * A RE-SCAN REPAIRS THE GATE, NEVER THE SCORE (Task 11, part B).
 *
 * A child whose sheet was blocked by its finish-code row fixes it the only way
 * a printed sheet can be fixed: they fill in the code bubbles and feed the SAME
 * card again. Only the gate row is re-read. The questions are not re-graded and
 * the recorded score does not move.
 *
 * WHY THE SCORE MUST NOT MOVE. The result receipt already tells the child which
 * questions they got wrong, and eraser-leniency credits a two-mark row that
 * contains the correct answer. Re-grading the questions on a repair scan would
 * let a child add the right bubble beside a wrong one and gain credit — turning
 * a gate repair into a score repair. That is the exploit this suite guards.
 *
 * WHY NO ATTEMPT COUNTER IS NEEDED. Paper is append-only: a child can add marks
 * but never remove them, so the codes they can reach walk a chain of supersets
 * — A, AB, ABC, ABCD, ABCDE — at most five, and only if the real code lies on
 * that exact chain. A full row is permanently wrong, and the sheet says so
 * (`companion_code_exhausted`) rather than inviting a sixth try.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore,
  fakeClock, fakeGrownUps, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT } from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_repair_1';

const GATED_UNIT = {
  companion: { participation: 'required', label: 'Read Along' },
  reading: 'Psalm 70',
};

let clock, sessions, datastore, record, close;

function fakeDatastore() {
  const byLearner = new Map();
  return {
    byLearner,
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) { return structuredClone(byLearner.get(learnerId) ?? []); },
  };
}

const build = () => {
  clock = fakeClock();
  const catalog = new FakeCatalog({
    units: rawUnits({ [WORKSHEET_UNIT]: GATED_UNIT }),
    documents: rawDocuments(),
    manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  datastore = fakeDatastore();
  record = new RecordCardScanOutcome({ datastore, sessions, clock: clock.now, logger: silentLogger });
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

/** The same physical card, scanned twice. `q2` is what a cheat would try to move. */
const card = ({ gate, q2 = 'correct', reScored = false }) => ({
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
    {
      row: 3,
      itemId: 'q2',
      itemType: 'multiple_choice',
      prompt: null,
      status: q2,
      given: q2 === 'correct' ? 'B' : ['B', 'C'],
      points: 1,
      earned: q2 === 'correct' ? 1 : 0,
      concepts: [],
    },
  ],
  totalPoints: 2,
  earnedPoints: q2 === 'correct' ? 2 : 1,
  unscannedItems: [],
  companionGate: { itemId: COMPANION_GATE_ITEM_ID, row: 1, ...gate },
  ...(reScored ? { reScored: true } : {}),
});

const scan = (over) => record.execute({ testId: '7654321', card: card(over) });
const derive = async () => reduceSession(await sessions.readEvents(SID));

/** Scan once with a blank gate row and settle: the sheet that owes its code. */
const blockedOnBlankGate = async () => {
  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
  await scan({ gate: { status: 'blank', given: null } });
  const settled = await close.execute({ sessionId: SID });
  expect(settled).toMatchObject({ result: 'needs_remediation' });
  expect((await derive()).outcome).toMatchObject({ reason: 'companion_incomplete' });
  return settled;
};

beforeEach(() => build());

describe('the code arrives on a second feed of the same sheet', () => {
  it('passes once the gate row carries the right letters', async () => {
    await blockedOnBlankGate();

    const repair = await scan({ gate: { status: 'satisfied', given: ['A', 'C', 'E'] }, reScored: true });
    expect(repair).toMatchObject({ recorded: true, reason: 'companion-gate-repaired' });

    const result = await close.execute({ sessionId: SID });
    expect(result).toMatchObject({ result: 'passed' });
    const state = await derive();
    expect(state.errors).toEqual([]);
    expect(state.companionGate).toMatchObject({ status: 'satisfied' });
    expect(state.outcome).toMatchObject({ result: 'passed', reason: 'met_passing' });
  });

  it('leaves the SCORE exactly where it was, even when the re-scan reads the questions differently', async () => {
    await blockedOnBlankGate();
    const before = await derive();
    expect(before.gradedPercent).toBe(100);
    expect(datastore.readAllAttempts('kid1')).toHaveLength(2);

    // The exploit: the child adds a second bubble beside a wrong answer and
    // re-feeds the sheet. This scan decodes q2 differently from the first.
    await scan({ gate: { status: 'satisfied', given: ['A', 'C', 'E'] }, q2: 'ambiguous', reScored: true });
    await close.execute({ sessionId: SID });

    const after = await derive();
    expect(after.gradedPercent).toBe(100);
    expect(after.gradedCorrectCount).toBe(2);
    expect(after.gradedTotalCount).toBe(2);
    expect(after.missedItemIds).toEqual([]);
    // And nothing new landed in the child's permanent attempt log: a repair
    // scan reads the gate row and nothing else.
    expect(datastore.readAllAttempts('kid1')).toHaveLength(2);
  });

  it('still fails on a still-wrong code, and says which failure it is now', async () => {
    await blockedOnBlankGate();

    await scan({ gate: { status: 'wrong', given: ['A', 'B'] }, reScored: true });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'needs_remediation' });
    // Distinguishable from where it started: "you never played it" has become
    // "you played it and mis-copied the letters".
    expect((await derive()).outcome).toMatchObject({ reason: 'companion_code_wrong' });
  });

  it('treats a re-scan that changes nothing at all as the duplicate it is', async () => {
    await blockedOnBlankGate();

    const again = await scan({ gate: { status: 'blank', given: null }, reScored: true });
    expect(again).toMatchObject({ recorded: false, reason: 'duplicate-scan' });
    expect((await derive()).outcome).toMatchObject({ reason: 'companion_incomplete' });
  });
});

describe('the row runs out of letters', () => {
  it('reports an exhausted sheet once all five are marked and still wrong', async () => {
    await blockedOnBlankGate();

    await scan({ gate: { status: 'exhausted', given: ['A', 'B', 'C', 'D', 'E'] }, reScored: true });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'needs_remediation' });
    // Its own reason, because the instruction is different: no amount of
    // bubbling repairs a full row, so this child needs a fresh sheet.
    expect((await derive()).outcome).toMatchObject({ reason: 'companion_code_exhausted' });
    expect(result.retryToken).toBeTruthy();
    const text = (result.document?.blocks ?? [])
      .map((b) => `${b.md ?? ''} ${b.headline ?? ''} ${b.title ?? ''}`).join('\n');
    expect(text).toMatch(/new sheet/i);
  });
});
