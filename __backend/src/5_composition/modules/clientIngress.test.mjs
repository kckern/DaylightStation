import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { registerClientIngress } from './clientIngress.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A fake bus recording exactly what `EventBusClientIngressAdapter.attach` and
 * `EventBusPlaybackStateRelay.attach` actually call on it (both read to
 * confirm): `setClientSubscriptionAuthorizer`, `setClientMessageAuthorizer`,
 * `onClientDisconnection`, `onClientMessage`, `broadcast`, `sendToClient`,
 * `getClientMeta`. Neither ever calls `.subscribe()`, so this fake omits it.
 */
function fakeBus() {
  const calls = [];
  const handlers = { message: [], disconnect: [] };
  let subAuth = null;
  let msgAuth = null;
  return {
    calls,
    setClientSubscriptionAuthorizer: fn => { subAuth = fn; },
    setClientMessageAuthorizer: fn => { msgAuth = fn; },
    onClientDisconnection: fn => handlers.disconnect.push(fn),
    onClientMessage: fn => handlers.message.push(fn),
    broadcast: (topic, payload) => calls.push(['broadcast', topic, payload]),
    sendToClient: (id, payload) => calls.push(['send', id, payload]),
    getClientMeta: () => ({ ip: '10.0.0.5', userAgent: 'UA', clientId: 'ctl-1' }),
    emit: (clientId, message) => handlers.message.forEach(h => h(clientId, message)),
    disconnect: clientId => handlers.disconnect.forEach(h => h(clientId)),
    get subAuth() { return subAuth; },
    get msgAuth() { return msgAuth; },
  };
}

// Every message kind the inline `app.mjs` router handled as of 480a3f9e3
// (2026-09-22) — confirmed byte-identical against current main's router
// region, so no additional row is needed for anything main gained since.
const ROWS = [
  ['fitness', { source: 'fitness', type: 'hr', v: 1 }, [['broadcast', 'fitness', { source: 'fitness', type: 'hr', v: 1 }]]],
  ['fitness-simulator', { source: 'fitness-simulator', x: 1 }, [['broadcast', 'fitness', { source: 'fitness-simulator', x: 1 }]]],
  ['piano midi', { source: 'piano', topic: 'midi', type: 'note_on', timestamp: 5, sessionId: 's', data: { n: 60 }, extra: 'dropped' },
    [['broadcast', 'midi', { source: 'piano', type: 'note_on', timestamp: 5, sessionId: 's', data: { n: 60 } }]]],
  ['piano midi invalid', { source: 'piano', topic: 'midi' }, []],
  ['homeline device topic', { topic: 'homeline:livingroom-tv', type: 'wake' }, [['broadcast', 'homeline:livingroom-tv', { topic: 'homeline:livingroom-tv', type: 'wake' }]]],
  ['homeline call topic', { topic: 'homeline-call:abc', type: 'offer' }, [['broadcast', 'homeline-call:abc', { topic: 'homeline-call:abc', type: 'offer' }]]],
  ['device-state', { topic: 'device-state', deviceId: 'tv', snapshot: { state: 'playing' }, ts: 't' },
    [['broadcast', 'device-state:tv', { deviceId: 'tv', snapshot: { state: 'playing' }, reason: 'change', ts: 't' }]]],
  ['device-ack', { topic: 'device-ack', deviceId: 'tv', commandId: 'c' }, [['broadcast', 'device-ack:tv', { topic: 'device-ack', deviceId: 'tv', commandId: 'c' }]]],
  // Real topics from ClientRelayPolicy.mjs.
  ['bt relay', { topic: 'bt.pair.request' }, [['broadcast', 'bt.pair.request', { topic: 'bt.pair.request' }]]],
  ['kiosk relay', { topic: 'kiosk.launch', deviceId: 'k' }, [['broadcast', 'kiosk.launch', { topic: 'kiosk.launch', deviceId: 'k' }]]],
  ['unknown', { topic: 'nothing-here' }, []],
];

function connect(url) {
  const socket = new WebSocket(url);
  const pending = [];
  const waiters = [];
  socket.on('message', raw => {
    const message = JSON.parse(String(raw));
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else pending.push(message);
  });
  const waitFor = predicate => {
    const found = pending.findIndex(predicate);
    if (found >= 0) return Promise.resolve(pending.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('client-ingress-test-timeout')), 2000);
      waiters.push({ predicate, resolve: value => { clearTimeout(timeout); resolve(value); } });
    });
  };
  return {
    socket,
    opened: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    waitFor,
  };
}

describe('production client ingress composition', () => {
  const resources = [];
  afterEach(async () => {
    for (const resource of resources.splice(0).reverse()) await resource();
  });

  it('is the registration path invoked by the production application root, with no leftover inline router or authorizers', async () => {
    const appSource = await readFile(new URL('../../app.mjs', import.meta.url), 'utf8');
    expect(appSource).toContain("import { registerClientIngress } from '#composition/modules/clientIngress.mjs';");
    expect(appSource.match(/registerClientIngress\(\{/g)).toHaveLength(1);
    // The inline router this composition replaces is gone — not just moved.
    expect(appSource).not.toContain("message.source === 'fitness'");
    expect(appSource).not.toContain('setClientSubscriptionAuthorizer');
    expect(appSource).not.toContain('setClientMessageAuthorizer');
    expect(appSource).not.toContain('EventBusPlaybackStateRelay');
    expect(appSource).not.toContain('shouldRelayBtTopic');
    expect(appSource).not.toContain('shouldRelayKioskLaunchTopic');
  });

  describe.each(ROWS)('row: %s', (_name, message, expectedCalls) => {
    it('routes exactly as the production inline router did', () => {
      const bus = fakeBus();
      registerClientIngress({ eventBus: bus, logger: quiet });
      bus.emit('c1', message);
      expect(bus.calls).toEqual(expectedCalls);
    });
  });

  describe('homeline-authorize', () => {
    it('acks with the lease service result', () => {
      const bus = fakeBus();
      registerClientIngress({
        eventBus: bus,
        getCallLeaseService: () => ({ authorize: vi.fn(() => ({ ok: true, lease: 'L' })) }),
        logger: quiet,
      });
      bus.emit('c1', { type: 'homeline-authorize', topic: 'homeline-call:abc' });
      expect(bus.calls).toEqual([
        ['send', 'c1', { type: 'homeline-authorize-ack', topic: 'homeline-call:abc', ok: true, lease: 'L' }],
      ]);
    });

    it('acks LEASES_NOT_READY when no lease service is available yet', () => {
      const bus = fakeBus();
      registerClientIngress({ eventBus: bus, getCallLeaseService: () => null, logger: quiet });
      bus.emit('c1', { type: 'homeline-authorize', topic: 'homeline-call:abc' });
      expect(bus.calls).toEqual([
        ['send', 'c1', { type: 'homeline-authorize-ack', topic: 'homeline-call:abc', ok: false, code: 'LEASES_NOT_READY' }],
      ]);
    });
  });

  describe('authorizers', () => {
    it('subscription authorizer allows everything except homeline-call topics, which need the lease service', () => {
      const bus = fakeBus();
      registerClientIngress({ eventBus: bus, logger: quiet });
      expect(bus.subAuth('c1', 'fitness')).toBe(true);
      expect(bus.subAuth('c1', 'homeline-call:x')).toBe(false);
    });

    it('message authorizer defers homeline-call signals to validateSignal and passes everything else through', () => {
      const bus = fakeBus();
      registerClientIngress({ eventBus: bus, logger: quiet });
      expect(bus.msgAuth('c1', { topic: 'homeline-call:x' })).toEqual({ ok: false, code: 'LEASES_NOT_READY' });
      expect(bus.msgAuth('c1', { topic: 'fitness' })).toEqual({ ok: true, message: { topic: 'fitness' } });
    });
  });

  describe('disconnect', () => {
    it('forwards a disconnecting client to the call lease service', () => {
      const bus = fakeBus();
      const disconnect = vi.fn();
      registerClientIngress({ eventBus: bus, getCallLeaseService: () => ({ disconnect }), logger: quiet });
      bus.disconnect('c1');
      expect(disconnect).toHaveBeenCalledWith('c1');
    });
  });

  describe('logging', () => {
    it('ingests with exactly { ip, userAgent } metadata and routes onEvent to fitness presence', () => {
      const bus = fakeBus();
      const ingest = vi.fn();
      const observe = vi.fn();
      registerClientIngress({
        eventBus: bus,
        frontendLogIngestion: { ingest },
        getFitnessPresence: () => ({ observe }),
        logger: quiet,
      });
      const message = { topic: 'logging', events: [] };
      bus.emit('c1', message);

      expect(ingest).toHaveBeenCalledTimes(1);
      const [ingestedMessage, metadata, { onEvent }] = ingest.mock.calls[0];
      expect(ingestedMessage).toBe(message);
      expect(metadata).toEqual({ ip: '10.0.0.5', userAgent: 'UA' });
      expect(Object.keys(metadata).sort()).toEqual(['ip', 'userAgent']);

      onEvent('normalized-event');
      expect(observe).toHaveBeenCalledWith('normalized-event');
    });

    it('also ingests playback-logger-sourced messages', () => {
      const bus = fakeBus();
      const ingest = vi.fn();
      registerClientIngress({ eventBus: bus, frontendLogIngestion: { ingest }, logger: quiet });
      bus.emit('c1', { source: 'playback-logger', events: [] });
      expect(ingest).toHaveBeenCalledTimes(1);
    });
  });

  it('routes raw identified client control to its stable owner and returns the owner ACK', async () => {
    const server = http.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const bus = new WebSocketEventBus({ logger: quiet });
    await bus.start(server);
    resources.push(async () => bus.stop());
    resources.push(async () => new Promise(resolve => server.close(resolve)));

    registerClientIngress({ eventBus: bus, logger: quiet });
    const url = `ws://127.0.0.1:${server.address().port}/ws`;
    const caller = connect(url);
    const owner = connect(url);
    resources.push(async () => caller.socket.close());
    resources.push(async () => owner.socket.close());
    await Promise.all([caller.opened, owner.opened]);

    caller.socket.send(JSON.stringify({ type: 'identify', clientId: 'stable-caller', nonce: 'caller-nonce' }));
    owner.socket.send(JSON.stringify({ type: 'identify', clientId: 'stable-owner', nonce: 'owner-nonce' }));
    await Promise.all([
      caller.waitFor(message => message.type === 'identify_ack' && message.clientId === 'stable-caller'),
      owner.waitFor(message => message.type === 'identify_ack' && message.clientId === 'stable-owner'),
    ]);

    caller.socket.send(JSON.stringify({
      topic: 'client-control:stable-owner', commandId: 'round-trip-1', command: 'transport',
      params: { action: 'pause' }, origin: { kind: 'device', id: 'browser:stable-caller' },
    }));
    const command = await owner.waitFor(message => message.topic === 'client-control:stable-owner');
    expect(command).toMatchObject({
      commandId: 'round-trip-1', replyToControlClientId: 'stable-caller',
      origin: { kind: 'device', id: 'browser:stable-caller' },
    });

    owner.socket.send(JSON.stringify({
      topic: 'client-ack', clientId: 'stable-owner', replyToControlClientId: command.replyToControlClientId,
      commandId: command.commandId, ok: true,
    }));
    await expect(caller.waitFor(message => message.topic === 'client-ack:stable-caller')).resolves.toMatchObject({
      commandId: 'round-trip-1', clientId: 'stable-owner', ok: true,
    });
  });
});
