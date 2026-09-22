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
  it('refreshes agenda and completion only after persisting a correction', async () => {
    const f = fixture();
    const realtime = { sessionGradeChanged: vi.fn(async () => {
      expect(f.events.at(-1).type).toBe('grade_adjusted');
    }) };
    const adjust = new AdjustSessionGrade({ sessions: f.sessions, teacherGate: f.teacherGate, realtime });
    const args = { sessionId: 'ses_1', percent: 100, reason: 'scan fault', adjustedBy: 'parent' };
    await adjust.execute(args);
    expect(realtime.sessionGradeChanged).not.toHaveBeenCalled();
    await adjust.execute({ ...args, apply: true });
    expect(realtime.sessionGradeChanged).toHaveBeenCalledWith({ learnerId: 'kid', sessionId: 'ses_1' });
  });
  it('stamps the course passing rule when correcting an older grade without a threshold', async () => {
    const f = fixture();
    delete f.events.find(e => e.type === 'graded').passingPercent;
    const adjust = new AdjustSessionGrade({ sessions: f.sessions, teacherGate: f.teacherGate,
      curriculum: { getUnit: async () => ({ passing: { percent: 80 } }) } });
    const receipt = await adjust.execute({ sessionId: 'ses_1', percent: 100,
      reason: 'extra scanner column', adjustedBy: 'parent', apply: true });
    expect(receipt.outcome.result).toBe('passed');
    expect(receipt.machineGrade.passingPercent).toBeNull();
    expect(f.events.at(-1)).toMatchObject({ type: 'grade_adjusted', passingPercent: 80 });
    const state = reduceSession(f.events);
    expect(state.gradedPassingPercent).toBe(80);
    expect(state.errors).toEqual([]);
    await f.retract.execute({ sessionId: 'ses_1', adjustmentId: receipt.adjustmentId,
      reason: 'test retraction', retractedBy: 'parent', apply: true });
    expect(reduceSession(f.events).outcome.result).toBe('needs_remediation');
    expect(reduceSession(f.events).gradedPassingPercent).toBeNull();
  });
  it('preserves the machine threshold over current course rules and overrides', async () => {
    const f = fixture();
    const adjust = new AdjustSessionGrade({ sessions: f.sessions, teacherGate: f.teacherGate,
      passOverrides: { percentFor: () => 50 },
      curriculum: { getUnit: async () => ({ passing: { percent: 50 } }) } });
    const receipt = await adjust.execute({ sessionId: 'ses_1', percent: 70,
      reason: 'corrected marks', adjustedBy: 'parent' });
    expect(receipt.outcome.result).toBe('needs_remediation');
  });
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

/**
 * A KEY-ALIGNMENT-SUSPECTED ENTRY IS NOT A QUESTION (whole-branch review,
 * finding #1). The same denominator leak Task 3 fixed in
 * `GradeSubmission.mjs` reappears here: for a print unit there is usually
 * no worksheet instance, so `#normalizeItemVerdicts`' roster falls back to
 * `evidence.map((item) => item.itemId)` — the review queue's raw itemIds —
 * which can carry the synthetic `key-alignment` entry the OMR key-alignment
 * check enqueues. This is the EXACT branch `AdjustSessionGrade.mjs:197-199`
 * is reachable on: a teacher using "Fix a marked answer" on a session that
 * had a key-alignment hold.
 */
describe('AdjustSessionGrade with a key-alignment-suspected queue entry (no worksheet instance)', () => {
  const SIX = Array.from({ length: 6 }, (_, i) => `q${i + 1}`);

  // Graded 6 of 6 — the exact shape `GradeSubmission.mjs`'s own
  // key-alignment denominator fix produces once a teacher resolves the
  // synthetic entry (paperWork.test.mjs: "excludes a key-alignment-suspected
  // queue entry from the print-unit denominator").
  const gradedSixOfSix = () => [
    { type: 'created', at: '2026-09-21T10:00:00.000Z', sessionId: 'ses_ka', seq: 1, learnerId: 'kid', unitId: 'science' },
    { type: 'issued', at: '2026-09-21T10:01:00.000Z', sessionId: 'ses_ka', seq: 2, artifactId: 'card-1' },
    { type: 'submitted', at: '2026-09-21T10:02:00.000Z', sessionId: 'ses_ka', seq: 3, transport: 'paper' },
    { type: 'graded', at: '2026-09-21T10:03:00.000Z', sessionId: 'ses_ka', seq: 4, attemptIds: ['att_1'],
      percent: 100, passingPercent: 80, correctCount: 6, totalCount: 6 },
  ];

  // The review queue's real shape: six machine-marked rows plus one
  // synthetic key-alignment entry — resolved with a truth-value verdict
  // (`correct`), the natural, wrong gesture a teacher might make instead of
  // voiding it.
  const evidenceWithSyntheticEntry = () => [
    ...SIX.map((itemId) => ({ itemId, verdict: 'correct', reason: 'machine' })),
    { itemId: 'key-alignment', verdict: 'correct', reason: 'key-alignment-suspected' },
  ];

  // No `worksheetInstances` wired at all — a print unit ordinarily mints no
  // worksheet instance (that's a bank-select shape), so this is exactly the
  // "evidence-roster, no worksheet instance" configuration the finding names.
  function build({ log = gradedSixOfSix(), evidence = evidenceWithSyntheticEntry() } = {}) {
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
      reviewQueue: { listForSession: vi.fn(async () => evidence) },
      clock: () => new Date('2026-09-21T12:00:00.000Z'), logger: { info() {}, warn() {} },
    });
    return { log, adjust };
  }

  const sixCorrectExcept = (overrides = {}) => SIX.map((itemId) => ({
    itemId, verdict: overrides[itemId] ?? 'unchanged',
  }));

  it('keeps the denominator at 6, not 7 — the synthetic entry never becomes a printed question', async () => {
    const { adjust } = build();
    // Not supplying a verdict for 'key-alignment' proves the roster excludes
    // it: `#normalizeItemVerdicts` throws "a verdict is required for printed
    // item {itemId}" for every roster entry with no supplied verdict, so this
    // would throw for 'key-alignment' if the bug were still present.
    const result = await adjust.execute({
      sessionId: 'ses_ka', adjustmentId: 'adj_ka', reason: 'q3 was actually wrong', adjustedBy: 'parent',
      baseSeq: 4, itemVerdicts: sixCorrectExcept({ q3: 'incorrect' }),
    });
    // 5 of 6 (83.33%), never 5 of 7 (71.43%) — the synthetic entry counted
    // as neither a printed question nor a missed one.
    expect(result.effectiveGrade).toMatchObject({ correctCount: 5, totalCount: 6, percent: 83.33 });
    expect(result.effectiveGrade.missedItemIds).toEqual(['q3']);
    expect(result.effectiveGrade.missedItemIds).not.toContain('key-alignment');
  });
});
