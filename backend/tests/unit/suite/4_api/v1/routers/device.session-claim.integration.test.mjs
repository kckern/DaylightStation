/**
 * POST /api/v1/device/:id/session/claim — atomicity integration test
 * (Phase 5 · Task 5.2).
 *
 * Same in-process stack as device.session.integration.test.mjs but anchored
 * on the claim endpoint. Covers:
 *
 *   Happy path:
 *     1. Seed the liveness service with an online snapshot.
 *     2. The fake device acks the stop envelope with ok:true.
 *     3. HTTP 200 with { ok, commandId, snapshot, stoppedAt }.
 *
 *   Refused path:
 *     4. Re-seed.
 *     5. Fake device acks the stop with ok:false (DEVICE_REFUSED).
 *     6. HTTP 502 — and the service's cached liveness snapshot is
 *        unchanged (nothing mutated state on the device side either,
 *        by construction).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WebSocketEventBus } from '#system/eventbus/WebSocketEventBus.mjs';
import { DeviceLivenessService } from '#apps/devices/services/DeviceLivenessService.mjs';
import { SessionControlService } from '#apps/devices/services/SessionControlService.mjs';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import {
  SCREEN_COMMAND_TOPIC,
  DEVICE_ACK_TOPIC,
  DEVICE_STATE_TOPIC,
} from '#shared-contracts/media/topics.mjs';
import { buildDeviceStateBroadcast } from '#shared-contracts/media/envelopes.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';

// ---------------------------------------------------------------------------
// Helpers (mirror device.session.integration.test.mjs — kept local per plan)
// ---------------------------------------------------------------------------

function findHandler(router, path, method = 'post') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not mounted`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
    end: vi.fn(function end() { this.ended = true; return this; }),
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: {
      contentId: 'content/42', format: 'video', title: 'Test', duration: 300,
    },
    position: 120,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: {
      shuffle: false, repeat: 'off', shader: null, volume: 60, playbackRate: 1.0,
    },
    meta: { ownerId: 'tv-test', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

function installFakeDevice(bus, deviceId, { ackBuilder } = {}) {
  const received = [];
  const defaultBuilder = (envelope) => ({
    topic: 'device-ack',
    deviceId,
    commandId: envelope.commandId,
    ok: true,
    appliedAt: new Date().toISOString(),
  });
  let builder = ackBuilder || defaultBuilder;

  const screenTopic = SCREEN_COMMAND_TOPIC(deviceId);
  const unsubscribe = bus.subscribePattern(
    (topic) => topic === screenTopic,
    (payload) => {
      received.push(payload);
      bus.publish(DEVICE_ACK_TOPIC(deviceId), builder(payload));
    },
  );
  return { received, unsubscribe, setAckBuilder: (fn) => { builder = fn; } };
}

function seedDeviceOnline(bus, deviceId, snapshot) {
  bus.publish(DEVICE_STATE_TOPIC(deviceId), buildDeviceStateBroadcast({
    deviceId,
    snapshot,
    reason: 'heartbeat',
  }));
}

function buildStack() {
  const logger = makeLogger();
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  bus._testSetClientPool(new Map());

  const livenessService = new DeviceLivenessService({
    eventBus: bus,
    logger,
    offlineTimeoutMs: 15000,
  });
  livenessService.start();
  bus.setLivenessService(livenessService);

  const sessionControlService = new SessionControlService({
    eventBus: bus,
    livenessService,
    logger,
    ackTimeoutMs: 1000,
  });

  const deviceService = {
    get: vi.fn(() => null),
    listDevices: vi.fn(() => []),
  };

  const router = createDeviceRouter({
    deviceService,
    sessionControlService,
    logger,
  });

  return { bus, livenessService, sessionControlService, router, logger };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration — POST /device/:id/session/claim atomicity', () => {
  let stack;

  beforeEach(() => {
    stack = buildStack();
  });

  afterEach(() => {
    stack.livenessService.stop();
    stack = null;
  });

  it('happy path: captures snapshot + dispatches stop → HTTP 200 with snapshot + stoppedAt', async () => {
    const deviceId = 'tv-test';
    const seededSnapshot = makeSnapshot({
      state: 'playing',
      position: 120,
    });

    const fake = installFakeDevice(stack.bus, deviceId);
    seedDeviceOnline(stack.bus, deviceId, seededSnapshot);

    // Sanity: liveness cached the snapshot.
    const cached = stack.livenessService.getLastSnapshot(deviceId);
    expect(cached).toBeTruthy();
    expect(cached.online).toBe(true);
    expect(cached.snapshot).toEqual(seededSnapshot);

    const handler = findHandler(
      stack.router,
      '/:deviceId/session/claim',
      'post',
    );

    const res = makeRes();
    await handler(
      { params: { deviceId }, body: { commandId: 'c-claim-1' } },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      commandId: 'c-claim-1',
      snapshot: seededSnapshot,
    });
    expect(typeof res.body.stoppedAt).toBe('string');

    // Envelope the fake device received was a transport/stop.
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]).toMatchObject({
      type: 'command',
      command: 'transport',
      targetDevice: deviceId,
      commandId: 'c-claim-1',
      params: { action: 'stop' },
    });
  });

  it('refused path: fake device acks stop with ok:false → HTTP 502, snapshot cache unchanged', async () => {
    const deviceId = 'tv-test';
    const seededSnapshot = makeSnapshot({
      state: 'playing',
      position: 120,
    });

    const fake = installFakeDevice(stack.bus, deviceId, {
      ackBuilder: (envelope) => ({
        topic: 'device-ack',
        deviceId,
        commandId: envelope.commandId,
        ok: false,
        code: ERROR_CODES.DEVICE_REFUSED,
        error: 'device refused stop',
      }),
    });
    seedDeviceOnline(stack.bus, deviceId, seededSnapshot);

    // Capture the liveness cache before the claim attempt.
    const beforeCached = stack.livenessService.getLastSnapshot(deviceId);
    expect(beforeCached.snapshot).toEqual(seededSnapshot);

    const handler = findHandler(
      stack.router,
      '/:deviceId/session/claim',
      'post',
    );

    const res = makeRes();
    await handler(
      { params: { deviceId }, body: { commandId: 'c-claim-refuse' } },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_REFUSED,
    });

    // The device-side mock never mutated anything itself, so the liveness
    // cache (which mirrors the last real device-state broadcast) is still
    // the seeded snapshot. This is the observable "nothing changed" check.
    const afterCached = stack.livenessService.getLastSnapshot(deviceId);
    expect(afterCached.snapshot).toEqual(seededSnapshot);
    expect(afterCached.online).toBe(true);

    // One envelope went to the device (the attempted stop).
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]).toMatchObject({
      command: 'transport',
      params: { action: 'stop' },
    });
  });

  it('offline path: returns HTTP 409 DEVICE_OFFLINE with lastKnown, never dispatches to device', async () => {
    const deviceId = 'tv-test';
    const snapshot = makeSnapshot();
    const fake = installFakeDevice(stack.bus, deviceId);

    // Seed, then force-offline by firing the pattern subscriber ourselves
    // with `online:false` — the simplest way to simulate a device that has
    // gone quiet without running 15s of fake timers here.
    seedDeviceOnline(stack.bus, deviceId, snapshot);
    // Force offline by stopping the liveness service and replacing its
    // cached entry via a direct internal broadcast with reason:'offline' —
    // but note the service itself ignores reason:'offline' messages, so we
    // replace the stack with one that has a very short timeout and run
    // timers forward.
    stack.livenessService.stop();

    const shortStack = (() => {
      const logger = makeLogger();
      const bus = new WebSocketEventBus({ logger });
      bus._testSetServerAttached();
      bus._testSetClientPool(new Map());
      const liveness = new DeviceLivenessService({
        eventBus: bus,
        logger,
        offlineTimeoutMs: 5,
      });
      liveness.start();
      bus.setLivenessService(liveness);
      const svc = new SessionControlService({
        eventBus: bus,
        livenessService: liveness,
        logger,
        ackTimeoutMs: 50,
      });
      const deviceService = {
        get: vi.fn(() => null),
        listDevices: vi.fn(() => []),
      };
      const router = createDeviceRouter({
        deviceService, sessionControlService: svc, logger,
      });
      return { bus, liveness, svc, router };
    })();

    const fakeShort = installFakeDevice(shortStack.bus, deviceId);
    seedDeviceOnline(shortStack.bus, deviceId, snapshot);

    // Wait just over the offlineTimeoutMs with real timers (5ms is fast).
    await new Promise((r) => setTimeout(r, 25));
    expect(shortStack.liveness.isOnline(deviceId)).toBe(false);

    const handler = findHandler(
      shortStack.router,
      '/:deviceId/session/claim',
      'post',
    );
    const res = makeRes();
    await handler(
      { params: { deviceId }, body: { commandId: 'c-claim-offline' } },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      lastKnown: snapshot,
    });

    // No command ever reached the device (we short-circuit on offline).
    // The only `received` entries are from any earlier seed steps — here
    // the fake was installed AFTER seeding so received should be empty.
    expect(fakeShort.received).toHaveLength(0);

    shortStack.liveness.stop();
    // Unused but kept as a structural assertion for the local fake on the
    // outer stack (confirms we never polluted it).
    expect(fake.received).toHaveLength(0);
  });
});
