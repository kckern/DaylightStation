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
    post: (body) => { posted.push(body); },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    logger: { debug() {} },
    ...over,
  });
};

const CONTENT = { contentId: 'arcade:gb/test', title: 'Test Game', console: 'gb', consoleLabel: 'Game Boy' };
beforeEach(() => { posted = []; });

describe('playSessionReporter', () => {
  it('reports the same shape the inferred source produces', async () => {
    build().started({ userId: 'test-learner', content: CONTENT, loadId: 'launch-1', loadedAt: '2026-09-11T20:00:00.000Z' });
    expect(posted[0]).toMatchObject({
      deviceId: 'fitness-console', surface: 'browser-emulator', userId: 'test-learner',
      observation: {
        state: 'playing', loaded: true, loadId: 'launch-1',
        loadedAt: '2026-09-11T20:00:00.000Z', content: CONTENT,
      },
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

  it('heartbeats while paused so a loaded game is not mistaken for an abandoned session', () => {
    const r = build();
    r.started({ content: CONTENT });
    r.paused();
    posted.length = 0;
    timers.tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].observation).toMatchObject({ state: 'paused', loaded: true });
  });

  it('heartbeats when initially mounted paused behind governance', () => {
    build().started({ content: CONTENT, state: 'paused' });
    posted.length = 0;
    timers.tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].observation.state).toBe('paused');
  });

  it('ends with an explicit unload while retaining the load identity', () => {
    const r = build();
    r.started({ userId: 'test-learner', content: CONTENT, loadId: 'launch-1' });
    posted.length = 0;
    r.ended();
    expect(posted[0].observation).toMatchObject({ loaded: false, loadId: 'launch-1', content: CONTENT });
    expect(r.isReporting).toBe(false);
  });

  it('resumes heartbeat after a pause', () => {
    const r = build();
    r.started({ content: CONTENT, loadId: 'launch-1' });
    r.paused();
    r.resumed();
    posted.length = 0;
    timers.tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].observation.state).toBe('playing');
  });

  it('attributes a claimed player without ending or changing the load', () => {
    const r = build();
    r.started({ content: CONTENT, loadId: 'launch-1' });
    posted.length = 0;
    r.updateIdentity('test-learner');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      userId: 'test-learner',
      observation: { state: 'playing', loaded: true, loadId: 'launch-1' },
    });
  });

  it('reports the connected controller count on each observation', () => {
    const r = build({ getControllers: () => 2 });
    r.started({ content: CONTENT, loadId: 'launch-1' });
    expect(posted[0].observation.controllers).toBe(2);
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

  it('serializes observations so a delayed playing request cannot arrive after unload', async () => {
    const releases = [];
    const r = build({
      post: (body) => {
        posted.push(body);
        return new Promise((resolve) => releases.push(resolve));
      },
    });
    r.started({ content: CONTENT, loadId: 'launch-1' });
    r.ended();
    expect(posted.map((body) => body.observation.loaded)).toEqual([true]);

    releases.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted.map((body) => body.observation.loaded)).toEqual([true, false]);
  });

  it('requires its essentials rather than silently reporting nothing', () => {
    expect(() => createPlaySessionReporter({ post: () => {} })).toThrow(/deviceId/);
    expect(() => createPlaySessionReporter({ deviceId: 'd' })).toThrow(/post/);
  });
});
