import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { registerClientIngress } from './clientIngress.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

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

  it('is the registration path invoked by the production application root', async () => {
    const appSource = await readFile(new URL('../../app.mjs', import.meta.url), 'utf8');
    expect(appSource).toContain("import { registerClientIngress } from '#composition/modules/clientIngress.mjs';");
    expect(appSource.match(/registerClientIngress\(\{/g)).toHaveLength(1);
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
