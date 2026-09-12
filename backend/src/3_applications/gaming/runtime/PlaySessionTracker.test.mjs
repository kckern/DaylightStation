import { describe, it, expect, beforeEach } from 'vitest';
import { PlaySessionTracker } from './PlaySessionTracker.mjs';
import { PlayIntent } from '#domains/gaming/value-objects/PlayIntent.mjs';

const DEVICE = { deviceId: 'livingroom-tv', surface: 'console-emulator' };
const CONTENT = { contentId: 'game:a', title: 'Game A' };
let clock = Date.parse('2026-09-11T20:00:00.000Z');
const now = () => new Date(clock).toISOString();

const intentFor = (overrides = {}) => new PlayIntent({
  deviceId: 'livingroom-tv', surface: 'console-emulator', userId: 'test-learner',
  content: CONTENT, grantRef: 'grant_1',
  requestedAt: new Date(clock - 60_000).toISOString(),
  expiresAt: new Date(clock + 600_000).toISOString(),
  ...overrides,
});

let source, record, intents, timers;

/** Fake IApplicationScheduler: `after` records the task and returns a cancel. */
function makeTimers() {
  const scheduled = [];
  return {
    scheduled,
    after: (ms, fn) => {
      const slot = scheduled.push({ fn, ms }) - 1;
      return () => { scheduled[slot] = null; };
    },
    runNext: async () => { const t = scheduled.find(Boolean); if (t) { scheduled[scheduled.indexOf(t)] = null; await t.fn(); } },
  };
}

const tracker = (over = {}) => new PlaySessionTracker({
  devices: [DEVICE], observationSource: source, intents, recordObservation: record,
  intervalMs: 10_000, scheduler: timers, now,
  logger: { info() {}, warn() {}, debug() {}, error() {} },
  ...over,
});

beforeEach(() => {
  clock = Date.parse('2026-09-11T20:00:00.000Z');
  timers = makeTimers();
  source = { observed: [], observe: async (deviceId, opts) => { source.observed.push({ deviceId, ...opts }); return { state: 'playing', observedAt: now(), confidenceMs: 10_000, content: opts.expectedContent }; } };
  record = { calls: [], execute: async (input) => { record.calls.push(input); return {}; } };
  intents = { findForDevice: async () => intentFor() };
});

describe('PlaySessionTracker — attribution', () => {
  it('carries user, grant and expected content from the intent', async () => {
    await tracker().tick();
    expect(source.observed[0].expectedContent).toEqual(CONTENT);
    expect(record.calls[0]).toMatchObject({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      userId: 'test-learner', grantRef: 'grant_1',
    });
  });

  it('stops attributing once the intent has expired, but still observes', async () => {
    intents.findForDevice = async () => intentFor({ expiresAt: new Date(clock - 1000).toISOString() });
    await tracker().tick();
    expect(source.observed[0].expectedContent).toBeNull();
    expect(record.calls[0].userId).toBeNull();
    expect(record.calls[0].grantRef).toBeNull();
    expect(record.calls).toHaveLength(1);   // observation still happened
  });

  it('works with no intent store at all', async () => {
    await tracker({ intents: null }).tick();
    expect(record.calls[0].userId).toBeNull();
  });
});

describe('PlaySessionTracker — isolation and resilience', () => {
  it('one failing device does not stop the others', async () => {
    const other = { deviceId: 'other-tv', surface: 'console-emulator' };
    source.observe = async (deviceId, opts) => {
      if (deviceId === 'livingroom-tv') throw new Error('unreachable');
      return { state: 'paused', observedAt: now(), content: opts.expectedContent };
    };
    const t = tracker({ devices: [DEVICE, other] });
    await t.tick();
    expect(record.calls.map((c) => c.deviceId)).toEqual(['other-tv']);
    const health = Object.fromEntries(t.getHealth().map((h) => [h.deviceId, h]));
    expect(health['livingroom-tv'].lastError).toMatch(/unreachable/);
    expect(health['livingroom-tv'].consecutiveErrors).toBe(1);
    expect(health['other-tv'].consecutiveErrors).toBe(0);
  });

  it('records failures instead of swallowing them, and clears on recovery', async () => {
    let fail = true;
    source.observe = async (_d, opts) => {
      if (fail) throw new Error('probe down');
      return { state: 'playing', observedAt: now(), content: opts.expectedContent };
    };
    const t = tracker();
    await t.tick();
    await t.tick();
    expect(t.getHealth()[0].consecutiveErrors).toBe(2);
    fail = false;
    await t.tick();
    expect(t.getHealth()[0].consecutiveErrors).toBe(0);
    expect(t.getHealth()[0].lastState).toBe('playing');
  });

  it('does not overlap probes for the same device', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let started = 0;
    source.observe = async (_d, opts) => { started += 1; await gate; return { state: 'playing', observedAt: now(), content: opts.expectedContent }; };
    const t = tracker();
    const first = t.tick();
    await t.tick();               // second pass while the first probe is still open
    expect(started).toBe(1);      // skipped, not stacked
    release();
    await first;
  });
});

describe('PlaySessionTracker — scheduling', () => {
  it('chains ticks rather than stacking intervals', async () => {
    const t = tracker().start();
    expect(t.isRunning).toBe(true);
    expect(timers.scheduled.filter(Boolean)).toHaveLength(1);
    await timers.runNext();
    expect(timers.scheduled.filter(Boolean)).toHaveLength(1); // exactly one pending
    expect(record.calls).toHaveLength(1);
    t.stop();
    expect(t.isRunning).toBe(false);
  });

  it('refuses global timers — scheduling must be injected', () => {
    expect(() => new PlaySessionTracker({
      observationSource: source, recordObservation: record, intervalMs: 1000, now,
    })).toThrow(/scheduler/);
  });
});
