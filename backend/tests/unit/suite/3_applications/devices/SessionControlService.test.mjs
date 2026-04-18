/**
 * SessionControlService — HTTP→WS command bridge tests.
 *
 * Uses `vi.useFakeTimers()` plus a mock event bus that captures pattern
 * subscribers so the test can deliver ack / device-state broadcasts on
 * demand. No real WebSockets — this is a pure unit test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SessionControlService } from '#apps/devices/services/SessionControlService.mjs';
import {
  SCREEN_COMMAND_TOPIC,
  DEVICE_ACK_TOPIC,
  DEVICE_STATE_TOPIC,
} from '#shared-contracts/media/topics.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  const published = [];

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
      published.push({ topic, payload });
    }),
    publish: vi.fn(),
    _deliver(topic, payload) {
      for (const { predicate, handler } of [...patternHandlers]) {
        if (predicate(topic)) handler(payload, topic);
      }
    },
    _patternHandlers: patternHandlers,
    _published: published,
  };
}

function makeLiveness(snapshot = null) {
  return {
    _snapshot: snapshot,
    getLastSnapshot: vi.fn((deviceId) => {
      const s = snapshot;
      if (!s) return null;
      if (s.deviceId && s.deviceId !== deviceId) return null;
      return {
        snapshot: s.snapshot,
        lastSeenAt: s.lastSeenAt ?? new Date().toISOString(),
        online: s.online ?? true,
      };
    }),
  };
}

function validTransportEnvelope(overrides = {}) {
  return {
    type: 'command',
    targetDevice: 'tv-1',
    command: 'transport',
    params: { action: 'play' },
    commandId: 'cmd-abc',
    ts: '2026-04-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeSessionSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: null,
    position: 0,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionControlService', () => {
  let clock, bus, liveness, logger, service;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = makeClock();
    bus = makeMockBus();
    liveness = makeLiveness({
      deviceId: 'tv-1',
      snapshot: makeSessionSnapshot(),
      online: true,
    });
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    service = new SessionControlService({
      eventBus: bus,
      livenessService: liveness,
      logger,
      clock,
      ackTimeoutMs: 5000,
      idempotencyTtlMs: 60000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('requires eventBus', () => {
      expect(() => new SessionControlService({ livenessService: liveness })).toThrow(
        /requires eventBus/,
      );
    });

    it('requires livenessService', () => {
      expect(() => new SessionControlService({ eventBus: bus })).toThrow(
        /requires livenessService/,
      );
    });
  });

  describe('sendCommand — happy path', () => {
    it('publishes + resolves with ack when device is online', async () => {
      const env = validTransportEnvelope();
      const promise = service.sendCommand(env);

      // Arm subscription happens synchronously; allow microtasks to flush.
      await Promise.resolve();

      // Bus should have published on screen:<id>.
      expect(bus.broadcast).toHaveBeenCalledTimes(1);
      expect(bus.broadcast).toHaveBeenCalledWith(
        SCREEN_COMMAND_TOPIC('tv-1'),
        env,
      );

      // Simulate the ack arriving 100ms later.
      clock.advance(100);
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        topic: 'device-ack',
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
        appliedAt: '2026-04-17T00:00:00.100Z',
      });

      const result = await promise;
      expect(result).toEqual({
        ok: true,
        commandId: 'cmd-abc',
        appliedAt: '2026-04-17T00:00:00.100Z',
      });
    });

    it('unsubscribes the ack handler after ack arrives', async () => {
      const env = validTransportEnvelope();
      const promise = service.sendCommand(env);
      await Promise.resolve();

      expect(bus._patternHandlers.length).toBe(1);

      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
      });

      await promise;
      expect(bus._patternHandlers.length).toBe(0);
    });
  });

  describe('sendCommand — validation', () => {
    it('rejects invalid envelope with INVALID_ENVELOPE', async () => {
      const result = await service.sendCommand({
        commandId: 'bad',
        command: 'nonsense',
        params: {},
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_ENVELOPE');
      expect(bus.broadcast).not.toHaveBeenCalled();
    });

    it('rejects envelope without targetDevice with DEVICE_NOT_FOUND', async () => {
      const env = validTransportEnvelope({ targetDevice: undefined });
      const result = await service.sendCommand(env);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_NOT_FOUND);
      expect(bus.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('sendCommand — offline gate', () => {
    it('returns DEVICE_OFFLINE without publishing', async () => {
      const offlineSnap = makeSessionSnapshot({ state: 'idle' });
      liveness = makeLiveness({
        deviceId: 'tv-1',
        snapshot: offlineSnap,
        online: false,
      });
      service = new SessionControlService({
        eventBus: bus,
        livenessService: liveness,
        logger,
        clock,
      });

      const env = validTransportEnvelope();
      const result = await service.sendCommand(env);

      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_OFFLINE);
      expect(result.lastKnown).toBe(offlineSnap);
      expect(bus.broadcast).not.toHaveBeenCalled();
    });

    it('still publishes when liveness has no record at all', async () => {
      liveness = makeLiveness(null);
      service = new SessionControlService({
        eventBus: bus,
        livenessService: liveness,
        logger,
        clock,
      });

      const env = validTransportEnvelope();
      const promise = service.sendCommand(env);
      await Promise.resolve();

      expect(bus.broadcast).toHaveBeenCalledTimes(1);

      // Cancel the pending ack subscription by sending a timeout.
      vi.advanceTimersByTime(5000);
      const result = await promise;
      expect(result.code).toBe(ERROR_CODES.DEVICE_REFUSED); // timed out — expected
    });
  });

  describe('sendCommand — timeout', () => {
    it('returns DEVICE_REFUSED with "Timeout waiting for ack" when no ack arrives', async () => {
      const env = validTransportEnvelope();
      const promise = service.sendCommand(env);
      await Promise.resolve();

      vi.advanceTimersByTime(5000);

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_REFUSED);
      expect(result.error).toMatch(/Timeout/);
      expect(bus._patternHandlers.length).toBe(0);
    });
  });

  describe('sendCommand — idempotency', () => {
    it('replays cached ack on identical replay within TTL (no re-publish)', async () => {
      const env = validTransportEnvelope();

      // First attempt — ack with ok: true.
      const p1 = service.sendCommand(env);
      await Promise.resolve();
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
        appliedAt: '2026-04-17T00:00:00.050Z',
      });
      const first = await p1;
      expect(first.ok).toBe(true);
      expect(bus.broadcast).toHaveBeenCalledTimes(1);

      // Second attempt within TTL — identical payload. Should NOT re-publish.
      clock.advance(30_000);
      const second = await service.sendCommand(env);
      expect(second).toEqual(first);
      expect(bus.broadcast).toHaveBeenCalledTimes(1);
    });

    it('returns IDEMPOTENCY_CONFLICT for same commandId with different payload', async () => {
      const envA = validTransportEnvelope();
      const pA = service.sendCommand(envA);
      await Promise.resolve();
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
      });
      await pA;

      // Same commandId, different params -> conflict.
      const envB = validTransportEnvelope({ params: { action: 'pause' } });
      const resB = await service.sendCommand(envB);
      expect(resB.ok).toBe(false);
      expect(resB.code).toBe(ERROR_CODES.IDEMPOTENCY_CONFLICT);
      // No additional publish — the conflict is detected before publish.
      expect(bus.broadcast).toHaveBeenCalledTimes(1);
    });

    it('treats a repeat after TTL expiry as a fresh command (re-publishes)', async () => {
      const env = validTransportEnvelope();

      const p1 = service.sendCommand(env);
      await Promise.resolve();
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
      });
      await p1;
      expect(bus.broadcast).toHaveBeenCalledTimes(1);

      // Advance past TTL (60s).
      clock.advance(61_000);

      const p2 = service.sendCommand(env);
      await Promise.resolve();
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
      });
      await p2;
      expect(bus.broadcast).toHaveBeenCalledTimes(2);
    });

    it('ts differences in the envelope do NOT trigger a conflict', async () => {
      const envA = validTransportEnvelope({ ts: '2026-04-17T00:00:00.000Z' });
      const p1 = service.sendCommand(envA);
      await Promise.resolve();
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'cmd-abc',
        ok: true,
        appliedAt: 'x',
      });
      const first = await p1;

      const envB = validTransportEnvelope({ ts: '2026-04-17T00:05:00.000Z' });
      const second = await service.sendCommand(envB);
      expect(second).toEqual(first);
      expect(bus.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSnapshot', () => {
    it('passes through to livenessService', () => {
      const result = service.getSnapshot('tv-1');
      expect(liveness.getLastSnapshot).toHaveBeenCalledWith('tv-1');
      expect(result?.online).toBe(true);
    });

    it('returns null for unknown device', () => {
      expect(service.getSnapshot('never-seen')).toBeNull();
    });
  });

  describe('claim — atomic Take Over', () => {
    it('happy path: returns { ok, snapshot, stoppedAt } after stop ack success', async () => {
      // Liveness already returns online + a snapshot in beforeEach.
      const promise = service.claim('tv-1', { commandId: 'claim-1' });
      await Promise.resolve();

      // A transport/stop command should have been published.
      expect(bus.broadcast).toHaveBeenCalledTimes(1);
      const [topic, envelope] = bus.broadcast.mock.calls[0];
      expect(topic).toBe(SCREEN_COMMAND_TOPIC('tv-1'));
      expect(envelope).toMatchObject({
        type: 'command',
        targetDevice: 'tv-1',
        command: 'transport',
        commandId: 'claim-1',
        params: { action: 'stop' },
      });
      expect(typeof envelope.ts).toBe('string');

      // Deliver the ack.
      bus._deliver(DEVICE_ACK_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        commandId: 'claim-1',
        ok: true,
        appliedAt: 'now',
      });

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.commandId).toBe('claim-1');
      expect(result.snapshot).toBeTruthy();
      expect(result.snapshot.sessionId).toBe('sess-1');
      expect(typeof result.stoppedAt).toBe('string');
    });

    it('offline: returns DEVICE_OFFLINE without publishing when liveness says offline', async () => {
      const offlineSnap = makeSessionSnapshot({ state: 'idle' });
      liveness = makeLiveness({
        deviceId: 'tv-1',
        snapshot: offlineSnap,
        online: false,
      });
      service = new SessionControlService({
        eventBus: bus,
        livenessService: liveness,
        logger,
        clock,
      });

      const result = await service.claim('tv-1', { commandId: 'claim-1' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_OFFLINE);
      expect(result.lastKnown).toBe(offlineSnap);
      expect(bus.broadcast).not.toHaveBeenCalled();
    });

    it('no record: returns DEVICE_OFFLINE with null lastKnown', async () => {
      liveness = makeLiveness(null);
      service = new SessionControlService({
        eventBus: bus,
        livenessService: liveness,
        logger,
        clock,
      });

      const result = await service.claim('tv-1', { commandId: 'claim-1' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_OFFLINE);
      expect(result.lastKnown).toBeNull();
      expect(bus.broadcast).not.toHaveBeenCalled();
    });

    it('stop ack refusal: propagates DEVICE_REFUSED with lastKnown', async () => {
      const promise = service.claim('tv-1', { commandId: 'claim-ref' });
      await Promise.resolve();

      // Simulate timeout → ack never arrives → service returns DEVICE_REFUSED.
      vi.advanceTimersByTime(5000);

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DEVICE_REFUSED);
      // lastKnown stamped from captured snapshot so client can restore.
      expect(result.lastKnown).toBeTruthy();
      expect(result.lastKnown.sessionId).toBe('sess-1');
    });

    it('rejects missing commandId', async () => {
      const result = await service.claim('tv-1', {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe('VALIDATION');
      expect(bus.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('waitForStateChange', () => {
    it('resolves when predicate matches an incoming snapshot', async () => {
      const p = service.waitForStateChange(
        'tv-1',
        (snap) => snap.state === 'playing',
        1000,
      );
      await Promise.resolve();
      expect(bus._patternHandlers.length).toBe(1);

      bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        reason: 'change',
        snapshot: makeSessionSnapshot({ state: 'playing' }),
      });

      const snap = await p;
      expect(snap.state).toBe('playing');
      // Cleanup on resolve.
      expect(bus._patternHandlers.length).toBe(0);
    });

    it('ignores broadcasts that do not satisfy the predicate', async () => {
      const p = service.waitForStateChange(
        'tv-1',
        (snap) => snap.state === 'paused',
        1000,
      );
      await Promise.resolve();

      bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        reason: 'change',
        snapshot: makeSessionSnapshot({ state: 'playing' }),
      });

      // No resolution yet.
      expect(bus._patternHandlers.length).toBe(1);

      bus._deliver(DEVICE_STATE_TOPIC('tv-1'), {
        deviceId: 'tv-1',
        reason: 'change',
        snapshot: makeSessionSnapshot({ state: 'paused' }),
      });

      const snap = await p;
      expect(snap.state).toBe('paused');
    });

    it('rejects with STATE_WAIT_TIMEOUT on timeout and cleans up', async () => {
      const p = service.waitForStateChange(
        'tv-1',
        () => false,
        500,
      );
      await Promise.resolve();
      expect(bus._patternHandlers.length).toBe(1);

      vi.advanceTimersByTime(500);

      await expect(p).rejects.toMatchObject({ code: 'STATE_WAIT_TIMEOUT' });
      expect(bus._patternHandlers.length).toBe(0);
    });
  });
});
