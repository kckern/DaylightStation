import { describe, it, expect } from 'vitest';
import {
  outcomeIdFor, evaluateOutcome, rewardDecision, companionVetoStatus,
} from '#domains/school/sessions/outcome.mjs';

const SID = 'ses_abc123';
const OUT = `out:${SID}`;

describe('outcomeIdFor', () => {
  it('is the deterministic `out:{sessionId}` id used as the economy ref', () => {
    expect(outcomeIdFor(SID)).toBe(OUT);
    expect(outcomeIdFor(SID)).toBe(outcomeIdFor(SID));
  });

  it('returns null for a missing or non-string session id rather than minting "out:undefined"', () => {
    expect(outcomeIdFor(undefined)).toBe(null);
    expect(outcomeIdFor('')).toBe(null);
    expect(outcomeIdFor(7)).toBe(null);
  });

  it('is already-prefixed-safe: an outcome id is never double-wrapped', () => {
    expect(outcomeIdFor(OUT)).toBe(OUT);
  });
});

describe('evaluateOutcome', () => {
  const evaluate = (over = {}) => evaluateOutcome({
    gradedPercent: 90, passingPercent: 80, requiresSignoff: false, signedOff: false, ...over,
  });

  it('passes when the score meets the passing rule', () => {
    expect(evaluate()).toEqual({ result: 'passed', reason: 'met_passing' });
  });

  it('passes on an exact match — the passing percent is inclusive', () => {
    expect(evaluate({ gradedPercent: 80 }).result).toBe('passed');
  });

  it('needs remediation below the passing rule', () => {
    expect(evaluate({ gradedPercent: 79 })).toEqual({ result: 'needs_remediation', reason: 'below_passing' });
  });

  it('needs remediation when nothing has been graded yet', () => {
    expect(evaluate({ gradedPercent: null })).toEqual({ result: 'needs_remediation', reason: 'not_graded' });
    expect(evaluate({ gradedPercent: 'A+' }).reason).toBe('not_graded');
    expect(evaluate({ gradedPercent: NaN }).reason).toBe('not_graded');
  });

  it('needs remediation when the unit declares no passing rule — a score with no bar cannot pass itself', () => {
    expect(evaluate({ passingPercent: null })).toEqual({ result: 'needs_remediation', reason: 'no_passing_policy' });
    expect(evaluate({ passingPercent: 101 }).reason).toBe('no_passing_policy');
    expect(evaluate({ passingPercent: -1 }).reason).toBe('no_passing_policy');
  });

  it('is NOT passed while a required sign-off is missing, and the reason names it', () => {
    expect(evaluate({ requiresSignoff: true, signedOff: false }))
      .toEqual({ result: 'needs_remediation', reason: 'awaiting_signoff' });
  });

  it('passes once the required sign-off is in', () => {
    expect(evaluate({ requiresSignoff: true, signedOff: true })).toEqual({ result: 'passed', reason: 'met_passing' });
  });

  it('reports the score problem ahead of the sign-off when both apply', () => {
    expect(evaluate({ gradedPercent: 10, requiresSignoff: true, signedOff: false }).reason).toBe('below_passing');
  });

  it('never throws on a missing argument object', () => {
    expect(() => evaluateOutcome()).not.toThrow();
    expect(evaluateOutcome().result).toBe('needs_remediation');
  });

  // The companion gate (Task 10): a required read-along's finish code, filled
  // into a row on the answer card. It can only ever BLOCK a pass — never
  // subtract from a score, and never turn a fail into anything else.
  describe('the companion gate', () => {
    it('changes nothing at all for an ungated sheet — every worksheet in the house', () => {
      expect(evaluate({ companionGate: null }).result).toBe('passed');
      expect(evaluate({ companionGate: undefined }).result).toBe('passed');
    });

    it('passes a satisfied gate', () => {
      expect(evaluate({ companionGate: { status: 'satisfied' } }))
        .toEqual({ result: 'passed', reason: 'met_passing' });
    });

    it('blocks a passing score on a BLANK gate row', () => {
      expect(evaluate({ gradedPercent: 100, companionGate: { status: 'blank' } }))
        .toEqual({ result: 'needs_remediation', reason: 'companion_incomplete' });
    });

    it('blocks a passing score on a WRONG gate row, with its own reason', () => {
      expect(evaluate({ gradedPercent: 100, companionGate: { status: 'wrong' } }))
        .toEqual({ result: 'needs_remediation', reason: 'companion_code_wrong' });
    });

    it('blocks an EXHAUSTED gate row with a reason of its own — this sheet can never clear', () => {
      // Every bubble in the row is filled and the code is still wrong. Marks
      // cannot be erased, so no re-scan of this sheet can ever satisfy it, and
      // "check the letters and scan it again" is advice with no exit.
      expect(evaluate({ gradedPercent: 100, companionGate: { status: 'exhausted' } }))
        .toEqual({ result: 'needs_remediation', reason: 'companion_code_exhausted' });
    });

    it('reports the score problem ahead of the gate when both apply', () => {
      // That child owes a retry either way, and the retry prints a fresh gate
      // row with it. Sending them off to play audio for a sheet they have to
      // do again regardless is the wrong first instruction.
      expect(evaluate({ gradedPercent: 10, companionGate: { status: 'blank' } }).reason)
        .toBe('below_passing');
    });

    it('fails CLOSED on a status it cannot read — a gate this rule does not understand is not one it may wave through', () => {
      expect(evaluate({ companionGate: { status: 'probably-fine' } }).result).toBe('needs_remediation');
      expect(evaluate({ companionGate: {} }).result).toBe('needs_remediation');
    });

    it('is checked before the sign-off — a gated sheet is not "waiting on a grown-up", it is unfinished', () => {
      expect(evaluate({ companionGate: { status: 'blank' }, requiresSignoff: true, signedOff: false }).reason)
        .toBe('companion_incomplete');
    });
  });
});

describe('companionVetoStatus', () => {
  it('names the gate status behind a gate-vetoed reason, and nothing else', () => {
    expect(companionVetoStatus('companion_incomplete')).toBe('blank');
    expect(companionVetoStatus('companion_code_wrong')).toBe('wrong');
    expect(companionVetoStatus('companion_code_exhausted')).toBe('exhausted');
    expect(companionVetoStatus('below_passing')).toBeNull();
    expect(companionVetoStatus('met_passing')).toBeNull();
    expect(companionVetoStatus(null)).toBeNull();
  });
});

describe('rewardDecision', () => {
  const passed = { outcomeId: OUT, result: 'passed', signedOff: true };
  const decide = (over = {}) => rewardDecision({
    outcome: passed, unitReward: { amount: 5 }, existingRewardTxn: null, economyEnabled: true, ...over,
  });

  it('awards the unit amount against the outcome id as ref', () => {
    expect(decide()).toEqual({ award: true, amount: 5, ref: OUT, skipReason: null });
  });

  it('derives the ref from the session id when the outcome carries only that', () => {
    expect(decide({ outcome: { sessionId: SID, result: 'passed', signedOff: true } }).ref).toBe(OUT);
  });

  it('skips when the session already holds a reward transaction', () => {
    expect(decide({ existingRewardTxn: 'txn_1' }))
      .toEqual({ award: false, amount: 0, ref: OUT, skipReason: 'already_rewarded' });
  });

  it('skips when the household economy is off', () => {
    expect(decide({ economyEnabled: false }).skipReason).toBe('economy_disabled');
  });

  it('skips when the outcome did not pass', () => {
    expect(decide({ outcome: { ...passed, result: 'needs_remediation' } }).skipReason).toBe('outcome_not_passed');
    expect(decide({ outcome: null }).skipReason).toBe('outcome_not_passed');
  });

  it('skips when the unit declares no reward policy', () => {
    expect(decide({ unitReward: null }).skipReason).toBe('no_reward_policy');
    expect(decide({ unitReward: {} }).skipReason).toBe('no_reward_policy');
    expect(decide({ unitReward: { amount: 0 } }).skipReason).toBe('no_reward_policy');
    expect(decide({ unitReward: { amount: -5 } }).skipReason).toBe('no_reward_policy');
    expect(decide({ unitReward: { amount: '5' } }).skipReason).toBe('no_reward_policy');
  });

  it('skips when the unit requires a sign-off that has not happened', () => {
    expect(decide({ unitReward: { amount: 5, requiresSignoff: true }, outcome: { ...passed, signedOff: false } })
      .skipReason).toBe('awaiting_signoff');
    expect(decide({ unitReward: { amount: 5, requiresSignoff: true } }).award).toBe(true);
  });

  it('rounds a fractional policy amount down to whole coins', () => {
    expect(decide({ unitReward: { amount: 2.7 } }).amount).toBe(2);
    expect(decide({ unitReward: { amount: 0.4 } }).skipReason).toBe('no_reward_policy');
  });

  it('always reports a ref so a skip is still traceable in the log', () => {
    expect(decide({ economyEnabled: false }).ref).toBe(OUT);
  });

  it('never throws on a missing argument object', () => {
    expect(() => rewardDecision()).not.toThrow();
    expect(rewardDecision().award).toBe(false);
  });

  /**
   * The reason this module exists at all. EconomyService.earn()'s replay guard
   * reads only the CURRENT UTC day's ledger shard, so the identical ref pays
   * again tomorrow. School's own durable record is the guard that actually
   * closes the gap.
   */
  describe('cross-day double-pay', () => {
    it('blocks a re-award of the same outcome on a later day, when the economy no longer would', () => {
      // Day 1: the outcome is reached and paid; the txn id lands on the session.
      const day1 = decide({ existingRewardTxn: null });
      expect(day1).toEqual({ award: true, amount: 5, ref: OUT, skipReason: null });

      // Day 2: the same outcome is replayed (a re-scan, a retried close-out, a
      // reconciliation job). The economy's per-UTC-day guard sees an empty
      // shard for today and would pay again — School's record does not.
      const day2 = decide({ existingRewardTxn: day1.ref && 'txn_from_day_1' });
      expect(day2.award).toBe(false);
      expect(day2.skipReason).toBe('already_rewarded');
      expect(day2.amount).toBe(0);
    });

    it('blocks the replay before any other consideration, including a policy that has since changed', () => {
      // Amount raised and sign-off added after the fact: the answer is still no.
      const replay = decide({
        existingRewardTxn: 'txn_from_day_1',
        unitReward: { amount: 50, requiresSignoff: true },
        outcome: { ...passed, signedOff: false },
      });
      expect(replay).toEqual({ award: false, amount: 0, ref: OUT, skipReason: 'already_rewarded' });
    });

    it('holds even when the economy has been switched off since the payout', () => {
      expect(decide({ existingRewardTxn: 'txn_1', economyEnabled: false }).skipReason).toBe('already_rewarded');
    });
  });
});
