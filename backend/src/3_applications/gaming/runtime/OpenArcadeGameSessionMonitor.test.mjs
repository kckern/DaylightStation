import { describe, it, expect } from 'vitest';
import { OpenArcadeGameSessionMonitor } from './OpenArcadeGameSessionMonitor.mjs';
import { ArcadeGameSession } from '#domains/gaming/entities/ArcadeGameSession.mjs';
import { ArcadeGameSessionState } from '#domains/gaming/value-objects/ArcadeGameSessionState.mjs';

const T0 = Date.parse('2026-09-12T20:00:00.000Z');
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();
const quiet = { info() {}, warn() {}, error() {} };

function session(deviceId, lastObservedSeconds) {
  const opened = ArcadeGameSession.open({
    id: `ps_${deviceId}`,
    deviceId,
    surface: 'browser-emulator',
    content: { contentId: 'arcade:n64/star-fox-64' },
    trustedGapMs: 25_000,
  });
  opened.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(0) });
  opened.observe({ state: ArcadeGameSessionState.PLAYING, observedAt: at(lastObservedSeconds) });
  return opened;
}

class FakeSessions {
  constructor(items = []) { this.items = new Map(items.map((item) => [item.deviceId, item])); this.saved = []; }
  async listOpen() { return [...this.items.values()].filter((item) => !item.isEnded()); }
  async findOpenForDevice(deviceId) {
    const item = this.items.get(deviceId);
    return item && !item.isEnded() ? item : null;
  }
  async save(item) { this.items.set(item.deviceId, item); this.saved.push(item); }
}

const build = ({ items = [], now = () => at(100), announcer = null, scheduler = null, logger = quiet } = {}) => {
  const sessions = new FakeSessions(items);
  return {
    sessions,
    monitor: new OpenArcadeGameSessionMonitor({
      sessions,
      announcer,
      scheduler: scheduler ?? { after: () => () => {} },
      now,
      staleAfterMs: 60_000,
      intervalMs: 30_000,
      logger,
    }),
  };
};

describe('OpenArcadeGameSessionMonitor', () => {
  it('leaves a recently observed session open', async () => {
    const opened = session('fitness-console', 50);
    const { monitor, sessions } = build({ items: [opened], now: () => at(100) });
    expect(await monitor.sweep()).toEqual({ checked: 1, lost: [] });
    expect(sessions.saved).toEqual([]);
    expect(opened.isEnded()).toBe(false);
  });

  it('settles and announces a session that stopped reporting', async () => {
    const opened = session('fitness-console', 20);
    const events = [];
    const { monitor, sessions } = build({
      items: [opened],
      now: () => at(100),
      announcer: { ended: async (item) => events.push(item.toSnapshot()) },
    });
    expect(await monitor.sweep()).toEqual({ checked: 1, lost: ['ps_fitness-console'] });
    expect(sessions.saved).toHaveLength(1);
    expect(opened.endReason).toBe('lost');
    expect(events[0]).toMatchObject({ id: 'ps_fitness-console', status: 'ended', endReason: 'lost' });
  });

  it('re-reads a candidate and does not close a session refreshed during the sweep', async () => {
    const stale = session('fitness-console', 20);
    const refreshed = session('fitness-console', 90);
    const { monitor, sessions } = build({ items: [stale], now: () => at(100) });
    sessions.findOpenForDevice = async () => refreshed;
    expect(await monitor.sweep()).toEqual({ checked: 1, lost: [] });
    expect(sessions.saved).toEqual([]);
    expect(refreshed.isEnded()).toBe(false);
  });

  it('contains a broken device and continues settling the others', async () => {
    const bad = session('bad-console', 20);
    const stale = session('fitness-console', 20);
    const { monitor, sessions } = build({ items: [bad, stale], now: () => at(100) });
    const original = sessions.findOpenForDevice.bind(sessions);
    sessions.findOpenForDevice = async (deviceId) => {
      if (deviceId === 'bad-console') throw new Error('unreadable');
      return original(deviceId);
    };
    expect(await monitor.sweep()).toEqual({ checked: 2, lost: ['ps_fitness-console'] });
  });

  it('starts one recurring sweep, exposes health, and cancels it on stop', async () => {
    let tick;
    let cancelled = 0;
    const scheduler = {
      after: (interval, task) => { expect(interval).toBe(30_000); tick = task; return () => { cancelled += 1; }; },
    };
    const { monitor } = build({ scheduler });
    monitor.start();
    monitor.start();
    expect(monitor.getHealth()).toMatchObject({ running: true, staleAfterMs: 60_000, intervalMs: 30_000 });
    await tick();
    expect(monitor.getHealth().lastSweepAt).toBe(at(100));
    monitor.stop();
    expect(cancelled).toBe(1);
    expect(monitor.getHealth().running).toBe(false);
  });

  it('does not overlap sweeps when storage is slow', async () => {
    let release;
    let reads = 0;
    const sessions = {
      listOpen: () => { reads += 1; return new Promise((resolve) => { release = () => resolve([]); }); },
      findOpenForDevice: async () => null,
      save: async () => {},
    };
    const monitor = new OpenArcadeGameSessionMonitor({
      sessions, scheduler: { after: () => () => {} }, now: () => at(100),
      staleAfterMs: 60_000, intervalMs: 30_000, logger: quiet,
    });
    const first = monitor.sweep();
    const second = monitor.sweep();
    expect(reads).toBe(1);
    release();
    expect(await first).toEqual({ checked: 0, lost: [] });
    expect(await second).toEqual({ checked: 0, lost: [] });
  });
});
