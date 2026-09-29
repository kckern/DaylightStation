import { describe, expect, it, vi } from 'vitest';
import { EventBusMediaCommandIngress, EventBusPlaybackStateRelay } from './EventBusMediaClientIngress.mjs';
import { PLAYBACK_STATE_TOPIC } from '../../../shared/contracts/media/topics.mjs';

function bus() {
  let handler;
  let disconnectHandler;
  return {
    onClientMessage: vi.fn((value) => { handler = value; }),
    onClientDisconnection: vi.fn((value) => { disconnectHandler = value; }),
    getClientMeta: vi.fn(() => ({ clientId: 'browser-a' })),
    broadcast: vi.fn(),
    message: (...args) => handler(...args),
    disconnect: (...args) => disconnectHandler(...args),
  };
}

describe('event-bus media ingress', () => {
  it('delegates media commands without changing their values', async () => {
    const eventBus = bus();
    const commands = { execute: vi.fn(async () => ({ kind: 'ok' })) };
    new EventBusMediaCommandIngress({ eventBus, commands }).attach();
    eventBus.message('client-1', { topic: 'media:command', action: 'enqueue', contentId: 'x', householdId: 'h' });
    await Promise.resolve();
    expect(commands.execute).toHaveBeenCalledWith({ action: 'enqueue', contentId: 'x', householdId: 'h' });
  });

  it('rejects identity-less legacy playback streams instead of creating a competing Fleet source', () => {
    const eventBus = bus();
    new EventBusPlaybackStateRelay({ eventBus }).attach();
    const message = { topic: PLAYBACK_STATE_TOPIC, clientId: 'browser-a', state: 'playing' };
    eventBus.message('client-1', message);
    expect(eventBus.broadcast).not.toHaveBeenCalled();
  });

  it('binds publication to the registered stable identity and relays canonical state with origin', () => {
    const eventBus = bus();
    new EventBusPlaybackStateRelay({ eventBus }).attach();
    eventBus.message('connection-1', {
      topic: PLAYBACK_STATE_TOPIC,
      identity: { clientId: 'browser-a', deviceId: 'living-room-tv', name: 'Kitchen tablet', connectedAt: '2026-09-22T12:00:00.000Z' },
      deviceId: 'browser:spoofed', ownerId: 'browser-a', revision: 4,
      clientId: 'browser-a', displayName: 'Kitchen tablet', sessionId: 's1',
      origin: { kind: 'routine', name: 'Morning' }, state: 'playing', currentItem: null, position: 0, duration: 0,
      queue: { items: [], currentIndex: -1, upNextCount: 0 }, lastHeardAt: '2026-09-22T12:00:01.000Z',
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    });

    expect(eventBus.broadcast).toHaveBeenCalledWith(PLAYBACK_STATE_TOPIC, expect.objectContaining({
      clientId: 'browser-a', deviceId: 'browser:browser-a', ownerId: 'browser-a', revision: 4,
      identity: expect.objectContaining({ clientId: 'browser-a', deviceId: 'browser:browser-a' }),
      origin: { kind: 'routine', name: 'Morning' }, connected: true,
    }));
  });

  it('publishes a stopped disconnected canonical row when the owning socket closes', () => {
    const eventBus = bus();
    new EventBusPlaybackStateRelay({ eventBus }).attach();
    eventBus.message('connection-1', {
      topic: PLAYBACK_STATE_TOPIC,
      identity: { clientId: 'browser-a', deviceId: 'browser:browser-a', name: 'Kitchen tablet', connectedAt: '2026-09-22T12:00:00.000Z' },
      clientId: 'browser-a', ownerId: 'browser-a', revision: 1, displayName: 'Kitchen tablet', sessionId: 's1',
      state: 'idle', currentItem: null, position: 0, duration: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
      lastHeardAt: '2026-09-22T12:00:01.000Z',
    });
    eventBus.broadcast.mockClear();
    eventBus.disconnect('connection-1');

    expect(eventBus.broadcast).toHaveBeenCalledWith(PLAYBACK_STATE_TOPIC, expect.objectContaining({
      deviceId: 'browser:browser-a', state: 'stopped', connected: false, currentItem: null,
    }));
  });

  it('preserves an explicit disconnected publication while the shared socket remains open', () => {
    const eventBus = bus();
    new EventBusPlaybackStateRelay({ eventBus }).attach();
    eventBus.message('connection-1', {
      topic: PLAYBACK_STATE_TOPIC,
      identity: { clientId: 'browser-a', deviceId: 'browser:browser-a', name: 'Kitchen tablet', connectedAt: '2026-09-22T12:00:00.000Z' },
      clientId: 'browser-a', deviceId: 'browser:browser-a', ownerId: 'browser-a', revision: 5,
      displayName: 'Kitchen tablet', sessionId: 's1', state: 'stopped', currentItem: null,
      position: 0, duration: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 }, connected: false,
      lastHeardAt: '2026-09-22T12:00:01.000Z', reason: 'disconnect',
    });
    expect(eventBus.broadcast).toHaveBeenCalledWith(PLAYBACK_STATE_TOPIC, expect.objectContaining({
      deviceId: 'browser:browser-a', state: 'stopped', connected: false, reason: 'disconnect',
    }));
  });
});
