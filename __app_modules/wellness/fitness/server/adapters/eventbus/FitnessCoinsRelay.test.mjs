import { describe, expect, it, vi } from 'vitest';
import { FitnessCoinsRelay } from './FitnessCoinsRelay.mjs';

function bus() {
  const handlers = new Map();
  return {
    subscribe: vi.fn((topic, fn) => { handlers.set(topic, fn); return () => handlers.delete(topic); }),
    broadcast: vi.fn(),
    emit: (topic, payload) => handlers.get(topic)?.(payload),
    has: (topic) => handlers.has(topic),
  };
}

describe('FitnessCoinsRelay', () => {
  it('relays economy.coins-changed to the fitness topic', () => {
    const eventBus = bus();
    new FitnessCoinsRelay({ eventBus }).start();
    eventBus.emit('economy.coins-changed', { userId: 'test-learner', reason: 'mint' });
    expect(eventBus.broadcast).toHaveBeenCalledWith('fitness', { event: 'coins-changed', userId: 'test-learner' });
  });

  it('ignores a fact with no user, survives a failing broadcast, and stops', () => {
    const eventBus = bus();
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const relay = new FitnessCoinsRelay({ eventBus, logger }).start();
    eventBus.emit('economy.coins-changed', {});
    expect(eventBus.broadcast).not.toHaveBeenCalled();
    eventBus.broadcast.mockImplementation(() => { throw new Error('ws'); });
    expect(() => eventBus.emit('economy.coins-changed', { userId: 'test-learner' })).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith('fitness.coins-changed.relay-failed', expect.any(Object));
    relay.stop();
    expect(eventBus.has('economy.coins-changed')).toBe(false);
  });

  it('is inert without a bus', () => {
    expect(() => new FitnessCoinsRelay({}).start()).not.toThrow();
  });
});
