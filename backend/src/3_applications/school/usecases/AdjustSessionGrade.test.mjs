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
