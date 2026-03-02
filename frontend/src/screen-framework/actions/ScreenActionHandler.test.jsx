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
});
