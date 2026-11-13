import { describe, expect, it, vi } from 'vitest';
import { EventBusSchoolRealtimeAdapter } from "./EventBusSchoolRealtimeAdapter.mjs";
import { decodeQuizSheet } from "../../application/quizzes/quizScanRecorder.mjs";

function busDouble() {
  const handlers = new Map();
  const sent = [];
  return {
    handlers,
    sent,
    subscribe(topic, handler) { handlers.set(topic, handler); return () => handlers.delete(topic); },
    broadcast(topic, payload) { sent.push({ topic, payload }); },
  };
}

describe('EventBusSchoolRealtimeAdapter', () => {
  it('filters shared DoNow traffic and exposes only approved School dispatch facts', async () => {
    const bus = busDouble();
    const handler = vi.fn();
    new EventBusSchoolRealtimeAdapter({ eventBus: bus }).onApprovedLaunchDispatched(handler);
    await bus.handlers.get('donow')({ type: 'donow.dispatched', approved: false, requestedBy: 'school-scan', ref: 's1' });
    await bus.handlers.get('donow')({ type: 'donow.dispatched', approved: true, requestedBy: 'school-scan', ref: 's1', surface: 'portal', approvalId: 'a1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sessionId: 's1', surface: 'portal', approvalId: 'a1' });
  });

  it('keeps the established reading and ceremony wire envelopes exact', () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    gateway.readingRoomChanged('livingroom', { kind: 'session-open', learnerId: 'kid1' });
    gateway.schoolCeremony({ learnerId: 'kid1', lesson: 'Lesson 7' });
    expect(bus.sent).toEqual([
      { topic: 'reading:livingroom', payload: { event: 'session-open', learnerId: 'kid1' } },
      { topic: 'school', payload: { event: 'piano-lesson-complete', learnerId: 'kid1', lesson: 'Lesson 7' } },
    ]);
  });

  it('keeps internal facts internal while presentation announcements broadcast', () => {
    const calls = [];
    const eventBus = {
      subscribe() { return () => {}; },
      publish(topic, payload) { calls.push({ method: 'publish', topic, payload }); },
      broadcast(topic, payload) { calls.push({ method: 'broadcast', topic, payload }); },
    };
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus });
    gateway.languageDayCompleted({ learnerId: 'kid1' });
    gateway.sessionOutcomeRecorded({ learnerId: 'kid1', result: 'passed' });
    gateway.storyReadRecorded({ learnerId: 'kid1' });
    gateway.printedActivityScanned({ learnerId: 'kid1', corpusId: 'beeloo:maze' });
    expect(calls).toEqual([
      { method: 'publish', topic: 'school.language.day-complete', payload: { learnerId: 'kid1' } },
      { method: 'publish', topic: 'school.session.outcome-recorded', payload: { learnerId: 'kid1', result: 'passed' } },
      { method: 'broadcast', topic: 'school', payload: { event: 'story-read', learnerId: 'kid1' } },
      { method: 'broadcast', topic: 'school', payload: { event: 'printed-activity-complete', learnerId: 'kid1', corpusId: 'beeloo:maze' } },
    ]);
  });

  it('decodes every print-sheet mark through the exact legacy form contract', async () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    const received = [];
    gateway.onPrintSheet({ scanners: { study: { topic: 'omr-study' } } }, (sheet) => received.push(sheet));
    const marks = [1 << 8, 1 << 7, (1 << 6) | (1 << 5), 0, 1 << 4, 1 << 3, 1 << 2, 1 << 10, 1 << 4];
    while (marks.length < 32) marks.push(0);
    await bus.handlers.get('omr-study')({ event: 'sheet', marks });
    expect(received).toEqual([{ ...decodeQuizSheet(marks), device: 'omr-study' }]);
    expect([...bus.handlers.keys()]).toEqual(['omr', 'omr-study']);
  });
});


it('broadcasts authoritative assessment invalidations and subscribes completion to card facts', async () => {
  const bus = busDouble(), gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  const change = vi.fn(); gateway.onCompletionInputChanged(change);
  gateway.sessionOutcomeRecorded({ learnerId: 'kid', unitId: 'lesson', sessionId: 'session', result: 'passed' });
  expect(bus.sent).toContainEqual({ topic: 'school', payload: { event: 'assessment-changed', learnerId: 'kid', unitId: 'lesson', sessionId: 'session' } });
  gateway.sessionGradeChanged({ learnerId: 'kid', unitId: 'lesson', sessionId: 'session' });
  expect(bus.sent.filter(x => x.payload.event === 'assessment-changed')).toHaveLength(2);
  expect(bus.sent).toContainEqual({ topic: 'school.session.outcome-recorded', payload: { learnerId: 'kid', sessionId: 'session' } });
  gateway.sessionGradeChanged({ learnerId: 'kid', unitId: 'lesson', sessionId: 'session', studyDay: '2026-10-07' });
  expect(bus.sent).toContainEqual({ topic: 'school.session.outcome-recorded', payload: { learnerId: 'kid', sessionId: 'session', studyDay: '2026-10-07' } });
  const fact = { learnerId: 'kid', package: 'ko', deckId: 'deck', studyDay: '2026-10-07', doneAt: 'stamp', evidenceId: 'stable' };
  gateway.cardPracticeDayCompleted(fact);
  expect(bus.sent).toContainEqual({ topic: 'school.card-ladder.day-complete', payload: fact });
  await bus.handlers.get('school.card-ladder.day-complete')(fact);
  expect(change).toHaveBeenCalledWith(fact);
});

it("forwards the economy's coins-changed to the Portal's school topic, learner by learner", async () => {
  const bus = busDouble();
  const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  const unsubscribe = gateway.relayCoinsChanged();
  await bus.handlers.get('economy.coins-changed')({ userId: 'kid1', reason: 'mint' });
  await bus.handlers.get('economy.coins-changed')({ reason: 'mint' });
  expect(bus.sent).toEqual([{ topic: 'school', payload: { event: 'coins-changed', learnerId: 'kid1' } }]);
  unsubscribe();
  expect(bus.handlers.has('economy.coins-changed')).toBe(false);
});

it('a counted printed sheet is a completion input, so a day it finishes is noticed', async () => {
  const bus = busDouble();
  const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  const change = vi.fn(); gateway.onCompletionInputChanged(change);
  await bus.handlers.get('school')({ event: 'printed-activity-complete', learnerId: 'kid', corpusId: 'beeloo:maze' });
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'kid', event: 'printed-activity-complete' }));
});

it('an assessment change carries the study day of the session it settled', () => {
  const bus = busDouble();
  const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  gateway.sessionOutcomeRecorded({ learnerId: 'kid', unitId: 'u', sessionId: 's', result: 'passed', studyDay: '2026-11-13' });
  expect(bus.sent).toContainEqual({ topic: 'school', payload: { event: 'assessment-changed', learnerId: 'kid', unitId: 'u', sessionId: 's', studyDay: '2026-11-13' } });
});

it('a lesson finished away from the tablet is broadcast for its banner', () => {
  const bus = busDouble();
  const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  gateway.workCompleted({ learnerId: 'kid', sessionId: 's', unitId: 'u', title: 'Two-digit subtraction' });
  expect(bus.sent).toContainEqual({ topic: 'school', payload: { event: 'work-complete', learnerId: 'kid', sessionId: 's', unitId: 'u', title: 'Two-digit subtraction' } });
});

it('a finished video is broadcast and re-checks the day', async () => {
  const bus = busDouble();
  const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
  const change = vi.fn(); gateway.onCompletionInputChanged(change);
  gateway.mediaLessonCompleted({ learnerId: 'kid', sessionId: 's', unitId: 'u', title: 'T' });
  expect(bus.sent).toContainEqual({ topic: 'school', payload: { event: 'media-lesson-complete', learnerId: 'kid', sessionId: 's', unitId: 'u', title: 'T' } });
  await bus.handlers.get('school')({ event: 'media-lesson-complete', learnerId: 'kid' });
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'kid', event: 'media-lesson-complete' }));
});

describe('record-changed', () => {
  it('sends one broadcast per learner, and one household-wide one when no learner is named', () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    gateway.recordChanged({ learnerIds: ['a', 'b', 'a'], kind: 'reassign' });
    gateway.recordChanged({ learnerIds: [], kind: 'calendar' });
    expect(bus.sent.filter((x) => x.payload.event === 'record-changed').map((x) => x.payload)).toEqual([
      { event: 'record-changed', learnerId: 'a', kind: 'reassign' },
      { event: 'record-changed', learnerId: 'b', kind: 'reassign' },
      { event: 'record-changed', learnerId: null, kind: 'calendar' },
    ]);
  });

  it('an assignment change also reaches the tablet', () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    gateway.assignmentsChanged({ learnerId: 'kid' });
    expect(bus.sent).toContainEqual({ topic: 'school', payload: { event: 'record-changed', learnerId: 'kid', kind: 'assignments' } });
  });

  it('record-changed and book-log-changed re-check that learner\'s day; a household-wide change does not', async () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    const change = vi.fn(); gateway.onCompletionInputChanged(change);
    const school = bus.handlers.get('school');
    await school({ event: 'record-changed', learnerId: 'kid', kind: 'attestation' });
    await school({ event: 'book-log-changed', learnerId: 'kid' });
    await school({ event: 'record-changed', learnerId: null, kind: 'calendar' });
    expect(change.mock.calls.map(([fact]) => fact.event)).toEqual(['record-changed', 'book-log-changed']);
  });
});
