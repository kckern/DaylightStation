// @vitest-environment node
// A session settled away from the tablet (fitness, a TV launch, the review
// queue) tells the tablet a lesson is done, so the child sees it there. The
// scanner has its own banner and opts out; a recovery and a resettle are not
// news.
import { it, expect, vi } from 'vitest';
import { CloseSessionOutcome } from "./CloseSessionOutcome.mjs";

const at = '2026-10-01T12:00:00Z';
const unit = { unitId: 'k.1', title: 'Two-digit subtraction', passing: { percent: 80 } };

function fixture({ percent = 100 } = {}) {
  const events = [
    { type: 'created', at, sessionId: 's1', learnerId: 'test-learner', unitId: unit.unitId, studyDay: '2026-10-01' },
    { type: 'issued', at, artifactId: 'a' }, { type: 'submitted', at, transport: 'paper' },
    { type: 'graded', at, percent, attemptIds: ['a1'] },
  ];
  events.forEach((event, i) => { event.seq = i + 1; event.sessionId = 's1'; });
  const realtime = { sessionOutcomeRecorded: vi.fn(), workCompleted: vi.fn() };
  const close = new CloseSessionOutcome({
    receipts: { print: vi.fn(async () => ({ printed: true })) },
    receiptCapture: { execute: vi.fn(async () => ({ artifact: { manifest: { artifactId: 'r' } } })) },
    tokens: { put: async () => {} }, grownUps: {},
    planProjection: { project: async () => ({ plan: { entries: [], available: [] }, sections: [], projection: { assignment: {}, units: [unit], sessions: [], works: [], nowIso: at } }) },
    curriculum: { getUnit: async () => unit }, assignments: { get: async () => ({}) },
    sessions: { readEvents: async () => events, listForLearner: async () => [], appendEvent: async (_, e) => { events.push({ ...e, seq: events.length + 1 }); } },
    realtime, clock: () => new Date('2026-10-01T13:00:00Z'),
  });
  return { close, realtime, events };
}

it('a passed first settle tells the tablet once, naming the lesson', async () => {
  const f = fixture();
  await f.close.execute({ sessionId: 's1' });
  expect(f.realtime.workCompleted).toHaveBeenCalledTimes(1);
  expect(f.realtime.workCompleted.mock.calls[0][0]).toMatchObject({
    learnerId: 'test-learner', sessionId: 's1', unitId: 'k.1', title: 'Two-digit subtraction',
  });
});

it('a settle the caller opts out of (the scanner) says nothing', async () => {
  const f = fixture();
  await f.close.execute({ sessionId: 's1', announce: false });
  expect(f.realtime.workCompleted).not.toHaveBeenCalled();
});

it('a failed settle, and a repeat close of the same session, say nothing', async () => {
  const failed = fixture({ percent: 10 });
  await failed.close.execute({ sessionId: 's1' });
  expect(failed.realtime.workCompleted).not.toHaveBeenCalled();
  const repeat = fixture();
  await repeat.close.execute({ sessionId: 's1' });
  await repeat.close.execute({ sessionId: 's1' });
  expect(repeat.realtime.workCompleted).toHaveBeenCalledTimes(1);
});

it('a broken announcement never fails the settle', async () => {
  const f = fixture();
  f.realtime.workCompleted.mockImplementation(() => { throw new Error('bus down'); });
  await expect(f.close.execute({ sessionId: 's1' })).resolves.toBeTruthy();
  expect(f.events.some((e) => e.type === 'outcome_recorded')).toBe(true);
});
