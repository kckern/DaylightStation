import { describe, expect, it, vi } from 'vitest';
import { effectiveAttempts } from '#domains/school/attempt.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { InvalidateSessionEvidence } from './InvalidateSessionEvidence.mjs';

const SESSION = 'ses_wrong_sheet';
const events = () => [
  { type: 'created', at: '2026-08-31T10:00:00.000Z', sessionId: SESSION, learnerId: 'milo', unitId: 'math-1', seq: 1 },
  { type: 'issued', at: '2026-08-31T10:01:00.000Z', sessionId: SESSION, artifactId: 'math/ws', confirmed: true, seq: 2 },
  { type: 'submitted', at: '2026-08-31T10:10:00.000Z', sessionId: SESSION, transport: 'paper', seq: 3 },
  { type: 'graded', at: '2026-08-31T10:10:00.000Z', sessionId: SESSION,
    attemptIds: ['att_1', 'att_2'], percent: 50, correctCount: 1, totalCount: 2,
    missedItemIds: ['q2'], seq: 4 },
  { type: 'outcome_recorded', at: '2026-08-31T10:10:01.000Z', sessionId: SESSION,
    outcomeId: `out:${SESSION}`, result: 'needs_remediation', reason: 'below_passing', seq: 5 },
  { type: 'remediation_opened', at: '2026-08-31T10:11:00.000Z', sessionId: SESSION,
    newSessionId: 'ses_retry', variant: 1, seq: 6 },
];

function fixture() {
  const log = events();
  const attempts = ['att_1', 'att_2'].map((id, index) => ({
    id, at: '2026-08-31T10:10:00.000Z', sessionId: SESSION, bankId: 'math/ws@rev',
    itemId: `q${index + 1}`, itemType: 'multiple_choice', mode: 'quiz', given: 'B',
    correct: index === 0, attributedTo: 'milo', transport: 'paper', learning: {},
  }));
  return {
    log,
    attempts,
    sessions: {
      readEvents: vi.fn(async () => structuredClone(log)),
      appendEvent: vi.fn(async (_sessionId, event) => { log.push(structuredClone(event)); }),
    },
    datastore: {
      readAllAttempts: vi.fn(() => structuredClone(attempts)),
      appendAttempt: vi.fn((_learnerId, attempt) => { attempts.push(structuredClone(attempt)); }),
    },
    teacherGate: { assert: vi.fn() },
  };
}

describe('InvalidateSessionEvidence', () => {
  it('previews without changing the append-only ledgers', async () => {
    const f = fixture();
    const result = await new InvalidateSessionEvidence({
      ...f, clock: () => new Date('2026-08-31T18:00:00.000Z'),
    }).execute({ sessionId: SESSION, reason: 'scripture bubbles landed on math', invalidatedBy: 'parent' });
    expect(result).toMatchObject({ applied: false, attemptIds: ['att_1', 'att_2'], effectiveGrade: null });
    expect(f.attempts).toHaveLength(2);
    expect(f.log).toHaveLength(6);
  });

  it('appends tombstones and projects the settled session as voided without erasing machine evidence', async () => {
    const f = fixture();
    const useCase = new InvalidateSessionEvidence({
      ...f, clock: () => new Date('2026-08-31T18:00:00.000Z'),
    });
    const request = { sessionId: SESSION, reason: 'scripture bubbles landed on math', invalidatedBy: 'parent', apply: true };
    const result = await useCase.execute(request);
    expect(result).toMatchObject({ applied: true, attemptIds: ['att_1', 'att_2'] });
    expect(f.attempts).toHaveLength(4);
    expect(effectiveAttempts(f.attempts)).toEqual([]);
    const state = reduceSession(f.log);
    expect(state).toMatchObject({
      evidenceInvalidated: true,
      machineGrade: { percent: 50 },
      gradedPercent: null,
      outcome: { result: 'voided', reason: 'evidence_invalidated' },
    });

    const repeated = await useCase.execute({ ...request, invalidationId: result.invalidationId });
    expect(repeated).toMatchObject({ applied: true, idempotent: true });
    expect(f.attempts).toHaveLength(4);
    expect(f.log).toHaveLength(7);
  });

  it('accepts only the exact in-process authority object for a composed recovery', async () => {
    const f = fixture();
    const authority = Object.freeze({ scope: 'recovery' });
    f.teacherGate.assert.mockImplementation(() => { throw new Error('teacher gate should not run'); });
    const useCase = new InvalidateSessionEvidence({
      ...f, trustedAuthority: authority,
      clock: () => new Date('2026-08-31T18:00:00.000Z'),
    });
    await expect(useCase.execute({
      sessionId: SESSION, reason: 'wrong worksheet', invalidatedBy: 'parent',
    }, { authority: {} })).rejects.toThrow(/teacher gate/);
    await expect(useCase.execute({
      sessionId: SESSION, reason: 'wrong worksheet', invalidatedBy: 'parent',
    }, { authority })).resolves.toMatchObject({ applied: false, attemptIds: ['att_1', 'att_2'] });
  });
});
