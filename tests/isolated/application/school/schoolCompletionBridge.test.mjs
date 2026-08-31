import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolCompletionBridge } from '#apps/school/SchoolCompletionBridge.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';

class FakeEventBus {
  constructor() { this.handlers = new Map(); }

  subscribe(topic, handler) {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  async emit(topic, payload) {
    await Promise.all((this.handlers.get(topic) ?? []).map((h) => h(payload)));
  }

  subscriberCount(topic) { return (this.handlers.get(topic) ?? []).length; }

  publish(topic, payload) {
    this.published = this.published ?? [];
    this.published.push({ topic, payload });
  }
}

let clock, eventBus, getCompletion, bridge, nextState, nextStudyDate;

const build = () => {
  clock = fakeClock();
  eventBus = new FakeEventBus();
  nextState = 'incomplete';
  nextStudyDate = '2026-08-23';
  getCompletion = { execute: async ({ learnerId }) => ({ learnerId, studyDate: nextStudyDate, state: nextState, excused: [], faults: [] }) };
  bridge = new SchoolCompletionBridge({ realtime: new EventBusSchoolRealtimeAdapter({ eventBus }), getLearnerDayCompletion: getCompletion, clock: clock.now, logger: silentLogger });
};

beforeEach(() => build());

describe('construction', () => {
  it('requires eventBus and getLearnerDayCompletion', () => {
    expect(() => new SchoolCompletionBridge({})).toThrow();
    expect(() => new SchoolCompletionBridge({ realtime: new EventBusSchoolRealtimeAdapter({ eventBus }) })).toThrow();
  });
});

describe('start/stop', () => {
  it('start() subscribes to school.session.outcome-recorded', () => {
    bridge.start();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(1);
    expect(eventBus.subscriberCount('piano.lesson.completed')).toBe(1);
    expect(eventBus.subscriberCount('piano.school-challenge.completed')).toBe(1);
    expect(eventBus.subscriberCount('school.assignments.changed')).toBe(1);
    expect(eventBus.subscriberCount('school')).toBe(1);
  });

  it('start() twice does not double-subscribe', () => {
    bridge.start();
    bridge.start();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(1);
  });

  it('stop() unsubscribes and is safe to call again', () => {
    bridge.start();
    bridge.stop();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(0);
    expect(() => bridge.stop()).not.toThrow();
  });
});

describe('state observation publish', () => {
  it('publishes the first observed state so consumers can rebuild after restart', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    expect(eventBus.published).toEqual([{
      topic: 'school.completion.state-observed',
      payload: expect.objectContaining({
        learnerId: 'kid1', studyDate: '2026-08-23', state: 'incomplete',
        previousState: null, initial: true,
      }),
    }]);
  });

  it('publishes school.completion.state-observed on an actual transition', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    nextState = 'complete';
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'passed', at: clock.iso() });
    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({
      topic: 'school.completion.state-observed',
      payload: { learnerId: 'kid1', state: 'complete', previousState: 'incomplete', initial: false },
    });
  });

  it('does NOT publish when the recomputed state is unchanged', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'failed', at: clock.iso() });
    expect(eventBus.published).toHaveLength(1);
  });

  it('publishes the first observation of a new study day even when its state is unchanged', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1' });
    nextStudyDate = '2026-08-24';
    await eventBus.emit('school', { event: 'story-read', learnerId: 'kid1' });
    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1].payload).toMatchObject({
      learnerId: 'kid1', studyDate: '2026-08-24', state: 'incomplete',
      previousState: null, initial: true,
    });
  });

  it.each([
    ['piano.lesson.completed', { userId: 'kid1' }],
    ['piano.school-challenge.completed', { userId: 'kid1' }],
    ['school.assignments.changed', { learnerId: 'kid1' }],
    ['school', { event: 'program-day-bypass-changed', learnerId: 'kid1' }],
  ])('recomputes after %s completion input', async (topic, payload) => {
    bridge.start();
    await eventBus.emit(topic, payload);
    expect(eventBus.published?.[0]).toMatchObject({
      topic: 'school.completion.state-observed', payload: { learnerId: 'kid1' },
    });
  });

  it('serializes rapid recomputations for the same learner', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 'seed' });

    let releaseFirst;
    let calls = 0;
    getCompletion.execute = async ({ learnerId }) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ learnerId, studyDate: '2026-08-23', state: 'complete', excused: [] }); });
      return { learnerId, studyDate: '2026-08-23', state: 'complete', excused: [] };
    };

    const first = eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1' });
    await Promise.resolve();
    await Promise.resolve();
    const second = eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2' });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toBe(2);
    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1].payload).toMatchObject({
      learnerId: 'kid1', previousState: 'incomplete', state: 'complete',
    });
  });

  it('a getLearnerDayCompletion failure is swallowed, never thrown out of the handler', async () => {
    getCompletion.execute = async () => { throw new Error('store unavailable'); };
    bridge.start();
    await expect(eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() })).resolves.not.toThrow();
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('ignores a malformed payload with no learnerId', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { sessionId: 's1' });
    expect(eventBus.published ?? []).toHaveLength(0);
  });
});
