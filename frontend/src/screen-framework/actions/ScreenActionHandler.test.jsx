import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';
import { ScreenActionHandler } from './ScreenActionHandler.jsx';

import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';

/**
 * Test helper: registers an escape interceptor that returns the given value.
 */
function InterceptorRegistrar({ handled }) {
  const { registerEscapeInterceptor } = useScreenOverlay();
  React.useEffect(() => {
    registerEscapeInterceptor(() => handled);
  }, [handled, registerEscapeInterceptor]);
  return null;
}

// Mock MenuStack and Player to avoid importing their heavy dependency trees
vi.mock('../../modules/Menu/MenuStack.jsx', () => ({
  default: (props) => <div data-testid="menu-stack" data-menu={props.rootMenu}>MenuStack</div>,
}));

vi.mock('../../modules/Player/Player.jsx', () => ({
  default: React.forwardRef((props, ref) => (
    <div data-testid="player" data-play={typeof props.play === 'object' ? JSON.stringify(props.play) : props.play}>Player</div>
  )),
}));

describe('ScreenActionHandler', () => {
  beforeEach(() => {
    resetActionBus();
  });

  it('opens MenuStack overlay on menu:open action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
        <div data-testid="dashboard">Dashboard</div>
      </ScreenOverlayProvider>
    );

    expect(queryByTestId('menu-stack')).toBeNull();

    act(() => getActionBus().emit('menu:open', { menuId: 'music' }));

    expect(getByTestId('menu-stack')).toBeTruthy();
    expect(getByTestId('menu-stack').dataset.menu).toBe('music');
  });

  it('opens Player overlay on media:play action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    expect(queryByTestId('player')).toBeNull();

    act(() => getActionBus().emit('media:play', { contentId: 'plex:12345' }));

    expect(getByTestId('player')).toBeTruthy();
    expect(getByTestId('player').dataset.play).toContain('plex:12345');
  });

  it('opens Player overlay on media:queue action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    expect(queryByTestId('player')).toBeNull();

    act(() => getActionBus().emit('media:queue', { contentId: 'plex:67890' }));

    expect(getByTestId('player')).toBeTruthy();
  });

  it('mounts Player overlay on media:queue-op with op=play-now', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    expect(queryByTestId('player')).toBeNull();

    act(() => getActionBus().emit('media:queue-op', {
      op: 'play-now',
      contentId: 'plex:777',
      shader: 'dark',
      shuffle: true,
      commandId: 'cmd-abc',
    }));

    expect(getByTestId('player')).toBeTruthy();
  });

  it('ignores media:queue-op with non play-now op (logs debug)', () => {
    const { queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    act(() => getActionBus().emit('media:queue-op', {
      op: 'clear',
      commandId: 'cmd-xyz',
    }));

    expect(queryByTestId('player')).toBeNull();
    expect(queryByTestId('menu-stack')).toBeNull();
  });

  it('dismisses overlay on escape action when no overlay is active', () => {
    const { queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    // Should not throw
    act(() => getActionBus().emit('escape', {}));

    expect(queryByTestId('menu-stack')).toBeNull();
  });

  it('dismisses fullscreen overlay on escape action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );

    act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
    expect(getByTestId('menu-stack')).toBeTruthy();

    act(() => getActionBus().emit('escape', {}));
    expect(queryByTestId('menu-stack')).toBeNull();
  });

  describe('sleep wake mode', () => {
    afterEach(() => {
      document.querySelectorAll('.screen-action-shader').forEach(el => el.remove());
    });

    it('wakes from sleep on keydown when actions.sleep.wake is "keydown"', () => {
      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ sleep: { wake: 'keydown' } }} />
        </ScreenOverlayProvider>
      );

      // Enter sleep
      act(() => getActionBus().emit('display:sleep', {}));

      const shader = document.querySelector('.screen-action-shader');
      expect(shader).toBeTruthy();
      expect(shader.style.opacity).toBe('1');

      // Wake via keydown
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      });

      expect(parseFloat(shader.style.opacity)).toBeLessThan(1);
    });

    it('does not wake on keydown when wake mode is "click"', () => {
      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ sleep: { wake: 'click' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('display:sleep', {}));

      const shader = document.querySelector('.screen-action-shader');
      expect(shader.style.opacity).toBe('1');

      // Keydown should NOT wake
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      });

      expect(shader.style.opacity).toBe('1');
    });

    it('wakes on both click and keydown when wake mode is "both"', () => {
      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ sleep: { wake: 'both' } }} />
        </ScreenOverlayProvider>
      );

      // Test keydown wake
      act(() => getActionBus().emit('display:sleep', {}));

      const shader = document.querySelector('.screen-action-shader');
      expect(shader.style.opacity).toBe('1');

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      });

      expect(parseFloat(shader.style.opacity)).toBeLessThan(1);
    });

    it('defaults to click-only wake when no actions.sleep configured', () => {
      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('display:sleep', {}));

      const shader = document.querySelector('.screen-action-shader');
      expect(shader.style.opacity).toBe('1');

      // Keydown should NOT wake (default is click)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      });

      expect(shader.style.opacity).toBe('1');
    });
  });

  describe('configurable escape fallback chain', () => {
    const escapeActions = {
      escape: [
        { when: 'shader_active', do: 'clear_shader' },
        { when: 'overlay_active', do: 'dismiss_overlay' },
        { when: 'idle', do: 'reload' },
      ],
    };

    it('reloads page on escape when no shader or overlay (actions.escape configured with idle->reload)', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('escape', {}));
      expect(reloadMock).toHaveBeenCalled();
    });

    it('dismisses overlay before reloading when overlay is active', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      // Open an overlay first
      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      // Escape should dismiss overlay, not reload
      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('clears shader before dismissing when shader is active', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      // Activate shader by cycling it
      act(() => getActionBus().emit('display:shader', {}));

      // Escape should clear shader, not dismiss or reload
      act(() => getActionBus().emit('escape', {}));

      const shader = document.querySelector('.screen-action-shader');
      expect(parseFloat(shader.style.opacity)).toBe(0);
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('keeps default behavior when actions.escape is not configured', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler />
        </ScreenOverlayProvider>
      );

      // With no actions configured, escape on idle should NOT reload
      act(() => getActionBus().emit('escape', {}));
      expect(reloadMock).not.toHaveBeenCalled();

      // Should still dismiss overlays
      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();
    });
  });

  describe('menu duplicate guard', () => {
    it('ignores second menu:open with same menuId when duplicate is "ignore"', () => {
      const { getAllByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'ignore' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
      act(() => getActionBus().emit('menu:open', { menuId: 'music' }));

      // Should only have one menu-stack rendered
      expect(getAllByTestId('menu-stack')).toHaveLength(1);
    });

    it('allows opening a different menu even with duplicate guard', () => {
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'ignore' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      // Dismiss first, then open a different menu
      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();

      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack').dataset.menu).toBe('tv');
    });

    it('dispatches synthetic ArrowRight keydown when duplicate is "navigate" and same menu is open', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'navigate' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'education' }));

      // Clear spy calls from first open
      dispatchSpy.mockClear();

      // Second emit of same menu should dispatch ArrowRight to advance selection sequentially
      act(() => getActionBus().emit('menu:open', { menuId: 'education' }));

      const arrowCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent && e.key === 'ArrowRight'
      );
      expect(arrowCalls).toHaveLength(1);

      dispatchSpy.mockRestore();
    });

    it('allows re-opening same menu after escape dismisses it', () => {
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'ignore' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();

      act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
      expect(getByTestId('menu-stack')).toBeTruthy();
    });
  });

  describe('escape interceptor', () => {
    const escapeActions = {
      escape: [
        { when: 'shader_active', do: 'clear_shader' },
        { when: 'overlay_active', do: 'dismiss_overlay' },
        { when: 'idle', do: 'reload' },
      ],
    };

    it('interceptor prevents overlay dismiss when it returns true', () => {
      const { getByTestId } = render(
        <ScreenOverlayProvider>
          <InterceptorRegistrar handled={true} />
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      // Escape should be intercepted — overlay stays
      act(() => getActionBus().emit('escape', {}));
      expect(getByTestId('menu-stack')).toBeTruthy();
    });

    it('interceptor returning false allows normal escape chain', () => {
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <InterceptorRegistrar handled={false} />
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      // Interceptor returns false — overlay should dismiss
      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();
    });

    it('dismisses overlay when no interceptor is registered', () => {
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
      expect(getByTestId('menu-stack')).toBeTruthy();

      act(() => getActionBus().emit('escape', {}));
      expect(queryByTestId('menu-stack')).toBeNull();
    });

    it('interceptor prevents page reload when no overlay is active', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      render(
        <ScreenOverlayProvider>
          <InterceptorRegistrar handled={true} />
          <ScreenActionHandler actions={escapeActions} />
        </ScreenOverlayProvider>
      );

      // No overlay active — escape chain would hit idle→reload
      // But interceptor should handle it first
      act(() => getActionBus().emit('escape', {}));
      expect(reloadMock).not.toHaveBeenCalled();
    });
  });

  describe('playback secondary fallback', () => {
    it('uses secondary action when idle and when_idle is "secondary"', () => {
      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ playback: { when_idle: 'secondary' } }} />
        </ScreenOverlayProvider>
      );

      // No media elements exist, so media is idle
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      act(() => {
        getActionBus().emit('media:playback', {
          command: 'play',
          secondary: { action: 'media:queue', payload: { contentId: 'morning-program' } },
        });
      });

      // Should NOT dispatch a synthetic keydown — secondary fallback should handle it
      const keydownCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent
      );
      expect(keydownCalls).toHaveLength(0);

      dispatchSpy.mockRestore();
    });

    it('dispatches keydown normally when when_idle is "dispatch"', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ playback: { when_idle: 'dispatch' } }} />
        </ScreenOverlayProvider>
      );

      act(() => {
        getActionBus().emit('media:playback', {
          command: 'play',
          secondary: { action: 'media:queue', payload: { contentId: 'morning-program' } },
        });
      });

      const keydownCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent
      );
      expect(keydownCalls.length).toBeGreaterThan(0);

      dispatchSpy.mockRestore();
    });

    it('dispatches keydown when no secondary is provided even if when_idle is "secondary"', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ playback: { when_idle: 'secondary' } }} />
        </ScreenOverlayProvider>
      );

      act(() => {
        getActionBus().emit('media:playback', { command: 'play' });
      });

      const keydownCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent
      );
      expect(keydownCalls.length).toBeGreaterThan(0);

      dispatchSpy.mockRestore();
    });

    it('dispatches keydown when media is active even if when_idle is "secondary"', () => {
      // Create a fake video element that is playing
      const video = document.createElement('video');
      Object.defineProperty(video, 'paused', { value: false });
      document.body.appendChild(video);

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ playback: { when_idle: 'secondary' } }} />
        </ScreenOverlayProvider>
      );

      act(() => {
        getActionBus().emit('media:playback', {
          command: 'play',
          secondary: { action: 'media:queue', payload: { contentId: 'morning-program' } },
        });
      });

      const keydownCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent
      );
      expect(keydownCalls.length).toBeGreaterThan(0);

      dispatchSpy.mockRestore();
      document.body.removeChild(video);
    });
  });

  it('media:queue-op op=play-next with no active player mounts a fresh Player', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    expect(queryByTestId('player')).toBeNull();
    act(() => getActionBus().emit('media:queue-op', { op: 'play-next', contentId: 'plex:1' }));
    expect(getByTestId('player')).toBeTruthy();
  });

  it('media:queue-op op=play-next with an active audio player dispatches player:queue-op event', () => {
    const dummy = document.createElement('div');
    dummy.className = 'audio-player';
    document.body.appendChild(dummy);

    const handler = vi.fn();
    window.addEventListener('player:queue-op', handler);

    render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    act(() => getActionBus().emit('media:queue-op', { op: 'play-next', contentId: 'plex:1' }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toMatchObject({ op: 'play-next', contentId: 'plex:1' });

    window.removeEventListener('player:queue-op', handler);
    dummy.remove();
  });

  it('media:queue-op op=play-now with no active player mounts a fresh Player', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    expect(queryByTestId('player')).toBeNull();
    act(() => getActionBus().emit('media:queue-op', { op: 'play-now', contentId: 'plex:1' }));
    expect(getByTestId('player')).toBeTruthy();
  });

  it('media:queue-op op=play-now with an active audio player dispatches player:queue-op (in-place swap)', () => {
    const dummy = document.createElement('div');
    dummy.className = 'audio-player';
    document.body.appendChild(dummy);

    const handler = vi.fn();
    window.addEventListener('player:queue-op', handler);

    render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    act(() => getActionBus().emit('media:queue-op', { op: 'play-now', contentId: 'plex:2' }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toMatchObject({ op: 'play-now', contentId: 'plex:2' });

    window.removeEventListener('player:queue-op', handler);
    dummy.remove();
  });
});
