/**
 * DeviceLivenessService — offline synthesis + re-online initial synthesis
 * integration test (Phase 5 · Task 5.3).
 *
 * Exercises the real `WebSocketEventBus` + real `DeviceLivenessService`
 * together, with a simulated external WebSocket subscriber (the
 * "controller"). Verifies:
 *
 *   1. A heartbeat from the fake device lands on the controller.
 *   2. After heartbeats stop for > offlineTimeoutMs, the service
 *      synthesizes a `reason: 'offline'` broadcast — the controller
 *      receives it with the last-known snapshot.
 *   3. When the fake device resumes with a heartbeat, the service
 *      synthesizes a `reason: 'initial'` broadcast (the "back online"
 *      signal).
 *
 * Uses `vi.useFakeTimers()` so the offline timeout doesn't stall the test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WebSocketEventBus } from '#system/eventbus/WebSocketEventBus.mjs';
import { DeviceLivenessService } from '#apps/devices/services/DeviceLivenessService.mjs';
import { DEVICE_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';
import { buildDeviceStateBroadcast } from '#shared-contracts/media/envelopes.mjs';

const OPEN = 1;

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSubscriber(topics = []) {
  const ws = {
    readyState: OPEN,
    OPEN,
    send: vi.fn(),
  };
  const meta = { subscriptions: new Set(topics) };
  return { ws, meta };
}

function makeSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: {
      contentId: 'content/42', format: 'video', title: 'T', duration: 300,
    },
    position: 10,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: {
      shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0,
    },
    meta: { ownerId: 'tv-test', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

/**
 * Parse every WS message captured by ws.send mock, in order.
 */
function parseSent(ws) {
  return ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
}

describe('Integration — DeviceLivenessService offline & re-online synthesis', () => {
  const deviceId = 'tv-test';
  const stateTopic = DEVICE_STATE_TOPIC(deviceId);

  let bus, liveness, controller, logger;

  beforeEach(() => {
    vi.useFakeTimers();

    logger = makeLogger();
    bus = new WebSocketEventBus({ logger });
    bus._testSetServerAttached();

    controller = makeSubscriber([stateTopic]);
    // Install the controller BEFORE liveness starts so all broadcasts that
    // flow through bus.broadcast reach it via the pool.
    bus._testSetClientPool(new Map([['controller', controller]]));

    liveness = new DeviceLivenessService({
      eventBus: bus,
      logger,
      offlineTimeoutMs: 100,
    });
    liveness.start();
    bus.setLivenessService(liveness);
  });

  afterEach(() => {
    liveness.stop();
    vi.useRealTimers();
  });

  it('propagates a heartbeat from the device to the controller', () => {
    const snap = makeSnapshot();
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId,
      snapshot: snap,
      reason: 'heartbeat',
    }));

    const sent = parseSent(controller.ws);
    expect(sent).toHaveLength(1);
    // Note: on the wire, `topic` is the kind ('device-state') because
    // `buildDeviceStateBroadcast` stamps the kind and the broadcast merge
    // order (`{ topic, ...payload }`) lets the payload override. What
    // matters is the controller received it and the payload validates.
    expect(sent[0]).toMatchObject({
      topic: 'device-state',
      deviceId,
      reason: 'heartbeat',
      snapshot: snap,
    });
  });

  it('synthesizes reason:offline with last-known snapshot when heartbeats stop', () => {
    const snap = makeSnapshot({ position: 42 });
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId,
      snapshot: snap,
      reason: 'heartbeat',
    }));

    expect(controller.ws.send).toHaveBeenCalledTimes(1);
    expect(liveness.isOnline(deviceId)).toBe(true);

    // Advance past the offline timeout; the service's setTimeout fires and
    // re-broadcasts with reason='offline'.
    vi.advanceTimersByTime(150);

    expect(liveness.isOnline(deviceId)).toBe(false);

    const sent = parseSent(controller.ws);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const offlineMsg = sent[sent.length - 1];
    expect(offlineMsg).toMatchObject({
      topic: 'device-state',
      deviceId,
      reason: 'offline',
      snapshot: snap,
    });
  });

  it('synthesizes reason:initial when a previously-offline device resumes heartbeats', () => {
    const snap1 = makeSnapshot({ position: 10 });
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId,
      snapshot: snap1,
      reason: 'heartbeat',
    }));
    vi.advanceTimersByTime(150); // go offline

    expect(liveness.isOnline(deviceId)).toBe(false);
    const afterOffline = parseSent(controller.ws).length;

    // Device resumes — a fresh heartbeat arrives. The service observes
    // wasOffline && reason==='heartbeat' and synthesizes an 'initial'
    // broadcast on top of the caller's heartbeat broadcast.
    const snap2 = makeSnapshot({ position: 11 });
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId,
      snapshot: snap2,
      reason: 'heartbeat',
    }));

    expect(liveness.isOnline(deviceId)).toBe(true);

    const sent = parseSent(controller.ws);
    // Two new messages since going offline: the heartbeat itself +
    // the synthesized 'initial'.
    expect(sent.length).toBeGreaterThanOrEqual(afterOffline + 2);

    const newSuffix = sent.slice(afterOffline);
    const reasons = newSuffix.map((m) => m.reason);
    expect(reasons).toContain('heartbeat');
    expect(reasons).toContain('initial');

    const initial = newSuffix.find((m) => m.reason === 'initial');
    expect(initial).toMatchObject({
      topic: 'device-state',
      deviceId,
      snapshot: snap2,
    });
  });

  it('does not synthesize reason:initial on a first-ever heartbeat (no prior offline)', () => {
    const snap = makeSnapshot();
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId,
      snapshot: snap,
      reason: 'heartbeat',
    }));

    // Only the inbound heartbeat should reach the controller — no
    // synthesized 'initial' because wasOffline==false.
    const sent = parseSent(controller.ws);
    expect(sent).toHaveLength(1);
    expect(sent[0].reason).toBe('heartbeat');
  });

  it('ignores further heartbeats after rearming the timer — no duplicate offline synthesis', () => {
    const snap = makeSnapshot();
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId, snapshot: snap, reason: 'heartbeat',
    }));
    // Advance a bit, but not past the timeout — send another heartbeat
    // to rearm. No offline should fire yet.
    vi.advanceTimersByTime(50);
    bus.broadcast(stateTopic, buildDeviceStateBroadcast({
      deviceId, snapshot: snap, reason: 'heartbeat',
    }));
    vi.advanceTimersByTime(80);

    expect(liveness.isOnline(deviceId)).toBe(true);
    const sent = parseSent(controller.ws);
    // Exactly two heartbeats, no 'offline' yet.
    expect(sent.filter((m) => m.reason === 'offline')).toHaveLength(0);
    expect(sent.filter((m) => m.reason === 'heartbeat')).toHaveLength(2);
  });
});
