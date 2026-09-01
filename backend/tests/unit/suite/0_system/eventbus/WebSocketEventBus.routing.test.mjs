/**
 * WebSocketEventBus routing tests — verifies per-device topic routing
 * using the shared contracts `parseDeviceTopic` classifier.
 *
 * Uses a mock client pool injected via `_testSetClientPool` and a stubbed
 * server reference via `_testSetServerAttached` so broadcasts traverse the
 * full per-client send path without a real WebSocket server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
// NOTE: '#system/eventbus/WebSocketEventBus.mjs' does not exist — the class
// lives under 1_adapters, not 0_system (see 0_system/eventbus/index.mjs's own
// doc comment, which points here). Fixed 2026-09-01; this file previously
// failed to import at all (0 tests collected), silently, alongside its two
// siblings in this directory.
import { WebSocketEventBus, isKnownTopic } from '#adapters/eventbus/WebSocketEventBus.mjs';
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
    // Wildcard subscribers DO receive screen:<id>, deliberately. Screens
    // subscribe through predicate filters, which the frontend
    // WebSocketService syncs to the server as '*' and never as the exact
    // `screen:<id>` topic — so excluding wildcard made every
    // SessionControlService command structurally undeliverable (5s
    // DEVICE_REFUSED on all remote control). Screens drop envelopes whose
    // targetDevice isn't theirs, which is what makes this safe. See the
    // `kind === 'screen'` branch in WebSocketEventBus.
    expect(clientWildcard.ws.send).toHaveBeenCalledTimes(1);
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

  it('client-control:<clientId> with an invalid envelope is dropped with envelope-invalid warn', () => {
    // Task 4.1: client-control routing now validates the envelope and
    // delivers only to identified connections. An envelope that is not a
    // valid command envelope is dropped with a targeted warn.
    bus.broadcast(CLIENT_CONTROL_TOPIC('phone-1'), { payload: 'noop' });

    expect(clientTv1.ws.send).not.toHaveBeenCalled();
    expect(clientTv2.ws.send).not.toHaveBeenCalled();
    expect(clientWildcard.ws.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'client-control.envelope-invalid',
      expect.objectContaining({
        topic: CLIENT_CONTROL_TOPIC('phone-1'),
        clientId: 'phone-1',
      }),
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

  it('knows the topics the app actually publishes', () => {
    expect(isKnownTopic('state-gates')).toBe(true);
    expect(isKnownTopic('shutdown.state')).toBe(true);
  });

  it('state-gates and shutdown.state never log bus.topic.unknown, even with zero subscribers', () => {
    // StateGatesEventBusPublisher.mjs broadcasts 'state-gates' four times per
    // assertion (retracted/corrected pairs); app.mjs's shutdown notifier
    // broadcasts 'shutdown.state'. Both are consumed by frontend hooks
    // (AgendaStatusBoard.jsx, useSchoolGameAccess.js, useShutdownLock.js) that
    // mount/unmount with the page — a real client is frequently NOT connected
    // at the moment of publish, but the topic is still documented and known.
    bus._testSetClientPool(makePool({}));

    bus.broadcast('state-gates', { schema: 'daylight.state-gates-event/v1' });
    bus.broadcast('shutdown.state', { locked: true });

    expect(logger.warn).not.toHaveBeenCalledWith(
      'bus.topic.unknown',
      expect.objectContaining({ topic: 'state-gates' }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'bus.topic.unknown',
      expect.objectContaining({ topic: 'shutdown.state' }),
    );
  });

  it('a genuinely unknown topic still warns even after registering known topics', () => {
    // Regression guard for the fix above: registering state-gates/shutdown.state
    // must not turn into a blanket allowlist. A typo'd or orphaned topic with
    // no subscribers must still be caught.
    bus._testSetClientPool(makePool({}));

    bus.broadcast('weather:tomorrow', { temp: 68 });

    expect(logger.warn).toHaveBeenCalledWith(
      'bus.topic.unknown',
      expect.objectContaining({ topic: 'weather:tomorrow' }),
    );
    expect(isKnownTopic('weather:tomorrow')).toBe(false);
  });
});

describe('WebSocketEventBus — device-state replay on subscribe', () => {
  function installClient(bus, clientId, client) {
    const pool = new Map();
    pool.set(clientId, client);
    bus._testSetClientPool(pool);
  }

  it('replays the last snapshot (reason=initial) to a new subscriber of device-state:<id>', () => {
    const liveness = {
      getLastSnapshot: vi.fn((deviceId) =>
        deviceId === 'tv-1'
          ? {
              snapshot: { status: 'playing', position: 42 },
              lastSeenAt: '2026-04-17T00:00:00.000Z',
              online: true,
            }
          : null,
      ),
    };
    const { bus } = makeBus();
    bus.setLivenessService(liveness);

    // Install a client first so subscribeClient can find it.
    const client = makeClient();
    installClient(bus, 'phone-1', client);

    bus.subscribeClient('phone-1', [DEVICE_STATE_TOPIC('tv-1')]);

    expect(liveness.getLastSnapshot).toHaveBeenCalledWith('tv-1');
    expect(client.ws.send).toHaveBeenCalledTimes(1);
    const sentArg = client.ws.send.mock.calls[0][0];
    const parsed = JSON.parse(sentArg);
    expect(parsed.topic).toBe(DEVICE_STATE_TOPIC('tv-1'));
    expect(parsed.deviceId).toBe('tv-1');
    expect(parsed.reason).toBe('initial');
    expect(parsed.snapshot).toMatchObject({ status: 'playing', position: 42 });
  });

  it('does nothing when livenessService has no snapshot for the device', () => {
    const liveness = { getLastSnapshot: vi.fn(() => null) };
    const { bus } = makeBus();
    bus.setLivenessService(liveness);

    const client = makeClient();
    installClient(bus, 'phone-1', client);

    bus.subscribeClient('phone-1', [DEVICE_STATE_TOPIC('tv-1')]);

    expect(liveness.getLastSnapshot).toHaveBeenCalledWith('tv-1');
    expect(client.ws.send).not.toHaveBeenCalled();
  });

  it('skips replay when no livenessService is wired (legacy bootstrap)', () => {
    const { bus } = makeBus();
    // intentionally no setLivenessService

    const client = makeClient();
    installClient(bus, 'phone-1', client);

    bus.subscribeClient('phone-1', [DEVICE_STATE_TOPIC('tv-1')]);

    expect(client.ws.send).not.toHaveBeenCalled();
  });

  it('only replays for device-state:<id> — other device topics do not trigger replay', () => {
    const liveness = {
      getLastSnapshot: vi.fn(() => ({
        snapshot: { status: 'playing' },
        lastSeenAt: '2026-04-17T00:00:00.000Z',
        online: true,
      })),
    };
    const { bus } = makeBus();
    bus.setLivenessService(liveness);

    const client = makeClient();
    installClient(bus, 'phone-1', client);

    bus.subscribeClient('phone-1', [
      HOMELINE_TOPIC('tv-1'),
      DEVICE_ACK_TOPIC('tv-1'),
      SCREEN_COMMAND_TOPIC('tv-1'),
    ]);

    expect(liveness.getLastSnapshot).not.toHaveBeenCalled();
    expect(client.ws.send).not.toHaveBeenCalled();
  });
});
