// frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { NumpadAdapter } from './NumpadAdapter.js';

describe('NumpadAdapter', () => {
  let bus;
  let adapter;

  const mockKeymap = {
    '1': { label: 'Music', function: 'menu', params: 'music' },
    '2': { label: 'Play/Pause', function: 'playback', params: 'play', secondary: 'menu:video' },
    '3': { label: 'Scripture', function: 'play', params: 'scripture:1-ne-1' },
  };

  beforeEach(() => {
    bus = new ActionBus();
  });

  afterEach(() => {
    if (adapter) adapter.destroy();
  });

  it('should fetch keymap and translate mapped key to action', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(fetchFn).toHaveBeenCalledWith('/api/v1/home/keyboard/officekeypad');
    expect(handler).toHaveBeenCalledWith({ menuId: 'music' });
  });

  it('should try secondary when primary function is unknown', async () => {
    const keymapWithUnknown = {
      '5': { label: 'Special', function: 'unknownfn', params: 'x', secondary: 'menu:settings' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymapWithUnknown);
    adapter = new NumpadAdapter(bus, { keyboardId: 'test', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }));

    expect(handler).toHaveBeenCalledWith({ menuId: 'settings' });
  });

  it('should ignore keys not in keymap', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('*', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle fetch failure gracefully', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
    adapter = new NumpadAdapter(bus, { keyboardId: 'bad', fetchFn });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await adapter.attach();
    warnSpy.mockRestore();

    const handler = vi.fn();
    bus.subscribe('*', handler);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop listening after destroy', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    adapter.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
