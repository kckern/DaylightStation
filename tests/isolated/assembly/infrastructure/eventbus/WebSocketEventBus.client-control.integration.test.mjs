import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { EventBusClientIngressAdapter } from '#adapters/eventbus/EventBusClientIngressAdapter.mjs';
import { ClientIngressService } from '#apps/eventbus/ClientIngressService.mjs';
import { buildClientAck } from '../../../../../frontend/src/modules/Media/externalControl/useExternalControl.js';

function next(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), 1500);
    ws.on('message', function handler(raw) {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer); ws.off('message', handler); resolve(message);
    });
  });
}

describe('WebSocketEventBus client-control round trip', () => {
  it('delivers a command only to its identified live route and returns its ack only to the caller', async () => {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
    await bus.start(server);
    const ingress = new ClientIngressService({ publications: new EventBusClientIngressAdapter({ eventBus: bus }) });
    new EventBusClientIngressAdapter({ eventBus: bus }).attach(ingress);
    const port = server.address().port;
    const caller = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const target = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([once(caller, 'open'), once(target, 'open')]);
    caller.send(JSON.stringify({ type: 'identify', clientId: 'caller', nonce: 'a' }));
    target.send(JSON.stringify({ type: 'identify', clientId: 'target', nonce: 'b' }));
    await Promise.all([next(caller, (m) => m.type === 'identify_ack' && m.ok), next(target, (m) => m.type === 'identify_ack' && m.ok)]);
    const received = next(target, (m) => m.topic === 'client-control:target' && m.commandId === 'cmd-1');
    caller.send(JSON.stringify({ topic: 'client-control:target', commandId: 'cmd-1', command: 'transport', params: { action: 'pause' } }));
    const command = await received;
    expect(command.replyToControlClientId).toBe('caller');
    target.send(JSON.stringify(buildClientAck('target', command, { ok: true })));
    await expect(next(caller, (m) => m.topic === 'client-ack:caller' && m.commandId === 'cmd-1')).resolves.toMatchObject({ clientId: 'target', ok: true });
    caller.close(); target.close(); await bus.stop(); await new Promise((resolve) => server.close(resolve));
  });

  it('allows a duplicate claimant to recover after the old owner explicitly releases its live route', async () => {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
    await bus.start(server);
    const port = server.address().port;
    const oldOwner = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const claimant = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([once(oldOwner, 'open'), once(claimant, 'open')]);

    oldOwner.send(JSON.stringify({ type: 'identify', clientId: 'shared-live-route', nonce: 'owner-1' }));
    await expect(next(oldOwner, (m) => m.type === 'identify_ack' && m.nonce === 'owner-1')).resolves.toMatchObject({ ok: true });
    claimant.send(JSON.stringify({ type: 'identify', clientId: 'shared-live-route', nonce: 'claim-1' }));
    await expect(next(claimant, (m) => m.type === 'identify_ack' && m.nonce === 'claim-1')).resolves.toMatchObject({ ok: false, code: 'IDENTITY_IN_USE' });

    oldOwner.send(JSON.stringify({ type: 'identify_release', clientId: 'shared-live-route' }));
    claimant.send(JSON.stringify({ type: 'identify', clientId: 'shared-live-route', nonce: 'claim-2' }));
    await expect(next(claimant, (m) => m.type === 'identify_ack' && m.nonce === 'claim-2')).resolves.toMatchObject({ ok: true, clientId: 'shared-live-route' });

    oldOwner.close(); claimant.close(); await bus.stop(); await new Promise((resolve) => server.close(resolve));
  });
});
