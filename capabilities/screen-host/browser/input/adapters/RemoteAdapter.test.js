// frontend/src/screen-framework/input/adapters/RemoteAdapter.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { RemoteAdapter } from './RemoteAdapter.js';

describe('RemoteAdapter', () => {
  let bus;
  let adapter;

  beforeEach(() => {
    bus = new ActionBus();
  });

  afterEach(() => {
    if (adapter) adapter.destroy();
  });

  it('should emit navigate for arrow keys with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('navigate', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(handler).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should emit select for Enter with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('select', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(handler).toHaveBeenCalledWith({});
  });

  it('should emit escape for Escape with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('escape', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handler).toHaveBeenCalledWith({});
  });

  it('should translate keymap entries and NOT fall through to nav', async () => {
    const keymap = {
      'MediaPlayPause': { label: 'Play/Pause', function: 'playback', params: 'play' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymap);
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const playHandler = vi.fn();
    const navHandler = vi.fn();
    bus.subscribe('media:playback', playHandler);
    bus.subscribe('navigate', navHandler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause' }));

    expect(playHandler).toHaveBeenCalledWith({ command: 'play' });
    expect(navHandler).not.toHaveBeenCalled();
  });

  it('should prefer keymap over nav when both match', async () => {
    const keymap = {
      'ArrowUp': { label: 'Volume Up', function: 'volume', params: '+1' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymap);
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const volHandler = vi.fn();
    const navHandler = vi.fn();
    bus.subscribe('display:volume', volHandler);
    bus.subscribe('navigate', navHandler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(volHandler).toHaveBeenCalledWith({ command: '+1' });
    expect(navHandler).not.toHaveBeenCalled();
  });

  it('should stop listening after destroy', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('navigate', handler);

    await adapter.attach();
    adapter.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
