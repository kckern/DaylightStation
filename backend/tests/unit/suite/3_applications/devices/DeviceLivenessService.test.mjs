/**
 * DeviceLivenessService — offline synthesis + last-snapshot cache tests.
 *
 * Uses `vi.useFakeTimers()` and a mock event bus. The mock bus captures a
 * single pattern subscriber (one per service) and lets the test drive
 * incoming device-state broadcasts by invoking the captured handler
 * directly. Outgoing broadcasts are captured on `publishedBroadcasts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceLivenessService } from '#apps/devices/services/DeviceLivenessService.mjs';
import { DEVICE_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (ts) => { now = ts; },
  };
}

function makeMockBus() {
  const patternHandlers = [];
  const publishedBroadcasts = [];

  return {
    subscribePattern: vi.fn((predicate, handler) => {
      const entry = { predicate, handler };
      patternHandlers.push(entry);
      return () => {
        const idx = patternHandlers.indexOf(entry);
        if (idx !== -1) patternHandlers.splice(idx, 1);
      };
    }),
    broadcast: vi.fn((topic, payload) => {
      publishedBroadcasts.push({ topic, payload });
    }),
    publish: vi.fn(),
    // Test helper — simulate an incoming device-state broadcast on the bus.
    _deliver(topic, payload) {
      for (const { predicate, handler } of patternHandlers) {
        if (predicate(topic)) handler(payload, topic);
      }
    },
    _patternHandlers: patternHandlers,
    _published: publishedBroadcasts,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    status: 'playing',
    currentItem: null,
    queueId: null,
    queueOrigin: null,
    queuePosition: 0,
    queueLength: 0,
    position: 0,
    duration: 0,
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    ...overrides,
  };
}

describe('DeviceLivenessService', () => {
  let clock, bus, logger, service;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = makeClock();
    bus = makeMockBus();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    service = new DeviceLivenessService({
      eventBus: bus,
      logger,
      clock,
      offlineTimeoutMs: 15000,
    });
    service.start();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('caches snapshot + lastSeenAt on heartbeat', () => {
    const snap = makeSnapshot();
    clock.set(1_700_000_000_000);
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      topic: 'device-state',
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: snap,
      ts: '2026-04-17T00:00:00.000Z',
    });

    const cached = service.getLastSnapshot('tv-1');
    expect(cached).not.toBeNull();
    expect(cached.snapshot).toBe(snap);
    expect(cached.online).toBe(true);
    expect(cached.lastSeenAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('isOnline is true after a recent heartbeat', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });
    expect(service.isOnline('tv-1')).toBe(true);
  });

  it('synthesizes offline broadcast after 15s with no heartbeat', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    // Advance exactly to the timeout boundary.
    clock.advance(15_000);
    vi.advanceTimersByTime(15_000);

    const offlineBroadcast = bus._published.find((b) => b.payload?.reason === 'offline');
    expect(offlineBroadcast).toBeDefined();
    expect(offlineBroadcast.topic).toBe(DEVICE_STATE_TOPIC('tv-1'));
    expect(offlineBroadcast.payload.deviceId).toBe('tv-1');
    expect(offlineBroadcast.payload.snapshot).toMatchObject({ status: 'playing' });
    expect(service.isOnline('tv-1')).toBe(false);
  });

  it('getLastSnapshot.online flips to false after offline synthesis', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    clock.advance(15_000);
    vi.advanceTimersByTime(15_000);

    const cached = service.getLastSnapshot('tv-1');
    expect(cached.online).toBe(false);
  });

  it('synthesizes reason=initial on heartbeat after offline', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot({ status: 'playing' }),
    });

    clock.advance(15_000);
    vi.advanceTimersByTime(15_000); // goes offline

    // Clear captured broadcasts from the offline synthesis.
    const preCount = bus._published.length;

    clock.advance(5_000);
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot({ status: 'playing', position: 10 }),
    });

    const newBroadcasts = bus._published.slice(preCount);
    const initial = newBroadcasts.find((b) => b.payload?.reason === 'initial');
    expect(initial).toBeDefined();
    expect(initial.topic).toBe(DEVICE_STATE_TOPIC('tv-1'));
    expect(initial.payload.deviceId).toBe('tv-1');
    expect(service.isOnline('tv-1')).toBe(true);
  });

  it('does NOT synthesize reason=initial when incoming is initial or change', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    clock.advance(15_000);
    vi.advanceTimersByTime(15_000); // offline

    const preCount = bus._published.length;

    // Incoming is 'change' (not 'heartbeat') — no synthesis.
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'change',
      snapshot: makeSnapshot({ status: 'paused' }),
    });

    const newBroadcasts = bus._published.slice(preCount);
    expect(newBroadcasts.find((b) => b.payload?.reason === 'initial')).toBeUndefined();
    expect(service.isOnline('tv-1')).toBe(true);
  });

  it('getLastSnapshot returns null for unknown device', () => {
    expect(service.getLastSnapshot('never-seen')).toBeNull();
    expect(service.isOnline('never-seen')).toBe(false);
  });

  it('stop() clears all timers (no further offline synthesis)', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    service.stop();

    const preCount = bus._published.length;
    clock.advance(20_000);
    vi.advanceTimersByTime(20_000);

    // No offline broadcast should have fired.
    expect(bus._published.length).toBe(preCount);
  });

  it('heartbeat resets the timer (no offline before timeout from last heartbeat)', () => {
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    clock.advance(10_000);
    vi.advanceTimersByTime(10_000);

    // Re-heartbeat before the first 15s boundary — reset timer.
    bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    // Advance another 10s (20s since initial, but only 10s since last).
    clock.advance(10_000);
    vi.advanceTimersByTime(10_000);

    // Device should still be online (timer reset).
    expect(service.isOnline('tv-1')).toBe(true);
    expect(bus._published.find((b) => b.payload?.reason === 'offline')).toBeUndefined();
  });

  it('configurable offlineTimeoutMs drives the synthesis interval', () => {
    service.stop();
    service = new DeviceLivenessService({
      eventBus: bus,
      logger,
      clock,
      offlineTimeoutMs: 1000,
    });
    service.start();

    bus._deliver(DEVICE_STATE_TOPIC('tv-2'), {
      deviceId: 'tv-2',
      reason: 'heartbeat',
      snapshot: makeSnapshot(),
    });

    clock.advance(1000);
    vi.advanceTimersByTime(1000);

    expect(service.isOnline('tv-2')).toBe(false);
  });
});
