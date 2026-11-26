import { describe, it, expect, vi } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';

// A device without a socket (the phone app over HTTP) reaches the bus as if it had
// one: the same authorizer and handlers, so waitForMessage and liveness see it.
describe('WebSocketEventBus.publishAsClient', () => {
  const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it('resolves a waitForMessage and reaches every client-message handler', async () => {
    const bus = new WebSocketEventBus({ logger: logger() });
    const seen = [];
    bus.onClientMessage((clientId, message) => seen.push([clientId, message.topic]));
    const ack = bus.waitForMessage((m) => m.topic === 'device-ack' && m.commandId === 'd1', 1000);
    bus.publishAsClient('phone-inbox:phone', { topic: 'device-ack', deviceId: 'phone', commandId: 'd1', ok: true });
    expect((await ack).ok).toBe(true);
    expect(seen).toEqual([['phone-inbox:phone', 'device-ack']]);
  });

  it('runs the message authorizer like a socket message', () => {
    const bus = new WebSocketEventBus({ logger: logger() });
    const seen = [];
    bus.onClientMessage((_c, m) => seen.push(m.topic));
    bus.setClientMessageAuthorizer((_c, m) => (m.topic === 'blocked' ? { ok: false, code: 'NO' } : { ok: true }));
    bus.publishAsClient('x', { topic: 'blocked' });
    bus.publishAsClient('x', { topic: 'device-state' });
    bus.publishAsClient('x', null);
    expect(seen).toEqual(['device-state']);
  });
});
