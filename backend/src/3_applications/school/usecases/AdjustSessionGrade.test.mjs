import { describe, it, expect, vi } from 'vitest';
import { AdjustSessionGrade, RetractSessionGradeAdjustment } from './AdjustSessionGrade.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const baseEvents = () => [
  { type: 'created', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'kid', unitId: 'math' },
  { type: 'issued', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_1', seq: 2, artifactId: 'art_1' },
  { type: 'submitted', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_1', seq: 3, transport: 'paper' },
  { type: 'graded', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_1', seq: 4,
    attemptIds: ['att_1'], percent: 50, passingPercent: 80, correctCount: 1, totalCount: 2 },
  { type: 'outcome_recorded', at: '2026-08-01T10:04:00.000Z', sessionId: 'ses_1', seq: 5,
    outcomeId: 'out_1', result: 'needs_remediation' },
  { type: 'remediation_opened', at: '2026-08-01T10:05:00.000Z', sessionId: 'ses_1', seq: 6,
    newSessionId: 'ses_2', variant: 1 },
];

function fixture() {
  const events = baseEvents();
  const sessions = {
    readEvents: vi.fn(async () => events.map((event) => ({ ...event }))),
    appendEvent: vi.fn(async (sessionId, event) => {
      const stored = { ...event, sessionId, seq: events.length + 1 };
      events.push(stored);
      return stored;
    }),
  };
  const teacherGate = { assert: vi.fn() };
  const deps = { sessions, teacherGate, clock: () => new Date('2026-08-02T12:00:00.000Z'), logger: { info() {} } };
  return { events, sessions, teacherGate, adjust: new AdjustSessionGrade(deps), retract: new RetractSessionGradeAdjustment(deps) };
}

describe('AdjustSessionGrade', () => {
  it('issues one immutable correction receipt only after an adjustment is applied', async () => {
    const f = fixture();
    const receiptIssuer = { execute: vi.fn(async () => ({ artifactId: 'receipt/ses_1/correction/adj_1', created: true })) };
    const adjust = new AdjustSessionGrade({ sessions: f.sessions, teacherGate: f.teacherGate, receiptIssuer,
      clock: () => new Date('2026-08-02T12:00:00.000Z'), logger: { info() {} } });
    const args = { sessionId: 'ses_1', adjustmentId: 'adj_1', percent: 100,
      reason: 'scanner missed a mark', adjustedBy: 'parent', baseSeq: 6 };

    await adjust.execute(args);
    expect(receiptIssuer.execute).not.toHaveBeenCalled();
    const applied = await adjust.execute({ ...args, apply: true });

    expect(applied.receiptArtifact).toMatchObject({ artifactId: 'receipt/ses_1/correction/adj_1' });
    expect(receiptIssuer.execute).toHaveBeenCalledOnce();
    expect(receiptIssuer.execute).toHaveBeenCalledWith({ sessionId: 'ses_1', correctionId: 'adj_1', reason: 'scanner missed a mark' });
  });

  it('previews without writing, then appends one annotation and is idempotent', async () => {
    const f = fixture();
    const args = { sessionId: 'ses_1', adjustmentId: 'adj_erase', percent: 100,
      reason: 'OMR eraser false negative', adjustedBy: 'parent', baseSeq: 6 };
    const preview = await f.adjust.execute(args);
    expect(preview).toMatchObject({ applied: false, baseSeq: 6,
      machineGrade: { percent: 50 }, effectiveGrade: { percent: 100 }, outcome: { result: 'passed' } });
    expect(f.sessions.appendEvent).not.toHaveBeenCalled();

    const receipt = await f.adjust.execute({ ...args, apply: true });
    expect(receipt.applied).toBe(true);
    expect(f.sessions.appendEvent).toHaveBeenCalledTimes(1);
    expect(reduceSession(f.events)).toMatchObject({ gradedPercent: 100, machineGrade: { percent: 50 } });

    const retry = await f.adjust.execute({ ...args, apply: true });
    expect(retry).toMatchObject({ applied: true, idempotent: true });
    expect(f.sessions.appendEvent).toHaveBeenCalledTimes(1);
  });

  it('replays a retraction receipt before evaluating the now-stale preview revision', async () => {
    const f = fixture();
    await f.adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', percent: 100,
      reason: 'freebie', adjustedBy: 'parent', baseSeq: 6, apply: true });
    const args = { sessionId: 'ses_1', adjustmentId: 'adj_1', reason: 'wrong session',
      retractedBy: 'parent', baseSeq: 7, apply: true };
    await f.retract.execute(args);
    const replay = await f.retract.execute(args);
    expect(replay).toMatchObject({ applied: true, idempotent: true });
    expect(f.sessions.appendEvent).toHaveBeenCalledTimes(2);
  });

  it('refuses reuse of a correction or retraction id for different evidence', async () => {
    const f = fixture();
    await f.adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', percent: 100,
      missedItemIds: ['q2'], reason: 'scanner miss', adjustedBy: 'parent', baseSeq: 6, apply: true });
    await expect(f.adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', percent: 100,
      missedItemIds: ['q1'], reason: 'scanner miss', adjustedBy: 'parent', baseSeq: 6, apply: true }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await f.retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', reason: 'wrong session',
      retractedBy: 'parent', baseSeq: 7, apply: true });
    await expect(f.retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', reason: 'duplicate',
      retractedBy: 'parent', baseSeq: 7, apply: true }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('refuses a stale preview revision', async () => {
    const f = fixture();
    await expect(f.adjust.execute({ sessionId: 'ses_1', percent: 90, reason: 'fix', adjustedBy: 'parent', baseSeq: 5 }))
      .rejects.toMatchObject({ code: 'STALE_SAVE' });
  });

  it('retracts without removing the correction event', async () => {
    const f = fixture();
    await f.adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1', percent: 100,
      reason: 'freebie', adjustedBy: 'parent', baseSeq: 6, apply: true });
    const preview = await f.retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1',
      reason: 'wrong session', retractedBy: 'parent', baseSeq: 7 });
    expect(preview).toMatchObject({ applied: false, effectiveGrade: { percent: 50 } });
    await f.retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_1',
      reason: 'wrong session', retractedBy: 'parent', baseSeq: 7, apply: true });
    expect(f.events.map((event) => event.type)).toContain('grade_adjustment_retracted');
    expect(reduceSession(f.events).gradedPercent).toBe(50);
  });

  it('applies and reverses the exact reward delta with append-only reconciliation evidence', async () => {
    const f = fixture();
    const economy = { adjust: vi.fn(async (_learnerId, args) => ({ txnId: `txn:${args.ref}` })) };
    const curriculum = { getUnit: vi.fn(async () => ({ reward: { amount: 5 } })) };
    const deps = { sessions: f.sessions, teacherGate: f.teacherGate, economy, curriculum,
      economyEnabled: true, clock: () => new Date('2026-08-02T12:00:00.000Z'), logger: { info() {}, warn() {} } };
    const adjust = new AdjustSessionGrade(deps);
    const retract = new RetractSessionGradeAdjustment(deps);

    const corrected = await adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_reward', percent: 100,
      reason: 'OMR false negative', adjustedBy: 'parent', baseSeq: 6, apply: true });
    expect(corrected.rewardReconciliation).toMatchObject({ status: 'applied', delta: 5, desiredAmount: 5 });
    expect(economy.adjust).toHaveBeenLastCalledWith('kid', expect.objectContaining({
      delta: 5, ref: 'grade-adjustment:adj_reward', source: 'school-grade-correction',
    }));
    expect(reduceSession(f.events).rewardAmount).toBe(5);

    const reversed = await retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_reward',
      reason: 'correction was mistaken', retractedBy: 'parent', baseSeq: 8, apply: true });
    expect(reversed.rewardReconciliation).toMatchObject({ status: 'applied', delta: -5, desiredAmount: 0 });
    expect(economy.adjust).toHaveBeenLastCalledWith('kid', expect.objectContaining({
      delta: -5, ref: 'grade-adjustment-retraction:adj_reward',
    }));
    expect(reduceSession(f.events).rewardAmount).toBe(0);
  });
});

/**
 * A REVERSAL MUST DEBIT WHOEVER WAS PAID.
 *
 * `reassigned` is legal at `rewarded`, so a lesson can be re-credited after it
 * paid — and from that moment the session's credited learner and the child
 * holding the coins are two different people. Reconciling against the credited
 * learner would take five coins off a child who was never given them while the
 * original child kept theirs, and a raise would pay the household's coins out
 * twice. The payee is recorded on the award; this is what reads it.
 */
describe('reward reconciliation after a reassignment', () => {
  const paidThenReassigned = ({ paidTo = 'kid1' } = {}) => [
    { type: 'created', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'kid1', unitId: 'math' },
    { type: 'issued', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_1', seq: 2, artifactId: 'art_1' },
    { type: 'submitted', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_1', seq: 3, transport: 'paper' },
    { type: 'graded', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_1', seq: 4,
      attemptIds: ['att_1'], percent: 100, passingPercent: 80, correctCount: 2, totalCount: 2 },
    { type: 'outcome_recorded', at: '2026-08-01T10:04:00.000Z', sessionId: 'ses_1', seq: 5, outcomeId: 'out_1', result: 'passed' },
    { type: 'rewarded', at: '2026-08-01T10:05:00.000Z', sessionId: 'ses_1', seq: 6, txnId: 'txn_1', amount: 5, ...(paidTo ? { paidTo } : {}) },
    { type: 'reassigned', at: '2026-08-02T09:00:00.000Z', sessionId: 'ses_1', seq: 7,
      fromLearnerId: 'kid1', toLearnerId: 'kid2', reviewedBy: 'parent', reason: 'kid2 sat at the wrong desk' },
  ];

  const build = (events) => {
    const log = events.map((e) => ({ ...e }));
    const sessions = {
      readEvents: vi.fn(async () => log.map((event) => ({ ...event }))),
      appendEvent: vi.fn(async (sessionId, event) => {
        const stored = { ...event, sessionId, seq: log.length + 1 };
        log.push(stored);
        return stored;
      }),
    };
    const economy = { adjust: vi.fn(async (_learnerId, args) => ({ txnId: `txn:${args.ref}` })) };
    const adjust = new AdjustSessionGrade({
      sessions, teacherGate: { assert: vi.fn() }, economy,
      curriculum: { getUnit: vi.fn(async () => ({ reward: { amount: 5 } })) },
      economyEnabled: true, clock: () => new Date('2026-08-02T12:00:00.000Z'), logger: { info() {}, warn() {} },
    });
    return { log, economy, adjust };
  };

  const failIt = (adjust) => adjust.execute({
    sessionId: 'ses_1', adjustmentId: 'adj_down', percent: 40,
    reason: 'the marks were another child\'s', adjustedBy: 'parent', baseSeq: 7, apply: true,
  });

  it('debits the child who was paid, not the child the work now belongs to', async () => {
    const { log, economy, adjust } = build(paidThenReassigned());
    // The session reads as kid2's work; the coins are kid1's.
    expect(reduceSession(log)).toMatchObject({ learnerId: 'kid2', rewardPaidTo: 'kid1', rewardAmount: 5 });

    const result = await failIt(adjust);
    expect(result.rewardReconciliation).toMatchObject({ status: 'applied', delta: -5, desiredAmount: 0 });
    expect(economy.adjust).toHaveBeenCalledOnce();
    expect(economy.adjust).toHaveBeenCalledWith('kid1', expect.objectContaining({ delta: -5 }));
    // The child who never held these coins is not touched at all.
    expect(economy.adjust.mock.calls.map(([learnerId]) => learnerId)).not.toContain('kid2');
  });

  it('debits the original child on a LEGACY award that names no payee at all', async () => {
    // The exposure is not historical events — it is a future move on a
    // historical session, which is exactly what this branch makes possible.
    // Every session rewarded before `paidTo` existed carries none, and nothing
    // backfills them; the reducer derives the payee instead, which is exact
    // because a reassignment could not legally follow a reward until now.
    const { log, economy, adjust } = build(paidThenReassigned({ paidTo: null }));
    expect(reduceSession(log)).toMatchObject({ learnerId: 'kid2', rewardPaidTo: 'kid1', rewardAmount: 5 });
    await failIt(adjust);
    expect(economy.adjust).toHaveBeenCalledWith('kid1', expect.objectContaining({ delta: -5 }));
    expect(economy.adjust.mock.calls.map(([learnerId]) => learnerId)).not.toContain('kid2');
  });

  /**
   * A RECONCILIATION MOVES COINS TOO.
   *
   * An unpaid session (`rewarded`, amount 0) names no payee, so a credit that
   * arrives later by correction creates one that the award never recorded. Every
   * step below is legal — `grade_adjusted`, `grade_adjustment_retracted` and
   * `reassigned` are all annotations legal at a terminal state — so the second
   * move has to find the child holding coins the FIRST correction paid.
   */
  it('follows the coins through a correction, a second move, and a retraction', async () => {
    const unpaidThenReassigned = [
      { type: 'created', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'kid1', unitId: 'math' },
      { type: 'issued', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_1', seq: 2, artifactId: 'art_1' },
      { type: 'submitted', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_1', seq: 3, transport: 'paper' },
      { type: 'graded', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_1', seq: 4,
        attemptIds: ['att_1'], percent: 40, passingPercent: 80, correctCount: 1, totalCount: 2 },
      { type: 'outcome_recorded', at: '2026-08-01T10:04:00.000Z', sessionId: 'ses_1', seq: 5, outcomeId: 'out_1', result: 'needs_remediation' },
      // Closed unpaid: nobody holds anything, so nobody is named.
      { type: 'rewarded', at: '2026-08-01T10:05:00.000Z', sessionId: 'ses_1', seq: 6, txnId: 'txn_1', amount: 0 },
      { type: 'reassigned', at: '2026-08-02T09:00:00.000Z', sessionId: 'ses_1', seq: 7,
        fromLearnerId: 'kid1', toLearnerId: 'kid2', reviewedBy: 'parent', reason: 'kid2 did this one' },
    ];
    const { log, economy, adjust } = build(unpaidThenReassigned);
    expect(reduceSession(log).rewardPaidTo).toBeNull();

    // Corrected up: kid2 is credited 5, and now holds them.
    await adjust.execute({ sessionId: 'ses_1', adjustmentId: 'adj_up', percent: 100,
      reason: 'scanner missed the second page', adjustedBy: 'parent', baseSeq: 7, apply: true });
    expect(economy.adjust).toHaveBeenLastCalledWith('kid2', expect.objectContaining({ delta: 5 }));
    expect(reduceSession(log)).toMatchObject({ rewardAmount: 5, rewardPaidTo: 'kid2' });

    // Moved again, to kid3 — the coins do not travel with the attribution.
    log.push({ type: 'reassigned', at: '2026-08-03T09:00:00.000Z', sessionId: 'ses_1', seq: log.length + 1,
      fromLearnerId: 'kid2', toLearnerId: 'kid3', reviewedBy: 'parent', reason: 'it was kid3 after all' });
    expect(reduceSession(log)).toMatchObject({ learnerId: 'kid3', rewardPaidTo: 'kid2' });

    // Retracted: the 5 comes back off kid2, who is holding it — not off kid3.
    const retract = new RetractSessionGradeAdjustment({
      sessions: { readEvents: async () => log.map((e) => ({ ...e })),
        appendEvent: async (sessionId, event) => { const stored = { ...event, sessionId, seq: log.length + 1 }; log.push(stored); return stored; } },
      teacherGate: { assert: vi.fn() }, economy,
      curriculum: { getUnit: vi.fn(async () => ({ reward: { amount: 5 } })) },
      economyEnabled: true, clock: () => new Date('2026-08-03T12:00:00.000Z'), logger: { info() {}, warn() {} },
    });
    await retract.execute({ sessionId: 'ses_1', adjustmentId: 'adj_up',
      reason: 'the correction was wrong', retractedBy: 'parent', baseSeq: log.length, apply: true });
    expect(economy.adjust).toHaveBeenLastCalledWith('kid2', expect.objectContaining({ delta: -5 }));
    expect(economy.adjust.mock.calls.map(([learnerId]) => learnerId)).not.toContain('kid3');
    // Balance back to zero: held by nobody, so the next credit is free to
    // follow the work rather than chasing a stale name.
    expect(reduceSession(log)).toMatchObject({ rewardAmount: 0, rewardPaidTo: null });
  });
});

/**
 * A VOIDED QUESTION IS NOT A WRONG ANSWER.
 *
 * A void leaves the denominator when the sheet is graded (`GradeSubmission`'s
 * `markable`), but it never leaves the PRINTED sheet, so a correction still
 * sees it in the roster — and the correction UI offers no `void` option, so a
 * grown-up correcting some OTHER question leaves it on `unchanged`. Scoring
 * that as missed turns a 6-of-8 into a 7-of-9, which is a wrong grade, a wrong
 * pass/fail, and a coin reversal against a child who passed.
 */
describe('AdjustSessionGrade with a voided question', () => {
  const NINE = Array.from({ length: 9 }, (_, i) => `q${i + 1}`);

  // Graded 6 of 8: nine printed, q3 voided, q5 marked wrong by the machine.
  const gradedWithVoid = () => [
    { type: 'created', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_v', seq: 1, learnerId: 'kid', unitId: 'math' },
    { type: 'issued', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_v', seq: 2, artifactId: 'art_v' },
    { type: 'submitted', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_v', seq: 3, transport: 'paper' },
    { type: 'graded', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_v', seq: 4, attemptIds: ['att_v'],
      percent: 75, passingPercent: 80, correctCount: 6, totalCount: 8,
      missedItemIds: ['q5', 'q7'], voidedItemIds: ['q3'] },
    { type: 'outcome_recorded', at: '2026-08-01T10:04:00.000Z', sessionId: 'ses_v', seq: 5,
      outcomeId: 'out_v', result: 'needs_remediation' },
  ];

  const evidenceWithVoid = () => NINE.map((itemId) => ({
    itemId,
    verdict: itemId === 'q3' ? 'void' : (['q5', 'q7'].includes(itemId) ? 'incorrect' : 'correct'),
  }));

  function build({ log = gradedWithVoid(), evidence = evidenceWithVoid(), economy = null, curriculum = null } = {}) {
    const sessions = {
      readEvents: vi.fn(async () => log.map((event) => ({ ...event }))),
      appendEvent: vi.fn(async (sessionId, event) => {
        const stored = { ...event, sessionId, seq: log.length + 1 };
        log.push(stored);
        return stored;
      }),
    };
    const adjust = new AdjustSessionGrade({
      sessions, teacherGate: { assert: vi.fn() },
      worksheetInstances: { findBySession: vi.fn(async () => ({ itemIds: NINE })) },
      reviewQueue: { listForSession: vi.fn(async () => evidence) },
      economy, curriculum, economyEnabled: Boolean(economy),
      clock: () => new Date('2026-08-02T12:00:00.000Z'), logger: { info() {}, warn() {} },
    });
    return { log, sessions, adjust };
  }

  const allUnchangedExcept = (overrides = {}) => NINE.map((itemId) => ({
    itemId, verdict: overrides[itemId] ?? 'unchanged',
  }));

  it('keeps a still-unmarkable question out of the denominator when a different answer is corrected', async () => {
    const { adjust } = build();
    const result = await adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v', reason: 'q5 was right after all', adjustedBy: 'parent',
      baseSeq: 5, itemVerdicts: allUnchangedExcept({ q5: 'correct' }),
    });
    // 7 of 8, not 7 of 9. q3 was unmarkable at grading and nobody re-marked it.
    expect(result.effectiveGrade).toMatchObject({ correctCount: 7, totalCount: 8, percent: 87.5 });
    expect(result.effectiveGrade.missedItemIds).toEqual(['q7']);
    expect(result.effectiveGrade.missedItemIds).not.toContain('q3');
  });

  it('un-voids a question a grown-up finally marks, restoring the denominator', async () => {
    const { adjust } = build();
    const result = await adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v2', reason: 'the tear was readable after all',
      adjustedBy: 'parent', baseSeq: 5, itemVerdicts: allUnchangedExcept({ q3: 'incorrect' }),
    });
    expect(result.effectiveGrade).toMatchObject({ correctCount: 6, totalCount: 9 });
    expect(result.effectiveGrade.missedItemIds).toContain('q3');
  });

  it('clears the void stamp for a re-marked question and keeps it for the rest', async () => {
    const { log, adjust } = build();
    await adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v3', reason: 'readable after all', adjustedBy: 'parent',
      baseSeq: 5, itemVerdicts: allUnchangedExcept({ q3: 'correct' }), apply: true,
    });
    // The record must not assert both that q3 was unmarkable and that a
    // grown-up marked it.
    expect(reduceSession(log).voidedItemIds).toEqual([]);

    const untouched = build();
    await untouched.adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v4', reason: 'q5 was right', adjustedBy: 'parent',
      baseSeq: 5, itemVerdicts: allUnchangedExcept({ q5: 'correct' }), apply: true,
    });
    expect(reduceSession(untouched.log).voidedItemIds).toEqual(['q3']);
  });

  it('does not claw back coins from a child whose corrected score clears the bar', async () => {
    // Paid 10 on a pass would be the wrong shape here; this session failed and
    // paid nothing, so the correct reconciliation is a CREDIT, not a debit.
    // The regression is that scoring q3 wrong holds the percent below the bar
    // and no reward is owed at all.
    const economy = { adjust: vi.fn(async (_learnerId, args) => ({ txnId: `txn:${args.ref}` })) };
    const curriculum = { getUnit: vi.fn(async () => ({ reward: { amount: 10 }, passing: { percent: 80 } })) };
    const { log, adjust } = build({ economy, curriculum });
    const result = await adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v5', reason: 'q5 was right after all', adjustedBy: 'parent',
      baseSeq: 5, itemVerdicts: allUnchangedExcept({ q5: 'correct' }), apply: true,
    });
    // 87.5% clears an 80% bar; 7-of-9 (77.78%) would not have.
    expect(result.outcome).toMatchObject({ result: 'passed' });
    expect(reduceSession(log).outcome).toMatchObject({ result: 'passed' });
  });

  it('refuses a correction that would leave nothing markable rather than recording 0 of 0', async () => {
    const evidence = NINE.map((itemId) => ({ itemId, verdict: 'void' }));
    const { adjust } = build({ evidence });
    await expect(adjust.execute({
      sessionId: 'ses_v', adjustmentId: 'adj_v6', reason: 'nothing readable', adjustedBy: 'parent',
      baseSeq: 5, itemVerdicts: allUnchangedExcept(),
    })).rejects.toThrow(/nothing left to score/);
  });
});
