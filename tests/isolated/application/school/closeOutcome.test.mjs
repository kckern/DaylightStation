import { describe, it, expect, beforeEach } from 'vitest';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore, FakeEconomy,
  FakeReceiptPrinter, FakeReceiptRenderer,
  fakeClock, fakeGrownUps, seededRng, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  WORKSHEET_UNIT, OMR_UNIT, MIXED_UNIT, MEDIA_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_1';

let clock, sessions, tokens, economy, thermal, close, remediate;

const build = ({ economyEnabled = true, throwOn = null, receiptPrinter = undefined } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  tokens = new FakeTokenRegistry();
  economy = new FakeEconomy({ throwOn });
  thermal = new FakeReceiptPrinter();
  const assignments = new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]);
  const receipts = new ReceiptPrinting({
    renderer: new FakeReceiptRenderer(),
    printer: receiptPrinter === undefined ? thermal : receiptPrinter,
    logger: silentLogger,
  });
  close = new CloseSessionOutcome({
    curriculum, sessions, tokens, assignments, economy, receipts,
    economyAction: 'school-unit-complete', economyEnabled,
    grownUps: fakeGrownUps(clock),
    clock: clock.now, rng: seededRng(5), logger: silentLogger,
  });
  remediate = new OpenRemediation({
    curriculum, sessions, clock: clock.now, newSessionId: sequentialIds('ses_r'), logger: silentLogger,
  });
};

/** Drive a session all the way to `graded` so the outcome step has input. */
const graded = async ({ unitId = WORKSHEET_UNIT, percent = 90, sessionId = SID, passedEarlier = [] } = {}) => {
  for (const done of passedEarlier) {
    await sessions.appendEvent(done.sessionId, { type: 'created', at: clock.iso(), sessionId: done.sessionId, learnerId: 'kid1', unitId: done.unitId });
    await sessions.appendEvent(done.sessionId, { type: 'issued', at: clock.iso(), sessionId: done.sessionId, artifactId: 'art_x' });
    await sessions.appendEvent(done.sessionId, { type: 'submitted', at: clock.iso(), sessionId: done.sessionId, transport: 'paper' });
    await sessions.appendEvent(done.sessionId, { type: 'graded', at: clock.iso(), sessionId: done.sessionId, attemptIds: ['att_x'], percent: 100 });
    await sessions.appendEvent(done.sessionId, { type: 'outcome_recorded', at: clock.iso(), sessionId: done.sessionId, outcomeId: `out:${done.sessionId}`, result: 'passed' });
    await sessions.appendEvent(done.sessionId, { type: 'rewarded', at: clock.iso(), sessionId: done.sessionId, txnId: 'txn_x', amount: 0 });
  }
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId: 'kid1', unitId });
  await sessions.appendEvent(sessionId, { type: 'issued', at: clock.iso(), sessionId, artifactId: 'art_1' });
  await sessions.appendEvent(sessionId, { type: 'submitted', at: clock.iso(), sessionId, transport: 'paper' });
  await sessions.appendEvent(sessionId, { type: 'graded', at: clock.iso(), sessionId, attemptIds: ['att_1'], percent });
  return sessionId;
};

/** Drive a session to `launch_dispatched` — the one state honor-close is legal from. */
const launched = async ({ unitId = WORKSHEET_UNIT, sessionId = SID, passedEarlier = [] } = {}) => {
  for (const done of passedEarlier) {
    await sessions.appendEvent(done.sessionId, { type: 'created', at: clock.iso(), sessionId: done.sessionId, learnerId: 'kid1', unitId: done.unitId });
    await sessions.appendEvent(done.sessionId, { type: 'issued', at: clock.iso(), sessionId: done.sessionId, artifactId: 'art_x' });
    await sessions.appendEvent(done.sessionId, { type: 'submitted', at: clock.iso(), sessionId: done.sessionId, transport: 'paper' });
    await sessions.appendEvent(done.sessionId, { type: 'graded', at: clock.iso(), sessionId: done.sessionId, attemptIds: ['att_x'], percent: 100 });
    await sessions.appendEvent(done.sessionId, { type: 'outcome_recorded', at: clock.iso(), sessionId: done.sessionId, outcomeId: `out:${done.sessionId}`, result: 'passed' });
    await sessions.appendEvent(done.sessionId, { type: 'rewarded', at: clock.iso(), sessionId: done.sessionId, txnId: 'txn_x', amount: 0 });
  }
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId: 'kid1', unitId });
  await sessions.appendEvent(sessionId, { type: 'launch_dispatched', at: clock.iso(), sessionId, surface: 'garage-fitness' });
  return sessionId;
};

beforeEach(() => build());

describe('the outcome', () => {
  it('records a pass with the deterministic outcome id', async () => {
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'settled', result: 'passed', outcomeId: `out:${SID}`, percent: 90 });
    expect(sessions.derive(SID).outcome).toMatchObject({ outcomeId: `out:${SID}`, result: 'passed' });
  });

  it('records a fail below the unit\'s passing bar', async () => {
    await graded({ percent: 50 });
    expect(await close.execute({ sessionId: SID })).toMatchObject({ result: 'needs_remediation' });
  });

  it('does NOT hold the pass back for a reward waiting on a grown-up', async () => {
    // Unit three's reward requires sign-off. The result must still be a pass,
    // or the next unit stays locked behind a coin.
    await graded({ unitId: OMR_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
    ] });
    const result = await close.execute({ sessionId: SID });
    expect(result.result).toBe('passed');
    expect(result.reward).toMatchObject({ amount: 0, skipReason: 'awaiting_signoff' });
  });

  it('refuses to settle work that was never marked', async () => {
    await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    expect(await close.execute({ sessionId: SID })).toMatchObject({ status: 'unavailable' });
  });

  it('explains an unknown session', async () => {
    expect(await close.execute({ sessionId: 'ses_nope' })).toMatchObject({ status: 'unavailable' });
  });
});

/**
 * The honor-close door (spec §6): a `launch:` unit dispatches work to another
 * surface and has nothing else to measure, so completion is the dispatch
 * itself. This is a DOOR, not a bypass — it exists ONLY from `launch_dispatched`
 * and refuses (with the shipped `unavailable` message) from every other state,
 * exactly as if `honorClose` had never been passed.
 */
describe('the honor-close door', () => {
  it('honor-closes a launch-dispatched session as a pass, and settles', async () => {
    await launched();
    const result = await close.execute({ sessionId: SID, honorClose: true });
    expect(result).toMatchObject({ status: 'settled', result: 'passed', outcomeId: `out:${SID}` });
    expect(sessions.derive(SID).outcome).toMatchObject({ outcomeId: `out:${SID}`, result: 'passed' });
    expect(sessions.types(SID).filter((t) => t === 'outcome_recorded')).toHaveLength(1);
  });

  it("records the outcome's reason as launch_dispatched", async () => {
    await launched();
    await close.execute({ sessionId: SID, honorClose: true });
    const outcomeEvent = (await sessions.readEvents(SID)).find((e) => e.type === 'outcome_recorded');
    expect(outcomeEvent).toMatchObject({ result: 'passed', reason: 'launch_dispatched' });
  });

  it('rides the existing reward guard on honor-close, same as a graded pass', async () => {
    await launched();
    const result = await close.execute({ sessionId: SID, honorClose: true });
    expect(result.reward).toMatchObject({ amount: 5, txnId: 'txn_1', skipReason: null });
    expect(economy.calls).toEqual([{
      userId: 'kid1', action: 'school-unit-complete', source: 'school', ref: `out:${SID}`, amount: 5,
    }]);
    expect(sessions.derive(SID)).toMatchObject({ state: 'rewarded', terminal: true });
  });

  it('prints the same result receipt shape as a graded close', async () => {
    await launched();
    const result = await close.execute({ sessionId: SID, honorClose: true });
    expect(result.printed).toBe(true);
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it.each(['created', 'issued', 'graded'])(
    'refuses honor-close from %s — the door stays a door (spec §9 row 6)',
    async (fromState) => {
      if (fromState === 'created') {
        await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
      } else if (fromState === 'issued') {
        await sessions.appendEvent(SID, { type: 'created', at: clock.iso(), sessionId: SID, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
        await sessions.appendEvent(SID, { type: 'issued', at: clock.iso(), sessionId: SID, artifactId: 'art_1' });
      } else {
        await graded();
      }
      const result = await close.execute({ sessionId: SID, honorClose: true });
      expect(result.status).toBe('unavailable');
      expect(sessions.types(SID)).not.toContain('outcome_recorded');
    },
  );

  it('refuses honor-close on an unknown session, same as a regular close', async () => {
    expect(await close.execute({ sessionId: 'ses_nope', honorClose: true })).toMatchObject({ status: 'unavailable' });
  });

  it('leaves a regular (non-honor) close byte-identical', async () => {
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'settled', result: 'passed', outcomeId: `out:${SID}`, percent: 90 });
  });
});

describe('the result receipt', () => {
  it('is a valid receipt document', async () => {
    await graded();
    const { document } = await close.execute({ sessionId: SID });
    expect(validateDocument(document).errors).toEqual([]);
  });

  it('carries the score and the coins actually paid', async () => {
    await graded();
    const { document } = await close.execute({ sessionId: SID });
    const text = document.blocks.map((b) => b.md ?? '').join('\n');
    expect(text).toContain('90%');
    expect(text).toContain('5 coins');
  });

  it('carries an OPAQUE retry ticket on a fail, and objectives to revisit', async () => {
    await graded({ percent: 20 });
    const result = await close.execute({ sessionId: SID });
    const action = result.document.blocks.find((b) => b.type === 'scan_action');
    expect(isSchoolToken(action.action)).toBe(true);
    expect(await tokens.get(action.action)).toMatchObject({ tokenClass: 'remediation', subject: { sessionId: SID } });
    // The objectives printed back are the unit's OWN, verbatim — a receipt that
    // paraphrases is a receipt a child cannot match to the sheet in their hand.
    expect(result.document.blocks.map((b) => b.md ?? '').join('\n'))
      .toContain(fixtureUnit(WORKSHEET_UNIT).objectives[0]);
  });

  it('names the newly unlocked next unit on a pass', async () => {
    await graded({ unitId: MEDIA_UNIT, percent: 100 });
    const result = await close.execute({ sessionId: SID });
    const next = fixtureUnit(WORKSHEET_UNIT).title;
    expect(result.unlocked).toMatchObject({ unitId: WORKSHEET_UNIT, title: next });
    expect(result.document.blocks.map((b) => b.md ?? '').join('\n')).toContain(`Next up: ${next}`);
  });

  it('promises no next unit at the end of a course', async () => {
    await graded({ unitId: MIXED_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
      { sessionId: 'ses_c', unitId: OMR_UNIT },
    ] });
    expect((await close.execute({ sessionId: SID })).unlocked).toBeNull();
  });

  it('never prints coins on a fail', async () => {
    await graded({ percent: 10 });
    const { document } = await close.execute({ sessionId: SID });
    expect(document.blocks.map((b) => b.md ?? '').join('\n')).not.toContain('coin');
  });
});

// A result the child never sees is not a result. Settling used to return a
// document and stop, so on a FAIL the retry barcode never left the printer and
// the loop dead-ended with nothing in the child's hand to scan.
describe('the result receipt reaches paper', () => {
  it('prints the receipt as part of settling', async () => {
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(result.printed).toBe(true);
    expect(thermal.jobs).toHaveLength(1);
    expect(thermal.lastTranscript()).toContain('Score: 90%');
  });

  it('PUTS THE RETRY TICKET ON PAPER after a fail, scannably', async () => {
    await graded({ percent: 20 });
    const result = await close.execute({ sessionId: SID });
    expect(result.printed).toBe(true);
    const barcodes = thermal.jobs.at(-1).items.filter((i) => i.type === 'barcode');
    expect(barcodes.map((b) => b.content)).toContain(result.retryToken);
    expect(await tokens.get(result.retryToken)).toMatchObject({ tokenClass: 'remediation' });
  });

  it('reprints on a second close-out — the child may have lost the first', async () => {
    await graded();
    await close.execute({ sessionId: SID });
    const again = await close.execute({ sessionId: SID });
    expect(again.status).toBe('already_settled');
    expect(thermal.jobs).toHaveLength(2);
  });

  it('settles anyway when there is no receipt printer, and says it did not print', async () => {
    build({ receiptPrinter: null });
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(result.status).toBe('settled');
    expect(result.printed).toBe(false);
    expect(sessions.derive(SID).terminal).toBe(true);
  });

  it('settles anyway when the printer refuses the job', async () => {
    await graded();
    thermal.setFault('offline');
    const result = await close.execute({ sessionId: SID });
    expect(result.status).toBe('settled');
    expect(result.printed).toBe(false);
    expect(result.result).toBe('passed');
  });
});

describe('the reward guard', () => {
  it('pays once through the economy, keyed on the outcome id', async () => {
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(economy.calls).toEqual([{
      userId: 'kid1', action: 'school-unit-complete', source: 'school', ref: `out:${SID}`, amount: 5,
    }]);
    expect(result.reward).toMatchObject({ amount: 5, txnId: 'txn_1', skipReason: null });
    expect(sessions.derive(SID).rewardTxn).toBe('txn_1');
  });

  it('BLOCKS A SECOND PAYOUT ACROSS A DAY BOUNDARY', async () => {
    await graded();
    await close.execute({ sessionId: SID });
    // The economy's own guard reads one UTC day's ledger and would pay again.
    clock.advanceDays(1);
    const second = await close.execute({ sessionId: SID });
    expect(economy.calls).toHaveLength(1);
    expect(second).toMatchObject({ status: 'already_settled' });
    expect(second.reward).toMatchObject({ skipReason: 'already_rewarded', txnId: 'txn_1' });
    expect(sessions.types(SID).filter((t) => t === 'rewarded')).toHaveLength(1);
  });

  it('records ONE outcome however many times it is closed', async () => {
    await graded();
    await close.execute({ sessionId: SID });
    await close.execute({ sessionId: SID });
    await close.execute({ sessionId: SID });
    expect(sessions.types(SID).filter((t) => t === 'outcome_recorded')).toHaveLength(1);
    expect(sessions.derive(SID).errors).toEqual([]);
  });

  it('pays nothing when the household economy is off, and still settles', async () => {
    build({ economyEnabled: false });
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(economy.calls).toEqual([]);
    expect(result.reward).toMatchObject({ amount: 0, skipReason: 'economy_disabled' });
    expect(sessions.derive(SID).terminal).toBe(true);
  });

  it('pays nothing for a unit with no reward policy, and still settles', async () => {
    await graded({ unitId: MIXED_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
      { sessionId: 'ses_c', unitId: OMR_UNIT },
    ] });
    const result = await close.execute({ sessionId: SID });
    expect(result.reward).toMatchObject({ amount: 0, skipReason: 'no_reward_policy' });
    expect(sessions.derive(SID)).toMatchObject({ state: 'rewarded', terminal: true });
  });

  it('pays a signed-off reward', async () => {
    await graded({ unitId: OMR_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
    ] });
    const result = await close.execute({ sessionId: SID, signedOff: true, signedOffBy: 'parent' });
    expect(result.reward).toMatchObject({ amount: 15, txnId: 'txn_1' });
  });

  // Unit 03 declares `reward: { amount: 15 }`. A unit field the ledger never
  // sees is worse than no field: the curriculum says 15 and the child gets the
  // config's default.
  it('PAYS THE AMOUNT THE UNIT DECLARES, not the earn action default', async () => {
    await graded({ unitId: OMR_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
    ] });
    const result = await close.execute({ sessionId: SID, signedOff: true, signedOffBy: 'parent' });
    expect(economy.calls[0].amount).toBe(15);
    expect(result.reward.amount).toBe(15);
    expect(sessions.derive(SID)).toMatchObject({ state: 'rewarded', terminal: true });
  });

  it('leaves an unsigned reward OPEN so a grown-up can still decide', async () => {
    await graded({ unitId: OMR_UNIT, percent: 100, passedEarlier: [
      { sessionId: 'ses_a', unitId: 'math-fractions.01' },
      { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
    ] });
    await close.execute({ sessionId: SID });
    expect(sessions.types(SID)).not.toContain('rewarded');
    const later = await close.execute({ sessionId: SID, signedOff: true, signedOffBy: 'parent' });
    expect(later.reward).toMatchObject({ amount: 15 });
  });

  it('settles the outcome even when the economy refuses the call', async () => {
    build({ throwOn: 'unknown earn action: school-unit-complete' });
    await graded();
    const result = await close.execute({ sessionId: SID });
    expect(result.result).toBe('passed');
    expect(result.reward).toMatchObject({ skipReason: 'economy_error' });
    expect(sessions.derive(SID).lastFailure).toMatchObject({ stage: 'reward' });
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('never pays for a fail', async () => {
    await graded({ percent: 0 });
    await close.execute({ sessionId: SID });
    expect(economy.calls).toEqual([]);
  });
});

describe('OpenRemediation', () => {
  const failed = async () => {
    await graded({ percent: 20 });
    await close.execute({ sessionId: SID });
    return SID;
  };

  it('opens a LINKED session with the next variant', async () => {
    await failed();
    const result = await remediate.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'opened', newSessionId: 'ses_r1', variant: 1 });
    expect(sessions.derive('ses_r1')).toMatchObject({ unitId: WORKSHEET_UNIT, remediationOf: SID, variant: 1, state: 'created' });
  });

  it('closes the original as terminal, keeping its own evidence', async () => {
    await failed();
    await remediate.execute({ sessionId: SID });
    const original = sessions.derive(SID);
    expect(original).toMatchObject({ state: 'remediation_opened', terminal: true, gradedPercent: 20 });
    expect(original.remediation).toEqual({ newSessionId: 'ses_r1', variant: 1 });
    expect(original.errors).toEqual([]);
  });

  it('cycles within the variants the unit actually authored', async () => {
    await failed();
    await remediate.execute({ sessionId: SID });
    // Fail the retry too, and the third form comes out — then it wraps.
    for (const [from, expected] of [['ses_r1', 2], ['ses_r2', 0]]) {
      await sessions.appendEvent(from, { type: 'issued', at: clock.iso(), sessionId: from, artifactId: `art_${from}` });
      await sessions.appendEvent(from, { type: 'submitted', at: clock.iso(), sessionId: from, transport: 'paper' });
      await sessions.appendEvent(from, { type: 'graded', at: clock.iso(), sessionId: from, attemptIds: ['att_z'], percent: 10 });
      await close.execute({ sessionId: from });
      expect(await remediate.execute({ sessionId: from })).toMatchObject({ variant: expected });
    }
  });

  it('RE-SCANNING THE RETRY TICKET never opens a third session', async () => {
    await failed();
    const first = await remediate.execute({ sessionId: SID });
    const second = await remediate.execute({ sessionId: SID });
    expect(second).toMatchObject({ status: 'already_opened', newSessionId: first.newSessionId });
    expect(sessions.ids()).toEqual([SID, 'ses_r1']);
  });

  it('refuses a retry on work that passed', async () => {
    await graded({ percent: 100 });
    await close.execute({ sessionId: SID });
    expect(await remediate.execute({ sessionId: SID })).toMatchObject({ status: 'unavailable' });
  });

  it('refuses a retry before anything was settled', async () => {
    await graded({ percent: 20 });
    const result = await remediate.execute({ sessionId: SID });
    expect(result.status).toBe('unavailable');
    expect(validateDocument(result.document).errors).toEqual([]);
  });
});

/**
 * `signedOff` is a grown-up saying "yes, pay them". It arrives as a boolean in a
 * request body, and until now it named nobody at all — a child could close their
 * own session with `{signedOff: true}` and collect a reward the unit says needs
 * a parent. The claim now has to carry the person making it.
 */
describe('who may sign off a reward', () => {
  const rewardable = () => graded({ unitId: OMR_UNIT, percent: 100, passedEarlier: [
    { sessionId: 'ses_a', unitId: 'math-fractions.01' },
    { sessionId: 'ses_b', unitId: WORKSHEET_UNIT },
  ] });

  it('REFUSES a sign-off claimed by the child, and pays nothing', async () => {
    await rewardable();
    await expect(close.execute({ sessionId: SID, signedOff: true, signedOffBy: 'kid1' }))
      .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(economy.calls).toEqual([]);
    expect(sessions.types(SID)).not.toContain('rewarded');
  });

  it('REFUSES an unknown signer, a birthyear-less one, and an unsigned claim', async () => {
    await rewardable();
    for (const signedOffBy of ['mr-nobody', 'aunty', null]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(close.execute({ sessionId: SID, signedOff: true, signedOffBy }))
        .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    }
    expect(economy.calls).toEqual([]);
  });

  it('settles WITHOUT a sign-off for anyone at all — closing is not the privileged part', async () => {
    await rewardable();
    const result = await close.execute({ sessionId: SID });
    expect(result.result).toBe('passed');
    expect(result.reward).toMatchObject({ skipReason: 'awaiting_signoff' });
  });

  it('cannot be built without a grown-up gate', () => {
    expect(() => new CloseSessionOutcome({
      curriculum: {}, sessions, tokens, assignments: new FakeAssignmentStore([]), clock: clock.now,
    })).toThrow(/grownUps/);
  });
});
