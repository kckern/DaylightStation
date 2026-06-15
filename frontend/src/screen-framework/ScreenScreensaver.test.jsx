import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScreenOverlayProvider } from './overlays/ScreenOverlayProvider.jsx';
import { MenuNavigationProvider } from '../context/MenuNavigationContext.jsx';
import { getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
import { ScreenScreensaver } from './ScreenScreensaver.jsx';

function DummyArt() {
  return <div data-testid="dummy-art">art</div>;
}

const renderWithProviders = (config) =>
  render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        <ScreenScreensaver config={config} />
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  );

describe('ScreenScreensaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWidgetRegistry();
    getWidgetRegistry().register('art', DummyArt);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWidgetRegistry();
  });

  it('shows the screensaver widget after the idle timeout', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 2, showOnLoad: false });
    expect(queryByTestId('dummy-art')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });

  it('shows immediately when showOnLoad is true', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 99, showOnLoad: true });
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });

  it('dismisses on input and swallows the first event', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 99, showOnLoad: true });
    expect(queryByTestId('dummy-art')).toBeTruthy();

    const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(evt); });

    expect(queryByTestId('dummy-art')).toBeNull();
    expect(evt.defaultPrevented).toBe(true);
  });

  it('resets the idle timer on activity (does not show while active)', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 4, showOnLoad: false });
    // idle=4s; advance 3s, then activity resets the timer, so 4s must elapse anew before showing.
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(3000); }); // 6s total, but timer was reset at 3s
    expect(queryByTestId('dummy-art')).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); }); // now 4s since reset
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });

  it('interactive: ignores input and closes only via the widget onExit', () => {
    let captured;
    function DummyInteractive({ onExit }) {
      captured = onExit;
      return <button data-testid="dummy-exit" onClick={onExit}>x</button>;
    }
    getWidgetRegistry().register('art', DummyInteractive);

    const { queryByTestId, getByTestId } = renderWithProviders({
      widget: 'art', idle: 99, showOnLoad: true, interactive: true,
    });
    expect(queryByTestId('dummy-exit')).toBeTruthy();

    // A keypress must NOT dismiss an interactive screensaver.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); });
    expect(queryByTestId('dummy-exit')).toBeTruthy();
    expect(typeof captured).toBe('function');

    // The widget's onExit closes it.
    act(() => { getByTestId('dummy-exit').click(); });
    expect(queryByTestId('dummy-exit')).toBeNull();
  });

  it('dismisses a shown screensaver when the config changes mid-cycle', () => {
    function DummyArt2() { return <div data-testid="dummy-art-2">art2</div>; }
    getWidgetRegistry().register('art2', DummyArt2);

    const { queryByTestId, rerender } = render(
      <MenuNavigationProvider>
        <ScreenOverlayProvider>
          <ScreenScreensaver config={{ widget: 'art', idle: 99, showOnLoad: true }} />
        </ScreenOverlayProvider>
      </MenuNavigationProvider>
    );
    expect(queryByTestId('dummy-art')).toBeTruthy();

    rerender(
      <MenuNavigationProvider>
        <ScreenOverlayProvider>
          <ScreenScreensaver config={{ widget: 'art2', idle: 99, showOnLoad: false }} />
        </ScreenOverlayProvider>
      </MenuNavigationProvider>
    );

    // Old screensaver overlay must be torn down (not orphaned); new config does not auto-show.
    expect(queryByTestId('dummy-art')).toBeNull();
  });
});
