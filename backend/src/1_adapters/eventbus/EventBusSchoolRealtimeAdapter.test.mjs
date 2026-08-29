import { describe, expect, it, vi } from 'vitest';
import { EventBusSchoolRealtimeAdapter } from './EventBusSchoolRealtimeAdapter.mjs';
import { decodeQuizSheet } from '#apps/quizzes/quizScanRecorder.mjs';

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
    expect(calls).toEqual([
      { method: 'publish', topic: 'school.language.day-complete', payload: { learnerId: 'kid1' } },
      { method: 'publish', topic: 'school.session.outcome-recorded', payload: { learnerId: 'kid1', result: 'passed' } },
      { method: 'broadcast', topic: 'school', payload: { event: 'story-read', learnerId: 'kid1' } },
    ]);
  });

  it('decodes every print-sheet mark through the exact legacy form contract', async () => {
    const bus = busDouble();
    const gateway = new EventBusSchoolRealtimeAdapter({ eventBus: bus });
    const received = [];
    gateway.onPrintSheet({ scanners: { study: { topic: 'omr-study' } } }, (sheet) => received.push(sheet));
    const marks = [1 << 8, 1 << 7, (1 << 6) | (1 << 5), 0, 1 << 4, 1 << 3, 1 << 2, 1 << 10, 1 << 4];
    await bus.handlers.get('omr-study')({ event: 'sheet', marks });
    expect(received).toEqual([decodeQuizSheet(marks)]);
    expect([...bus.handlers.keys()]).toEqual(['omr', 'omr-study']);
  });
});
