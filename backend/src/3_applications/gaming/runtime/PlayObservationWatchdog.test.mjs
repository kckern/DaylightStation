import { describe, it, expect, beforeEach } from 'vitest';
import { PlayObservationWatchdog } from './PlayObservationWatchdog.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
let clock = T0;
const now = () => new Date(clock).toISOString();
const at = (s) => new Date(T0 + s * 1000).toISOString();

let logs;
const logger = {
  info: (e, d) => logs.push(['info', e, d]),
  warn: (e, d) => logs.push(['warn', e, d]),
  error: (e, d) => logs.push(['error', e, d]),
};
const events = () => logs.map((l) => l[1]);

const trackerWith = (health) => ({ getHealth: () => health });
const build = (health, over = {}) => new PlayObservationWatchdog({
  trackers: [trackerWith(health)],
  scheduler: { after: () => () => {} },
  now, logger, staleAfterMs: 60_000, errorThreshold: 3, intervalMs: 30_000, ...over,
});

beforeEach(() => { clock = T0; logs = []; });

describe('PlayObservationWatchdog — staleness', () => {
  it('raises an error when a tracker stops ticking', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-120), consecutiveErrors: 0 }]);
    expect(w.check()).toContainEqual({ deviceId: 'tv', condition: 'stale' });
    expect(logs.find((l) => l[1] === 'play.watchdog.stale')[0]).toBe('error');
  });

  it('stays quiet while ticks are fresh', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-10), consecutiveErrors: 0 }]);
    expect(w.check()).toEqual([]);
    expect(events()).toEqual([]);
  });

  it('does not call a tracker stale before it has ever ticked', () => {
    // Freshly started: absence of a tick is not evidence of a wedged loop.
    const w = build([{ deviceId: 'tv', lastTickAt: null, consecutiveErrors: 0 }]);
    expect(w.check()).toEqual([]);
  });
});

describe('PlayObservationWatchdog — failing and degraded', () => {
  it('warns once consecutive errors cross the threshold', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-5), consecutiveErrors: 3, lastError: 'unreachable' }]);
    expect(w.check()).toContainEqual({ deviceId: 'tv', condition: 'failing' });
    expect(events()).toContain('play.watchdog.failing');
  });

  it('does not warn below the threshold', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-5), consecutiveErrors: 2 }]);
    expect(events()).toEqual([]);
    expect(w.check()).toEqual([]);
  });

  it('flags a degraded meter separately from a failing one', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-5), consecutiveErrors: 0, degraded: true }]);
    expect(w.check()).toContainEqual({ deviceId: 'tv', condition: 'degraded' });
    expect(events()).toContain('play.watchdog.degraded');
  });
});

describe('PlayObservationWatchdog — alarms are edge-triggered', () => {
  it('announces a condition once, not on every sweep', () => {
    const health = [{ deviceId: 'tv', lastTickAt: at(-120), consecutiveErrors: 0 }];
    const w = build(health);
    w.check(); w.check(); w.check();
    expect(events().filter((e) => e === 'play.watchdog.stale')).toHaveLength(1);
  });

  it('announces recovery when the condition clears', () => {
    const health = [{ deviceId: 'tv', lastTickAt: at(-120), consecutiveErrors: 0 }];
    const w = build(health);
    w.check();
    health[0].lastTickAt = at(-5);
    expect(w.check()).toEqual([]);
    expect(events()).toContain('play.watchdog.stale_cleared');
  });

  it('tracks conditions per device independently', () => {
    const w = build([
      { deviceId: 'tv', lastTickAt: at(-120), consecutiveErrors: 0 },
      { deviceId: 'other', lastTickAt: at(-5), consecutiveErrors: 0 },
    ]);
    const found = w.check();
    expect(found).toEqual([{ deviceId: 'tv', condition: 'stale' }]);
  });
});

describe('PlayObservationWatchdog — lifecycle', () => {
  it('requires injected scheduling and clock', () => {
    expect(() => new PlayObservationWatchdog({ now, staleAfterMs: 1, intervalMs: 1 })).toThrow(/scheduler/);
    expect(() => new PlayObservationWatchdog({ scheduler: { after() {} }, staleAfterMs: 1, intervalMs: 1 })).toThrow(/now/);
  });

  it('starts and stops', () => {
    const w = build([]);
    expect(w.start().isRunning).toBe(true);
    expect(w.stop().isRunning).toBe(false);
  });

  it('a throwing tracker does not kill the sweep loop', () => {
    const w = new PlayObservationWatchdog({
      trackers: [{ getHealth: () => { throw new Error('boom'); } }],
      // Fires once: a scheduler that re-fired synchronously would recurse
      // through #schedule. The real one always defers.
      scheduler: (() => { let fired = false; return { after: (ms, fn) => { if (!fired) { fired = true; fn(); } return () => {}; } }; })(),
      now, logger, staleAfterMs: 60_000, intervalMs: 30_000,
    });
    w.start();
    expect(events()).toContain('play.watchdog.failed');
  });
});

describe('PlayObservationWatchdog — prolonged blindness escalates to a person', () => {
  const blind = () => [{ deviceId: 'tv', lastTickAt: at(-7200), consecutiveErrors: 0 }];

  it('marks the device so no NEW play is granted, and never stops a running game', () => {
    const w = build(blind(), { escalateAfterMs: 600_000 });
    const found = w.check();
    expect(found).toContainEqual({ deviceId: 'tv', condition: 'blind' });
    expect(w.isBlocked('tv')).toBe(true);
    // Nothing here terminates anything — that is the entire point.
    expect(events()).not.toContain('play.terminated');
  });

  it('tells a responsible adult, in plain language', async () => {
    const raised = [];
    const w = build(blind(), { escalateAfterMs: 600_000, alert: { raise: async (a) => raised.push(a) } });
    w.check();
    await Promise.resolve();
    expect(raised[0].deviceId).toBe('tv');
    expect(raised[0].message).toMatch(/cannot see/i);
  });

  it('escalates once, not on every sweep', async () => {
    const raised = [];
    const health = blind();
    const w = build(health, { escalateAfterMs: 600_000, alert: { raise: async (a) => raised.push(a) } });
    w.check(); w.check(); w.check();
    await Promise.resolve();
    expect(raised).toHaveLength(1);
  });

  it('unblocks the device when observation returns', () => {
    const health = blind();
    const w = build(health, { escalateAfterMs: 600_000 });
    w.check();
    health[0].lastTickAt = at(-5);
    w.check();
    expect(w.isBlocked('tv')).toBe(false);
  });

  it('a short outage does not escalate', () => {
    const w = build([{ deviceId: 'tv', lastTickAt: at(-120), consecutiveErrors: 0 }], { escalateAfterMs: 600_000 });
    expect(w.isBlocked('tv')).toBe(false);
  });

  it('a failing alert never breaks the sweep', () => {
    const w = build(blind(), { escalateAfterMs: 600_000, alert: { raise: async () => { throw new Error('ha down'); } } });
    expect(() => w.check()).not.toThrow();
    expect(w.isBlocked('tv')).toBe(true);
  });
});
