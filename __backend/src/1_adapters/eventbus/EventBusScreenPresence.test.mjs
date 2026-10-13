import { describe, it, expect, vi } from 'vitest';
import { EventBusScreenPresence } from './EventBusScreenPresence.mjs';

function bus(meta = {}) {
  const handlers = [];
  return {
    onClientMessage: (fn) => handlers.push(fn),
    getClientMeta: (conn) => meta[conn] ?? null,
    emit: (conn, message) => handlers.forEach((fn) => fn(conn, message)),
  };
}

describe('EventBusScreenPresence', () => {
  it('reports a browser that publishes playback state under its registered identity, at most once a minute', () => {
    let now = 0;
    const eventBus = bus({ c1: { clientId: 'abc' } });
    const onSeen = vi.fn(async () => {});
    new EventBusScreenPresence({ eventBus, onSeen, clock: { now: () => now } }).attach();
    eventBus.emit('c1', { topic: 'playback_state', identity: { clientId: 'abc', name: 'Kitchen tablet', room: 'Kitchen' } });
    eventBus.emit('c1', { topic: 'playback_state', identity: { clientId: 'abc', name: 'Kitchen tablet' } });
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(onSeen).toHaveBeenCalledWith({ id: 'browser:abc', name: 'Kitchen tablet', room: 'Kitchen', playing: true });
    now = 61_000;
    eventBus.emit('c1', { topic: 'playback_state', identity: { clientId: 'abc', name: 'Kitchen tablet' } });
    expect(onSeen).toHaveBeenCalledTimes(2);
  });
  it('ignores other topics, missing identity and an identity that is not the connection\'s own', () => {
    const eventBus = bus({ c1: { clientId: 'abc' } });
    const onSeen = vi.fn();
    new EventBusScreenPresence({ eventBus, onSeen }).attach();
    eventBus.emit('c1', { topic: 'media:command' });
    eventBus.emit('c1', { topic: 'playback_state' });
    eventBus.emit('c1', { topic: 'playback_state', identity: { clientId: 'spoof', name: 'x' } });
    eventBus.emit('c2', { topic: 'playback_state', identity: { clientId: 'abc', name: 'x' } });
    expect(onSeen).not.toHaveBeenCalled();
  });
  it('a failing onSeen is logged, never thrown into the bus', async () => {
    const eventBus = bus({ c1: { clientId: 'abc' } });
    const logger = { warn: vi.fn() };
    new EventBusScreenPresence({ eventBus, onSeen: async () => { throw new Error('disk'); }, logger }).attach();
    eventBus.emit('c1', { topic: 'playback_state', identity: { clientId: 'abc', name: 'x' } });
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledWith('eventbus.screen_presence.failed', expect.objectContaining({ error: 'disk' }));
  });
});
