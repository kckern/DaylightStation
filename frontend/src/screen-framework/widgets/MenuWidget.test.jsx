// frontend/src/screen-framework/widgets/MenuWidget.test.jsx
//
// ONE SELECTION, ONE PLAYER.
//
// The MenuNavigation stack is provided ONCE, screen-wide, by ScreenRenderer —
// and two different components render it: this widget, and a MenuStack mounted
// as a fullscreen overlay (`menu:open`). A selection made in the overlay pushes
// `{ type: 'player' }` onto that one shared stack, so BOTH rendered a Player:
// two unmuted <video>s in sync, doubled audio, two Plex transcode sessions, and
// a player that outlived the overlay's own exit.
//
// These cases pin the yield and, just as importantly, its LIMITS: the widget
// yields only to an overlay that actually renders the stack, and yielding must
// not cost a refetch or disturb the overlay's own escape handling.

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreenOverlayProvider, useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';

// The real MenuStack drags in Player, PlexMenuRouter, Surround and the whole
// menu tree. The stand-in keeps the one behaviour that matters here besides
// rendering: it claims the escape interceptor on mount and releases it on
// unmount, exactly as the real one does (MenuStack.jsx) — which is what makes
// the interceptor-ordering case below a real test rather than a mock artefact.
vi.mock('../../modules/Menu/MenuStack.jsx', async () => {
  const { useEffect } = await import('react');
  const { useScreenOverlay: useOverlay } = await import('../overlays/ScreenOverlayProvider.jsx');
  const Mock = ({ rootMenu, owner = 'widget' }) => {
    const { registerEscapeInterceptor, unregisterEscapeInterceptor } = useOverlay();
    useEffect(() => {
      registerEscapeInterceptor(() => owner);
      return () => unregisterEscapeInterceptor?.();
    }, [registerEscapeInterceptor, unregisterEscapeInterceptor, owner]);
    return (
      <div
        data-testid={`menu-stack-${owner}`}
        data-owner={owner}
        data-root={typeof rootMenu === 'string' ? rootMenu : rootMenu?.title ?? 'object'}
      />
    );
  };
  return { default: Mock, MenuStack: Mock };
});

const fetchList = vi.fn();
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => fetchList(...args),
}));

const { default: MenuWidget } = await import('./MenuWidget.jsx');
const { MenuStack } = await import('../../modules/Menu/MenuStack.jsx');

/**
 * Drives the overlay slot from inside the provider, the way ScreenActionHandler
 * does. `owning` mirrors the real `menu:open` call: a MenuStack overlay that
 * declares it renders the nav stack.
 */
function OverlayDriver() {
  const { showOverlay, dismissOverlay } = useScreenOverlay();
  return (
    <>
      <button
        data-testid="open-menu-overlay"
        onClick={() => showOverlay(MenuStack, { rootMenu: 'music', owner: 'overlay' }, { priority: 'high', ownsNavStack: true })}
      />
      <button
        data-testid="open-scene-overlay"
        onClick={() => showOverlay(() => <div data-testid="art-scene" />, {}, { priority: 'high' })}
      />
      <button data-testid="dismiss-overlay" onClick={() => dismissOverlay()} />
    </>
  );
}

function renderScreen() {
  return render(
    <ScreenOverlayProvider>
      <OverlayDriver />
      <MenuWidget source="TVApp" />
    </ScreenOverlayProvider>
  );
}

describe('MenuWidget — yielding the nav stack', () => {
  beforeEach(() => {
    fetchList.mockReset();
    fetchList.mockResolvedValue({ title: 'Tvapp', items: [{ label: 'one' }] });
  });

  it('renders its own MenuStack while nothing else owns the stack', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());
  });

  // The defect, stated as a test: with a MenuStack overlay up, the widget must
  // not be rendering the stack too. A second renderer is a second Player.
  it('renders NOTHING while a MenuStack overlay owns the stack', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());

    act(() => { screen.getByTestId('open-menu-overlay').click(); });

    expect(screen.queryByTestId('menu-stack-widget')).toBeNull();
    expect(screen.getByTestId('menu-stack-overlay')).toBeTruthy();
    // Exactly one renderer of the stack on the whole screen.
    expect(document.querySelectorAll('[data-owner]')).toHaveLength(1);
  });

  // The limit of the rule. An ArtMode scene, a cast Player and an app are all
  // fullscreen but render nothing from the nav stack, so whatever the widget
  // was showing (a menu level, or a Player the user started from the widget
  // itself) has to survive underneath them — the framework's Back handling
  // documents that stack as still being there.
  it('does NOT yield to a fullscreen overlay that does not render the stack', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());

    act(() => { screen.getByTestId('open-scene-overlay').click(); });

    expect(screen.getByTestId('art-scene')).toBeTruthy();
    expect(screen.getByTestId('menu-stack-widget')).toBeTruthy();
  });

  it('takes the stack back when the owning overlay dismisses', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());

    act(() => { screen.getByTestId('open-menu-overlay').click(); });
    expect(screen.queryByTestId('menu-stack-widget')).toBeNull();

    act(() => { screen.getByTestId('dismiss-overlay').click(); });
    expect(screen.getByTestId('menu-stack-widget')).toBeTruthy();
    expect(screen.queryByTestId('menu-stack-overlay')).toBeNull();
  });

  // Yielding is a render gate on the STACK, not a teardown of the widget: the
  // fetched list survives, so returning from an overlay does not re-hit the
  // list API or flash the skeleton.
  it('yields without refetching its list', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());
    expect(fetchList).toHaveBeenCalledTimes(1);

    act(() => { screen.getByTestId('open-menu-overlay').click(); });
    act(() => { screen.getByTestId('dismiss-overlay').click(); });

    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('menu-stack-widget')).toBeTruthy();
    expect(document.querySelector('.menu-skeleton')).toBeNull();
  });

  // The escape interceptor is a SINGLE slot, last writer wins. The widget's
  // MenuStack unmounting must not null out the interceptor the overlay's
  // MenuStack has just installed — otherwise Escape would stop popping menu
  // levels inside the overlay.
  it('leaves the escape interceptor with the overlay after yielding', async () => {
    let ref = null;
    function InterceptorProbe() {
      const { escapeInterceptorRef } = useScreenOverlay();
      ref = escapeInterceptorRef;
      return null;
    }

    render(
      <ScreenOverlayProvider>
        <InterceptorProbe />
        <OverlayDriver />
        <MenuWidget source="TVApp" />
      </ScreenOverlayProvider>
    );
    await waitFor(() => expect(screen.getByTestId('menu-stack-widget')).toBeTruthy());
    expect(ref.current?.()).toBe('widget');

    act(() => { screen.getByTestId('open-menu-overlay').click(); });

    expect(ref.current?.()).toBe('overlay');
  });
});
