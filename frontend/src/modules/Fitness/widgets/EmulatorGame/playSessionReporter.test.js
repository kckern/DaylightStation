import { describe, it, expect, beforeEach } from 'vitest';
import { createPlaySessionReporter } from './playSessionReporter.js';

let posted, timers;
const fakeTimers = () => {
  const scheduled = [];
  return {
    scheduled,
    setTimer: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    clearTimer: (id) => { scheduled[id - 1] = null; },
    tick: () => scheduled.filter(Boolean).forEach((t) => t.fn()),
  };
};

const build = (over = {}) => {
  timers = fakeTimers();
  return createPlaySessionReporter({
    deviceId: 'fitness-console',
    post: async (body) => { posted.push(body); },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    logger: { debug() {} },
    ...over,
  });
};

const CONTENT = { contentId: 'emulatorjs:gb/test', title: 'Test Game' };
beforeEach(() => { posted = []; });

describe('playSessionReporter', () => {
  it('reports the same shape the inferred source produces', async () => {
    build().started({ userId: 'test-learner', content: CONTENT });
    expect(posted[0]).toMatchObject({
      deviceId: 'fitness-console', surface: 'browser-emulator', userId: 'test-learner',
      observation: { state: 'playing', content: CONTENT },
    });
  });

  it('claims exact confidence, because it is not being guessed at', () => {
    build().started({ content: CONTENT });
    expect(posted[0].observation.confidenceMs).toBe(0);
  });

  it('heartbeats while playing, because time accrues BETWEEN observations', () => {
    // A surface that said "playing" once and went quiet would accrue nothing.
    build().started({ content: CONTENT });
    timers.tick();
    timers.tick();
    expect(posted).toHaveLength(3);
    expect(posted.every((p) => p.observation.state === 'playing')).toBe(true);
  });

  it('stops heartbeating when paused', () => {
    const r = build();
    r.started({ content: CONTENT });
    r.paused();
    posted.length = 0;
    timers.tick();
    expect(posted).toEqual([]);
  });

  it('ends with no content, which is what closes the session', () => {
    const r = build();
    r.started({ userId: 'test-learner', content: CONTENT });
    posted.length = 0;
    r.ended();
    expect(posted[0].observation.content).toBeNull();
    expect(r.isReporting).toBe(false);
  });

  it('ending twice reports once', () => {
    const r = build();
    r.started({ content: CONTENT });
    r.ended();
    posted.length = 0;
    r.ended();
    expect(posted).toEqual([]);
  });

  it('never lets an unreachable meter interrupt the game', () => {
    const r = build({ post: () => { throw new Error('offline'); } });
    expect(() => r.started({ content: CONTENT })).not.toThrow();
    expect(() => r.ended()).not.toThrow();
  });

  it('swallows a rejected promise without an unhandled rejection', async () => {
    const r = build({ post: async () => { throw new Error('500'); } });
    r.started({ content: CONTENT });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.isReporting).toBe(true);
  });

  it('requires its essentials rather than silently reporting nothing', () => {
    expect(() => createPlaySessionReporter({ post: () => {} })).toThrow(/deviceId/);
    expect(() => createPlaySessionReporter({ deviceId: 'd' })).toThrow(/post/);
  });
});
