import { describe, expect, it, vi } from 'vitest';
import { createPlayerQueueOpRegistry } from './queueOpRegistry.js';

describe('player queue-op ownership', () => {
  it('dispatches to only the most recently mounted Player', () => {
    const registry = createPlayerQueueOpRegistry();
    const background = vi.fn();
    const foreground = vi.fn();
    const unregisterBackground = registry.register(background);
    const unregisterForeground = registry.register(foreground);

    expect(registry.dispatch({ op: 'play-next', contentId: 'plex:621569' })).toBe(true);
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();

    unregisterForeground();
    expect(registry.dispatch({ op: 'play-now', contentId: 'plex:622243' })).toBe(true);
    expect(background).toHaveBeenCalledTimes(1);

    unregisterBackground();
    expect(registry.dispatch({ op: 'play-next', contentId: 'plex:1' })).toBe(false);
  });

  it('does not let a stale unregister remove a newer owner', () => {
    const registry = createPlayerQueueOpRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registry.register(first);
    registry.register(second);

    unregisterFirst();
    registry.dispatch({ op: 'play-next', contentId: 'plex:1' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
