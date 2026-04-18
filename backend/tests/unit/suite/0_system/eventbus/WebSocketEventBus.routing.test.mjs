/**
 * WebSocketEventBus routing tests — verifies per-device topic routing
 * using the shared contracts `parseDeviceTopic` classifier.
 *
 * Uses a mock client pool injected via `_testSetClientPool` and a stubbed
 * server reference via `_testSetServerAttached` so broadcasts traverse the
 * full per-client send path without a real WebSocket server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketEventBus } from '#system/eventbus/WebSocketEventBus.mjs';
import {
  DEVICE_STATE_TOPIC,
  DEVICE_ACK_TOPIC,
  HOMELINE_TOPIC,
  SCREEN_COMMAND_TOPIC,
  CLIENT_CONTROL_TOPIC,
  PLAYBACK_STATE_TOPIC,
} from '#shared-contracts/media/topics.mjs';

/** Simulated open WebSocket ready-state value. */
const OPEN = 1;

function makeClient(subscriptions = []) {
  const ws = {
    readyState: OPEN,
    OPEN,
    send: vi.fn(),
  };
  const meta = { subscriptions: new Set(subscriptions) };
  return { ws, meta };
}

function makePool(clientsById) {
  return new Map(Object.entries(clientsById));
}

function makeBus() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  return { bus, logger };
}

describe('WebSocketEventBus routing — per-device topics', () => {
  let bus, logger, clientTv1, clientTv2, clientWildcard;

  beforeEach(() => {
    const made = makeBus();
    bus = made.bus;
    logger = made.logger;

    clientTv1 = makeClient([
      DEVICE_STATE_TOPIC('tv-1'),
      DEVICE_ACK_TOPIC('tv-1'),
      HOMELINE_TOPIC('tv-1'),
      SCREEN_COMMAND_TOPIC('tv-1'),
    ]);
    clientTv2 = makeClient([
      DEVICE_STATE_TOPIC('tv-2'),
      DEVICE_ACK_TOPIC('tv-2'),
      HOMELINE_TOPIC('tv-2'),
      SCREEN_COMMAND_TOPIC('tv-2'),
    ]);
    clientWildcard = makeClient(['*']);

    bus._testSetClientPool(
      makePool({ 'tv-1': clientTv1, 'tv-2': clientTv2, 'wild': clientWildcard }),
    );
  });

  it('routes device-state:<id> only to that device subscribers (and wildcard)', () => {
    bus.broadcast(DEVICE_STATE_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      snapshot: { status: 'idle' },
      reason: 'heartbeat',
    });

    expect(clientTv1.ws.send).toHaveBeenCalledTimes(1);
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
    // Device-state is a device-scoped kind; wildcard subscribers DO receive
    // (they opted in to everything by design).
    expect(clientWildcard.ws.send).toHaveBeenCalledTimes(1);
  });

  it('routes homeline:<id> only to that device subscribers', () => {
    bus.broadcast(HOMELINE_TOPIC('tv-1'), { step: 'power', status: 'running' });

    expect(clientTv1.ws.send).toHaveBeenCalledTimes(1);
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
  });

  it('routes device-ack:<id> only to that device subscribers', () => {
    bus.broadcast(DEVICE_ACK_TOPIC('tv-1'), {
      deviceId: 'tv-1',
      commandId: 'cmd-1',
      ok: true,
    });

    expect(clientTv1.ws.send).toHaveBeenCalledTimes(1);
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
  });

  it('routes screen:<id> only to that device subscribers (Task 4.1 will tighten to connection identity)', () => {
    // Note: full per-connection identity routing is Task 4.1. For now we
    // deliver to subscribers of the exact topic. See WebSocketEventBus.
    bus.broadcast(SCREEN_COMMAND_TOPIC('tv-1'), {
      command: 'transport',
      params: { action: 'play' },
    });

    expect(clientTv1.ws.send).toHaveBeenCalledTimes(1);
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
    // screen:<id> must NOT leak to wildcard subscribers.
    expect(clientWildcard.ws.send).not.toHaveBeenCalled();
  });

  it('playback_state fans out to all subscribers (including wildcard)', () => {
    const playbackSubscriber = makeClient([PLAYBACK_STATE_TOPIC]);
    bus._testSetClientPool(makePool({
      'tv-1': clientTv1,
      'playback': playbackSubscriber,
      'wild': clientWildcard,
    }));

    bus.broadcast(PLAYBACK_STATE_TOPIC, {
      clientId: 'c1',
      sessionId: 's1',
      state: 'playing',
    });

    expect(playbackSubscriber.ws.send).toHaveBeenCalledTimes(1);
    expect(clientWildcard.ws.send).toHaveBeenCalledTimes(1);
    // tv-1 did not subscribe to playback_state → no delivery.
    expect(clientTv1.ws.send).not.toHaveBeenCalled();
  });

  it('client-control:<clientId> is dropped with a warn (identity not yet tracked; Task 4.1)', () => {
    bus.broadcast(CLIENT_CONTROL_TOPIC('phone-1'), { payload: 'noop' });

    expect(clientTv1.ws.send).not.toHaveBeenCalled();
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
    expect(clientWildcard.ws.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'bus.topic.client_control_unrouted',
      expect.objectContaining({ topic: CLIENT_CONTROL_TOPIC('phone-1') }),
    );
  });

  it('unknown topic with no subscribers drops and logs bus.topic.unknown', () => {
    // Clear all subscriptions so there is no one to receive "weather:today".
    bus._testSetClientPool(makePool({}));

    bus.broadcast('weather:today', { temp: 72 });

    expect(logger.warn).toHaveBeenCalledWith(
      'bus.topic.unknown',
      expect.objectContaining({ topic: 'weather:today' }),
    );
  });

  it('legacy topics (e.g. fitness) with subscribers continue to deliver', () => {
    const fitness = makeClient(['fitness']);
    bus._testSetClientPool(makePool({ 'fitness': fitness }));

    bus.broadcast('fitness', { heartRate: 120 });

    expect(fitness.ws.send).toHaveBeenCalledTimes(1);
  });
});
