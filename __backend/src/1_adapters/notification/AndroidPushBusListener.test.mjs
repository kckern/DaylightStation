import { describe, it, expect, vi } from 'vitest';
import { attachAndroidPushBusListener } from './AndroidPushBusListener.mjs';
import { InMemoryPushDeviceRegistry } from './InMemoryPushDeviceRegistry.mjs';

function fakeBus() {
  const msg = [], disc = [];
  return {
    onClientMessage: cb => msg.push(cb),
    onClientDisconnection: cb => disc.push(cb),
    message: (id, m) => msg.forEach(cb => cb(id, m)),
    disconnect: id => disc.forEach(cb => cb(id)),
  };
}

describe('attachAndroidPushBusListener', () => {
  it('records a push.hello and forgets the connection when it closes', () => {
    const bus = fakeBus(), registry = new InMemoryPushDeviceRegistry(), logger = { info: vi.fn(), debug: vi.fn() };
    attachAndroidPushBusListener({ eventBus: bus, registry, clock: { now: () => new Date(5000) }, logger });
    bus.message('c1', { type: 'push.hello', username: 'u', deviceId: 'phone' });
    expect(registry.currentFor('u')).toEqual({ deviceId: 'phone', connectionId: 'c1', lastSeenMs: 5000 });
    expect(logger.info).toHaveBeenCalledWith('notification.android.connected', expect.objectContaining({ username: 'u', connectionId: 'c1' }));
    bus.message('c1', { type: 'push.hello', username: 'u', deviceId: 'phone' });
    expect(logger.info).toHaveBeenCalledTimes(1);
    bus.disconnect('c1');
    expect(registry.currentFor('u')).toBeNull();
  });
  it('ignores a hello without a username and other messages', () => {
    const bus = fakeBus(), registry = new InMemoryPushDeviceRegistry();
    attachAndroidPushBusListener({ eventBus: bus, registry, clock: { now: () => new Date(1) } });
    bus.message('c1', { type: 'push.hello', deviceId: 'phone' });
    bus.message('c1', { type: 'other', username: 'u' });
    expect(registry.currentFor('u')).toBeNull();
  });
});

describe('attachAndroidPushBusListener device auth seam', () => {
  it('ignores a hello the device auth refuses', () => {
    const bus = fakeBus(), registry = new InMemoryPushDeviceRegistry();
    attachAndroidPushBusListener({ eventBus: bus, registry, clock: { now: () => new Date(1) }, deviceAuth: { allowHello: () => false } });
    bus.message('c1', { type: 'push.hello', username: 'u', deviceId: 'phone' });
    expect(registry.currentFor('u')).toBeNull();
  });
});
