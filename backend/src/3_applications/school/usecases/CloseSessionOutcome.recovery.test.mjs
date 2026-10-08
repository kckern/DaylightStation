// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { CloseSessionOutcome } from './CloseSessionOutcome.mjs';
const at = '2026-10-01T12:00:00Z';
const unit = { unitId: 'k.1', passing: { percent: 100 } };
function fixture({ originalComplete = true, currentComplete = true, invalidated = false } = {}) {
  const events = [
    { type: 'created', at, sessionId: 's1', learnerId: 'test-learner', unitId: unit.unitId },
    { type: 'practice_prepared', at, assessment: { practice: { deckId: 'k/1', questionCards: { q1: { cardIds: ['a'] } } }, questionIds: ['q1'] } },
    { type: 'issued', at, artifactId: 'a' }, { type: 'submitted', at, transport: 'paper' },
    { type: 'graded', at, percent: 100, attemptIds: ['a1'] },
    { type: 'outcome_recorded', at, outcomeId: 'out:s1', result: 'needs_remediation', reason: 'course_questions_unresolved' },
    ...(invalidated ? [{ type: 'evidence_invalidated', at: '2026-10-02T12:00:00Z', reason: 'invalid', attemptIds: ['a1'], invalidationId: 'inv1', invalidatedBy: 'teacher' }] : []),
  ];
  events.forEach((event, i) => { event.seq = i + 1; event.sessionId = 's1'; });
  const get = vi.fn(async ({ historyUntil }) => ({ stage: (historyUntil ? originalComplete : currentComplete) ? 'completed' : 'review' }));
  const receiptCapture = { execute: vi.fn(async () => ({ artifact: { manifest: { artifactId: 'old-fail' } } })) };
  const receipts = { print: vi.fn(async () => ({ printed: true })) };
  const close = new CloseSessionOutcome({ receipts, receiptCapture, tokens: { put: async () => {} }, grownUps: {}, planProjection: { project: async () => ({ plan: { entries: [], available: [] }, sections: [], projection: { assignment: {}, units: [unit], sessions: [], works: [], nowIso: at } }) }, curriculum: { getUnit: async () => unit }, assignments: { get: async () => ({}) },
    sessions: { readEvents: async () => events, listForLearner: async () => [], appendEvent: async (_, e, options = {}) => { if (options.expectedSeq != null && options.expectedSeq !== events.length) throw new Error('stale_revision'); events.push({ ...e, seq: events.length + 1 }); } },
    practiceAssessments: { get }, clock: () => new Date('2026-10-07T12:00:00Z') });
  return { close, events, get, receipts, receiptCapture };
}
it('previews only originally and currently academically complete pause outcomes without mutation', async () => {
  const f = fixture();
  expect(await f.close.recoverCourseOutcome({ sessionId: 's1' })).toMatchObject({ eligible: true, applied: false });
  expect(f.events).toHaveLength(6);
  expect(f.get.mock.calls[0][0].historyUntil).toBe('2026-10-01T12:00:00.001Z');
});
it.each([{ originalComplete: false }, { currentComplete: false }, { invalidated: true }])('refuses ineligible recovery %j', async (options) => {
  expect(await fixture(options).close.recoverCourseOutcome({ sessionId: 's1' })).toMatchObject({ eligible: false, applied: false });
});

it('applies once through ordinary settlement and rewards remain idempotent', async () => {
  const f = fixture();
  const applied = await f.close.recoverCourseOutcome({ sessionId: 's1', apply: true });
  expect(applied).toMatchObject({ eligible: true, applied: true, settlement: { printed: false, printReason: 'recovery-no-print', document: null, receiptArtifactId: null } });
  expect(f.receipts.print).not.toHaveBeenCalled();
  expect(f.receiptCapture.execute).not.toHaveBeenCalled();
  expect(f.events.some((e) => e.type === 'result_receipt_captured')).toBe(false);
  expect(f.events.filter((e) => e.type === 'outcome_recorded')).toHaveLength(2);
  expect(await f.close.recoverCourseOutcome({ sessionId: 's1', apply: true })).toMatchObject({ eligible: false, applied: false });
  expect(f.events.filter((e) => e.type === 'outcome_recorded')).toHaveLength(2);
});

it('coalesces concurrent recovery apply to one corrective outcome', async () => {
  const f = fixture();
  await Promise.all([f.close.recoverCourseOutcome({ sessionId: 's1', apply: true }), f.close.recoverCourseOutcome({ sessionId: 's1', apply: true })]);
  expect(f.events.filter((e) => e.type === 'outcome_recorded')).toHaveLength(2);
  expect(f.events.filter((e) => e.type === 'rewarded')).toHaveLength(1);
});
it.each(['grade_adjusted', 'evidence_invalidated'])('rejects %s appended while eligibility is being checked', async (type) => {
  const f = fixture();
  f.get.mockImplementationOnce(async () => {
    f.events.push({ type, at, sessionId: 's1', seq: f.events.length + 1, attemptIds: ['a1'], invalidationId: 'inv1', invalidatedBy: 'teacher',
      percent: 0, adjustmentId: 'adj1', adjustedBy: 'teacher', reason: 'corrected', missedItemIds: ['q1'] });
    return { stage: 'completed' };
  });
  await expect(f.close.recoverCourseOutcome({ sessionId: 's1', apply: true })).rejects.toThrow(/stale_revision/);
  expect(f.events.filter((e) => e.type === 'outcome_recorded')).toHaveLength(1);
});
