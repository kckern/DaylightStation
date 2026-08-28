/**
 * THE FINISH CODE IS A VETO, AND IT SITS OUTSIDE THE SCORE (Task 10).
 *
 * A lesson with a required companion prints a gate row. Filling it in is not
 * worth a point and getting it wrong does not cost one — but a sheet whose
 * gate row is blank or wrong CANNOT pass, however well it scored.
 *
 * Why a veto rather than an eleventh question: mixing them makes the failure
 * illegible. A child who scored 7/10 and a child who scored 10/10 but skipped
 * the audio have completely different problems, and one percentage cannot
 * tell a grown-up which is which. So the percent stays the percent, and the
 * gate is a separate yes/no that can only ever block.
 *
 * The other half of that promise is the receipt. "Try again" on its own would
 * send a child who answered every question correctly back to redo the
 * questions. It has to name the rule that actually failed, in words the child
 * can act on — and a BLANK gate ("you never played it") and a WRONG one ("you
 * played it, you mis-copied the letters") are different instructions.
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

/**
 * The same worksheet unit (pass mark 80) with a REQUIRED companion bolted on,
 * so the only variable between these tests is the gate row itself.
 */
const GATED_UNIT = {
  companion: { participation: 'required', label: 'Read Along' },
  reading: 'Psalm 70',
};

const build = ({ gated = true } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({
    units: rawUnits(gated ? { [WORKSHEET_UNIT]: GATED_UNIT } : {}),
    documents: rawDocuments(),
    manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
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

/** Drive a session to `graded`, stamping the scan's gate verdict onto the event. */
const graded = async ({ percent = 100, companionGate = undefined } = {}) => {
  await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
  await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
  await sessions.appendEvent(SID, { type: 'submitted', at: clock.iso(), sessionId: SID, transport: 'paper' });
  await sessions.appendEvent(SID, {
    type: 'graded', at: clock.iso(), sessionId: SID, attemptIds: ['att_1'], percent,
    correctCount: percent === 100 ? 10 : 5, totalCount: 10,
    ...(companionGate ? { companionGate } : {}),
  });
  return SID;
};

/** Every line of prose on the printed result, flattened. */
const receiptText = (result) => (result.document?.blocks ?? [])
  .map((block) => `${block.md ?? ''} ${block.headline ?? ''} ${block.title ?? ''}`)
  .join('\n');

beforeEach(() => build());

describe('the gate is cleared', () => {
  it('a correct finish code above the pass mark passes', async () => {
    await graded({ percent: 100, companionGate: { status: 'satisfied' } });
    expect(await close.execute({ sessionId: SID })).toMatchObject({ result: 'passed', percent: 100 });
  });

  it('a correct finish code below the pass mark is ordinary remediation — the companion is not the story', async () => {
    await graded({ percent: 50, companionGate: { status: 'satisfied' } });
    const result = await close.execute({ sessionId: SID });
    expect(result).toMatchObject({ result: 'needs_remediation' });
    expect(sessions.derive(SID).outcome).toMatchObject({ reason: 'below_passing' });
    // A score failure gets the ordinary retry ticket — a fresh worksheet.
    expect(result.retryToken).toBeTruthy();
    expect(receiptText(result)).not.toMatch(/Read Along/i);
  });
});

describe('the gate blocks a perfect sheet', () => {
  it('a BLANK gate row fails a 100% sheet, and the receipt names the companion', async () => {
    await graded({ percent: 100, companionGate: { status: 'blank' } });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'needs_remediation', percent: 100 });
    expect(sessions.derive(SID).outcome).toMatchObject({ reason: 'companion_incomplete' });
    const text = receiptText(result);
    expect(text).toMatch(/Read Along/);
    expect(text).toMatch(/Psalm 70/);
    expect(text).toMatch(/scan this sheet again/i);
    // The questions were right. Handing over a fresh worksheet would tell the
    // child to redo work that was never the problem — the gate BLOCKS, it
    // does not subtract.
    expect(result.retryToken).toBeNull();
  });

  it('a WRONG finish code fails a 100% sheet, with its own reason and its own instruction', async () => {
    await graded({ percent: 100, companionGate: { status: 'wrong' } });
    const result = await close.execute({ sessionId: SID });

    expect(result).toMatchObject({ result: 'needs_remediation', percent: 100 });
    // Distinguishable in the durable record from a blank row: one child never
    // played the audio, the other played it and mis-copied the letters.
    expect(sessions.derive(SID).outcome).toMatchObject({ reason: 'companion_code_wrong' });
    const text = receiptText(result);
    expect(text).toMatch(/Read Along/);
    // "Finish it" is the wrong instruction for a child who already did.
    expect(text).toMatch(/letters/i);
    expect(result.retryToken).toBeNull();
  });
});

describe('a lesson with no companion', () => {
  it('passes a perfect sheet exactly as it always did — no gate, no veto', async () => {
    build({ gated: false });
    await graded({ percent: 100 });
    const result = await close.execute({ sessionId: SID });
    expect(result).toMatchObject({ result: 'passed' });
    expect(sessions.derive(SID).outcome).toMatchObject({ reason: 'met_passing' });
    expect(receiptText(result)).not.toMatch(/Read Along/i);
  });
});
