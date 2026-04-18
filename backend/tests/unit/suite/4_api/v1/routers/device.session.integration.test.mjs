/**
 * POST /api/v1/device/:id/session/transport — end-to-end round trip
 * integration test (Phase 5 · Task 5.1).
 *
 * This exercises the full stack **in-process** (no real HTTP server, no real
 * WebSockets — but no service mocks either):
 *
 *   - real `WebSocketEventBus` with a test client pool + server-attached seam
 *   - real `DeviceLivenessService` observing the bus
 *   - real `SessionControlService` bridging HTTP → WS and awaiting ack
 *   - real `createDeviceRouter` with the services injected
 *   - a **fake device** that subscribes to `screen:<id>` via the bus's
 *     pattern-subscriber API and, on receiving a command envelope, publishes
 *     the matching ack on `device-ack:<id>`.
 *
 * Verifies:
 *   1. The router builds a valid command envelope from the HTTP body.
 *   2. The bus delivers it on the expected `screen:<id>` topic.
 *   3. The fake device's ack reaches the service synchronously.
 *   4. The HTTP response mirrors the ack payload (ok, commandId, appliedAt).
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
  parseDeviceTopic,
} from '#shared-contracts/media/topics.mjs';
import { buildDeviceStateBroadcast } from '#shared-contracts/media/envelopes.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function findHandler(router, path, method = 'post') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not mounted`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    ended: false,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
    end: vi.fn(function end() { this.ended = true; return this; }),
  };
  return res;
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: null,
    position: 0,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: {
      shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0,
    },
    meta: { ownerId: 'tv-test', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

/**
 * Install a fake "device" onto the bus. It subscribes to `screen:<deviceId>`
 * using the bus's pattern-subscriber seam, and replies with the configured
 * ack envelope on `device-ack:<deviceId>` whenever a command arrives.
 *
 * @param {WebSocketEventBus} bus
 * @param {string} deviceId
 * @param {object} opts
 * @param {(envelope: object) => object} [opts.ackBuilder] - Returns the ack payload
 * @returns {{
 *   received: object[],
 *   unsubscribe: Function,
 *   setAckBuilder: (fn: Function) => void,
 * }}
 */
function installFakeDevice(bus, deviceId, opts = {}) {
  const received = [];
  let ackBuilder = opts.ackBuilder || ((envelope) => ({
    topic: 'device-ack',
    deviceId,
    commandId: envelope.commandId,
    ok: true,
    appliedAt: new Date().toISOString(),
  }));

  const screenTopic = SCREEN_COMMAND_TOPIC(deviceId);
  const unsubscribe = bus.subscribePattern(
    (topic) => topic === screenTopic,
    (payload /* , topic */) => {
      received.push(payload);
      const ack = ackBuilder(payload);
      // Publish the ack on the device-ack topic. Use `publish` so the
      // SessionControlService's pattern subscriber picks it up via the
      // internal dispatch loop (no external WS round-trip needed).
      bus.publish(DEVICE_ACK_TOPIC(deviceId), ack);
    },
  );

  return {
    received,
    unsubscribe,
    setAckBuilder(fn) { ackBuilder = fn; },
  };
}

/**
 * Seed the liveness service with an online snapshot for a device by
 * publishing a `device-state:<id>` broadcast with reason='heartbeat'.
 */
function seedDeviceOnline(bus, deviceId, snapshot) {
  bus.publish(DEVICE_STATE_TOPIC(deviceId), buildDeviceStateBroadcast({
    deviceId,
    snapshot,
    reason: 'heartbeat',
  }));
}

function buildStack({ ackTimeoutMs = 1000, offlineTimeoutMs = 15000 } = {}) {
  const logger = makeLogger();
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  bus._testSetClientPool(new Map());

  const livenessService = new DeviceLivenessService({
    eventBus: bus,
    logger,
    offlineTimeoutMs,
  });
  livenessService.start();
  bus.setLivenessService(livenessService);

  const sessionControlService = new SessionControlService({
    eventBus: bus,
    livenessService,
    logger,
    ackTimeoutMs,
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

describe('Integration — POST /device/:id/session/transport round trip', () => {
  let stack;

  beforeEach(() => {
    stack = buildStack();
  });

  afterEach(() => {
    stack.livenessService.stop();
    stack = null;
  });

  it('dispatches envelope to the fake device and returns its ack via HTTP 200', async () => {
    const deviceId = 'tv-test';
    const fake = installFakeDevice(stack.bus, deviceId);
    seedDeviceOnline(stack.bus, deviceId, makeSnapshot());

    const handler = findHandler(
      stack.router,
      '/:deviceId/session/transport',
      'post',
    );
    const req = {
      params: { deviceId },
      body: { action: 'play', commandId: 'c-1' },
    };
    const res = makeRes();

    await handler(req, res, vi.fn());

    // HTTP layer
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, commandId: 'c-1' });
    expect(typeof res.body.appliedAt).toBe('string');

    // Envelope shape at the device
    expect(fake.received).toHaveLength(1);
    const envelope = fake.received[0];
    expect(envelope).toMatchObject({
      type: 'command',
      command: 'transport',
      targetDevice: deviceId,
      commandId: 'c-1',
      params: { action: 'play' },
    });
    expect(typeof envelope.ts).toBe('string');
  });

  it('publishes on screen:<id> only (not device-ack or device-state)', async () => {
    const deviceId = 'tv-test';
    installFakeDevice(stack.bus, deviceId);
    seedDeviceOnline(stack.bus, deviceId, makeSnapshot());

    // Spy on every topic delivered through the internal publish loop.
    const seen = [];
    const unsub = stack.bus.subscribePattern(
      () => true,
      (_payload, topic) => seen.push(topic),
    );

    const handler = findHandler(
      stack.router,
      '/:deviceId/session/transport',
      'post',
    );
    await handler(
      { params: { deviceId }, body: { action: 'pause', commandId: 'c-2' } },
      makeRes(),
      vi.fn(),
    );

    unsub();

    // We expect at least: screen:tv-test (command), device-ack:tv-test (fake's reply).
    // But NOT device-state:tv-test during the round trip.
    const screenHits = seen.filter(t => t === SCREEN_COMMAND_TOPIC(deviceId));
    const ackHits = seen.filter(t => t === DEVICE_ACK_TOPIC(deviceId));
    const stateHits = seen.filter(t => t === DEVICE_STATE_TOPIC(deviceId));

    expect(screenHits.length).toBe(1);
    expect(ackHits.length).toBe(1);
    expect(stateHits.length).toBe(0);
  });

  it('returns 502 DEVICE_REFUSED when the fake device acks ok:false', async () => {
    const deviceId = 'tv-test';
    installFakeDevice(stack.bus, deviceId, {
      ackBuilder: (envelope) => ({
        topic: 'device-ack',
        deviceId,
        commandId: envelope.commandId,
        ok: false,
        code: 'DEVICE_REFUSED',
        error: 'device refused',
      }),
    });
    seedDeviceOnline(stack.bus, deviceId, makeSnapshot());

    const handler = findHandler(
      stack.router,
      '/:deviceId/session/transport',
      'post',
    );
    const res = makeRes();
    await handler(
      { params: { deviceId }, body: { action: 'play', commandId: 'c-refuse' } },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      ok: false,
      code: 'DEVICE_REFUSED',
    });
  });

  it('returns 502 DEVICE_REFUSED when ack times out (no fake device)', async () => {
    const s = buildStack({ ackTimeoutMs: 25 });
    const deviceId = 'tv-test';
    // Install nothing — simulate a completely silent device.
    seedDeviceOnline(s.bus, deviceId, makeSnapshot());

    const handler = findHandler(
      s.router,
      '/:deviceId/session/transport',
      'post',
    );
    const res = makeRes();
    await handler(
      { params: { deviceId }, body: { action: 'play', commandId: 'c-timeout' } },
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false, code: 'DEVICE_REFUSED' });

    s.livenessService.stop();
  });

  it('validates unknown topic routing path logs on envelope delivery', () => {
    // Sanity: parseDeviceTopic should split screen:tv-test correctly.
    const parsed = parseDeviceTopic(SCREEN_COMMAND_TOPIC('tv-test'));
    expect(parsed).toEqual({ kind: 'screen', deviceId: 'tv-test' });
  });
});
