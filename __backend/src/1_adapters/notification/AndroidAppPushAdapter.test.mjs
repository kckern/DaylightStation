import { describe, it, expect } from 'vitest';
import { AndroidAppPushAdapter, ANDROID_ACK_TIMEOUT_MS } from './AndroidAppPushAdapter.mjs';
import { InMemoryPushDeviceRegistry } from './InMemoryPushDeviceRegistry.mjs';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

function fakeBus({ ackFrom = null, ackDelayMs = 0 } = {}) {
  const handlers = [], sent = [];
  const bus = {
    sent,
    onClientMessage: cb => handlers.push(cb),
    sendToClient(connectionId, message) {
      sent.push({ connectionId, message });
      if (ackFrom && message.type === 'push.notification') {
        setTimeout(() => handlers.forEach(h => h(ackFrom, { type: 'push.ack', id: message.notification.id })), ackDelayMs);
      }
      return true;
    },
  };
  return bus;
}

const intent = () => new NotificationIntent({
  id: 'n1', title: 'Approval needed', body: 'Garage kiosk', category: 'approval', urgency: 'high',
  recipient: { username: 'u' },
  presentation: { tag: 'donow-1', importance: 'high', imageUrl: '/api/v1/img/x.png' },
  actions: [{ id: 'DONOW_APPROVE_1', label: 'Approve', requiresUnlock: true }, { label: 'legacy', action: 'open' }],
  createdAt: '2026-11-21T00:00:00.000Z',
});
function setup(busOptions) {
  const registry = new InMemoryPushDeviceRegistry();
  registry.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c1', atMs: 1 });
  const eventBus = fakeBus(busOptions);
  return { eventBus, adapter: new AndroidAppPushAdapter({ eventBus, registry, ackTimeoutMs: 30 }) };
}

describe('AndroidAppPushAdapter', () => {
  it('waits four seconds for an ack by default', () => {
    expect(ANDROID_ACK_TIMEOUT_MS).toBe(4000);
  });
  it('is the push-android channel', () => {
    expect(setup().adapter.channel).toBe('push-android');
  });
  it('does not send when the phone is not connected', async () => {
    const eventBus = fakeBus();
    const adapter = new AndroidAppPushAdapter({ eventBus, registry: new InMemoryPushDeviceRegistry(), ackTimeoutMs: 30 });
    expect(await adapter.send(intent())).toEqual({ delivered: false, error: 'phone not connected' });
    expect(eventBus.sent).toHaveLength(0);
  });
  it('is delivered when the phone acks from its own connection', async () => {
    const { eventBus, adapter } = setup({ ackFrom: 'c1' });
    expect(await adapter.send(intent())).toEqual({ delivered: true, channelId: 'android-phone' });
    const wire = eventBus.sent[0];
    expect(wire.connectionId).toBe('c1');
    expect(wire.message.type).toBe('push.notification');
    expect(wire.message.notification.presentation.imageUrl).toBe('/api/v1/img/x.png');
    expect(wire.message.notification.actions).toEqual([expect.objectContaining({ id: 'DONOW_APPROVE_1', requiresUnlock: true, kind: 'button' })]);
  });
  it('does not accept an ack from another connection, and cancels on timeout', async () => {
    const { eventBus, adapter } = setup({ ackFrom: 'c9' });
    expect(await adapter.send(intent())).toEqual({ delivered: false, error: 'ack timeout' });
    expect(eventBus.sent.at(-1)).toEqual({ connectionId: 'c1', message: { type: 'push.cancel', id: 'n1' } });
  });
  it('ignores an ack that arrives after the timeout', async () => {
    const { adapter } = setup({ ackFrom: 'c1', ackDelayMs: 80 });
    expect((await adapter.send(intent())).delivered).toBe(false);
    await new Promise(r => setTimeout(r, 100));
  });
  it('is not delivered when the bus cannot reach the connection', async () => {
    const registry = new InMemoryPushDeviceRegistry();
    registry.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c1', atMs: 1 });
    const eventBus = { onClientMessage: () => {}, sendToClient: () => false };
    const adapter = new AndroidAppPushAdapter({ eventBus, registry, ackTimeoutMs: 30 });
    expect(await adapter.send(intent())).toEqual({ delivered: false, error: 'phone connection closed' });
  });
});
