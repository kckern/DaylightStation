import { describe, expect, it, vi } from 'vitest';
import { EventBusMediaCommandIngress, EventBusPlaybackStateRelay } from './EventBusMediaClientIngress.mjs';

function bus() {
  let handler;
  return {
    onClientMessage: vi.fn((value) => { handler = value; }),
    broadcast: vi.fn(),
    message: (...args) => handler(...args),
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

  it('relays playback state to the established device topic', () => {
    const eventBus = bus();
    new EventBusPlaybackStateRelay({ eventBus }).attach();
    const message = { topic: 'playback_state', deviceId: 'tv-1', state: 'playing' };
    eventBus.message('client-1', message);
    expect(eventBus.broadcast).toHaveBeenCalledWith('playback:tv-1', message);
  });
});
