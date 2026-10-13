import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionBus } from './ActionBus.js';

describe('ActionBus', () => {
  let bus;

  beforeEach(() => {
    bus = new ActionBus();
  });

  it('should allow subscribing to actions', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);

    bus.emit('select', { target: 'widget-1' });

    expect(handler).toHaveBeenCalledWith({ target: 'widget-1' });
  });

  it('should allow unsubscribing from actions', () => {
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('select', handler);

    unsubscribe();
    bus.emit('select', { target: 'widget-1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple subscribers for same action', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe('navigate', handler1);
    bus.subscribe('navigate', handler2);

    bus.emit('navigate', { direction: 'up' });

    expect(handler1).toHaveBeenCalledWith({ direction: 'up' });
    expect(handler2).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should support wildcard subscriptions', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);

    bus.emit('any-action', { data: 'test' });

    expect(handler).toHaveBeenCalledWith('any-action', { data: 'test' });
  });
});
