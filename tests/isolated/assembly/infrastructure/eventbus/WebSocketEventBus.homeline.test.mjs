import { describe, expect, it, vi } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';

const socket = () => ({ OPEN: 1, readyState: 1, send: vi.fn() });

describe('WebSocketEventBus Home Line isolation', () => {
  it('rejects unauthorized call-topic subscriptions', () => {
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, debug() {}, error() {} } });
    const ws = socket(); const pool = new Map([['client', { ws, meta: { subscriptions: new Set() } }]]);
    bus._testSetClientPool(pool);
    bus.setClientSubscriptionAuthorizer((_client, topic) => topic !== 'homeline-call:secret');
    bus._testHandleIncomingMessage('client', { type: 'bus_command', action: 'subscribe', topics: ['homeline-call:secret'] });
    expect(pool.get('client').meta.subscriptions.size).toBe(0);
  });

  it('delivers call signaling only to exact subscribers, never wildcard', () => {
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, debug() {}, error() {} } });
    const exact = socket(); const wildcard = socket();
    bus._testSetClientPool(new Map([
      ['exact', { ws: exact, meta: { subscriptions: new Set(['homeline-call:c']) } }],
      ['wildcard', { ws: wildcard, meta: { subscriptions: new Set(['*']) } }],
    ]));
    bus._testSetServerAttached();
    bus.broadcast('homeline-call:c', { type: 'candidate', payload: {} });
    expect(exact.send).toHaveBeenCalledTimes(1); expect(wildcard.send).not.toHaveBeenCalled();
  });

  it('rechecks call authorization at delivery time after credential rotation', () => {
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, debug() {}, error() {} } });
    const old = socket(); const current = socket();
    bus._testSetClientPool(new Map([
      ['old', { ws: old, meta: { subscriptions: new Set(['homeline-call:c']) } }],
      ['current', { ws: current, meta: { subscriptions: new Set(['homeline-call:c']) } }],
    ]));
    bus.setClientSubscriptionAuthorizer(clientId => clientId === 'current');
    bus._testSetServerAttached();
    bus.broadcast('homeline-call:c', { type: 'offer', payload: {} });
    expect(old.send).not.toHaveBeenCalled(); expect(current.send).toHaveBeenCalledTimes(1);
  });

  it('drops messages rejected by the signaling authorizer', () => {
    const bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, debug() {}, error() {} } });
    const handler = vi.fn(); bus.onClientMessage(handler);
    bus.setClientMessageAuthorizer(() => ({ ok: false, code: 'STALE_REVISION' }));
    bus._testHandleIncomingMessage('client', { topic: 'homeline-call:c', type: 'candidate' });
    expect(handler).not.toHaveBeenCalled();
  });
});
