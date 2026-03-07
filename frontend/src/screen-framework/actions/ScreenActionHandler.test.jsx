import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';
import { ScreenActionHandler } from './ScreenActionHandler.jsx';

// Mock MenuStack and Player to avoid importing their heavy dependency trees
vi.mock('../../modules/Menu/MenuStack.jsx', () => ({
  default: (props) => <div data-testid="menu-stack" data-menu={props.rootMenu}>MenuStack</div>,
}));

vi.mock('../../modules/Player/Player.jsx', () => ({
  default: React.forwardRef((props, ref) => (
    <div data-testid="player" data-play={props.play}>Player</div>
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
    expect(getByTestId('player').dataset.play).toBe('plex:12345');
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
});
