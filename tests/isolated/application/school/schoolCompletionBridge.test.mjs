import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolCompletionBridge } from '#apps/school/SchoolCompletionBridge.mjs';
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

let clock, eventBus, getCompletion, bridge, nextState;

const build = () => {
  clock = fakeClock();
  eventBus = new FakeEventBus();
  nextState = 'incomplete';
  getCompletion = { execute: async ({ learnerId }) => ({ learnerId, state: nextState, excused: [] }) };
  bridge = new SchoolCompletionBridge({ eventBus, getLearnerDayCompletion: getCompletion, clock: clock.now, logger: silentLogger });
};

beforeEach(() => build());

describe('construction', () => {
  it('requires eventBus and getLearnerDayCompletion', () => {
    expect(() => new SchoolCompletionBridge({})).toThrow();
    expect(() => new SchoolCompletionBridge({ eventBus })).toThrow();
  });
});

describe('start/stop', () => {
  it('start() subscribes to school.session.outcome-recorded', () => {
    bridge.start();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(1);
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

describe('transition-only publish', () => {
  it('the FIRST observed state for a learner is never published (no prior state to compare)', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('publishes school.completion.changed on an actual transition', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    nextState = 'complete';
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'passed', at: clock.iso() });
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({
      topic: 'school.completion.changed',
      payload: { learnerId: 'kid1', state: 'complete', previousState: 'incomplete' },
    });
  });

  it('does NOT publish when the recomputed state is unchanged', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'failed', at: clock.iso() });
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('serializes rapid recomputations for the same learner', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 'seed' });

    let releaseFirst;
    let calls = 0;
    getCompletion.execute = async ({ learnerId }) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ learnerId, state: 'complete', excused: [] }); });
      return { learnerId, state: 'complete', excused: [] };
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
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0].payload).toMatchObject({
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
