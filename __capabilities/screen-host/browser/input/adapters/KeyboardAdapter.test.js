import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { KeyboardAdapter } from './KeyboardAdapter.js';

describe('KeyboardAdapter', () => {
  let bus;
  let adapter;

  beforeEach(() => {
    bus = new ActionBus();
    adapter = new KeyboardAdapter(bus);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('should emit navigate with direction for each arrow key', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'up' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'down' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'left' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'right' });
  });

  it('should emit select on Enter', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handler).toHaveBeenCalledWith({});
  });

  it('should emit escape on Escape', () => {
    const handler = vi.fn();
    bus.subscribe('escape', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handler).toHaveBeenCalledWith({});
  });

  it('should ignore unmapped keys', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop emitting after destroy', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    adapter.attach();
    adapter.destroy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(handler).not.toHaveBeenCalled();
  });
});
