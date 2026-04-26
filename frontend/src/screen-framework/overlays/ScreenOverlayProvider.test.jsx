import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';
import { getActionBus } from '../input/ActionBus.js';

function TestWidget() {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  return (
    <div>
      <span data-testid="has-overlay">{String(hasOverlay)}</span>
      <button data-testid="show" onClick={() => showOverlay(
        () => <div data-testid="overlay-content">Player</div>
      )} />
      <button data-testid="dismiss" onClick={() => dismissOverlay()} />
    </div>
  );
}

describe('ScreenOverlayProvider', () => {
  it('initially has no overlay', () => {
    render(
      <ScreenOverlayProvider>
        <TestWidget />
      </ScreenOverlayProvider>
    );
    expect(screen.getByTestId('has-overlay').textContent).toBe('false');
    expect(screen.queryByTestId('overlay-content')).toBeNull();
  });

  it('shows overlay when showOverlay is called', () => {
    render(
      <ScreenOverlayProvider>
        <TestWidget />
      </ScreenOverlayProvider>
    );
    act(() => {
      screen.getByTestId('show').click();
    });
    expect(screen.getByTestId('has-overlay').textContent).toBe('true');
    expect(screen.getByTestId('overlay-content')).toBeTruthy();
    expect(screen.getByTestId('overlay-content').textContent).toBe('Player');
  });

  it('dismisses overlay when dismissOverlay is called', () => {
    render(
      <ScreenOverlayProvider>
        <TestWidget />
      </ScreenOverlayProvider>
    );
    act(() => {
      screen.getByTestId('show').click();
    });
    expect(screen.getByTestId('overlay-content')).toBeTruthy();

    act(() => {
      screen.getByTestId('dismiss').click();
    });
    expect(screen.queryByTestId('overlay-content')).toBeNull();
    expect(screen.getByTestId('has-overlay').textContent).toBe('false');
  });

  it('keeps dashboard children mounted when overlay is active', () => {
    const mountSpy = vi.fn();
    function Dashboard() {
      React.useEffect(() => { mountSpy(); }, []);
      return <div data-testid="dashboard">Dashboard</div>;
    }

    render(
      <ScreenOverlayProvider>
        <Dashboard />
        <TestWidget />
      </ScreenOverlayProvider>
    );

    expect(mountSpy).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByTestId('show').click();
    });

    // Dashboard still mounted (not re-mounted)
    expect(screen.getByTestId('dashboard')).toBeTruthy();
    expect(mountSpy).toHaveBeenCalledTimes(1); // no re-mount
  });
});

// Phase 4: Three-slot overlay tests
describe('ScreenOverlayProvider - Phase 4 slots', () => {
  function SlotTestWidget() {
    const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
    return (
      <div>
        <span data-testid="has-overlay">{String(hasOverlay)}</span>

        <button data-testid="show-fullscreen" onClick={() => showOverlay(
          () => <div data-testid="fullscreen-content">Fullscreen</div>,
          {},
          { mode: 'fullscreen' }
        )} />

        <button data-testid="show-fullscreen-high" onClick={() => showOverlay(
          () => <div data-testid="fullscreen-high-content">HighPriority</div>,
          {},
          { mode: 'fullscreen', priority: 'high' }
        )} />

        <button data-testid="show-pip" onClick={() => showOverlay(
          () => <div data-testid="pip-content">PiP</div>,
          {},
          { mode: 'pip', position: 'bottom-left' }
        )} />

        <button data-testid="show-toast" onClick={() => showOverlay(
          () => <div data-testid="toast-content">Toast</div>,
          {},
          { mode: 'toast', timeout: 100 }
        )} />

        <button data-testid="show-toast-long" onClick={() => showOverlay(
          () => <div data-testid="toast-long-content">LongToast</div>,
          {},
          { mode: 'toast', timeout: 60000 }
        )} />

        <button data-testid="dismiss-fullscreen" onClick={() => dismissOverlay('fullscreen')} />
        <button data-testid="dismiss-pip" onClick={() => dismissOverlay('pip')} />
        <button data-testid="dismiss-toast" onClick={() => dismissOverlay('toast')} />
      </div>
    );
  }

  it('shows fullscreen overlay by default mode', () => {
    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });

    expect(screen.getByTestId('has-overlay').textContent).toBe('true');
    expect(screen.getByTestId('fullscreen-content')).toBeTruthy();
    expect(screen.getByTestId('fullscreen-content').textContent).toBe('Fullscreen');
  });

  it('renders pip alongside fullscreen', () => {
    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    act(() => {
      screen.getByTestId('show-pip').click();
    });

    expect(screen.getByTestId('fullscreen-content')).toBeTruthy();
    expect(screen.getByTestId('pip-content')).toBeTruthy();
    expect(screen.getByTestId('pip-content').textContent).toBe('PiP');
  });

  it('auto-dismisses toast after timeout', async () => {
    vi.useFakeTimers();

    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    act(() => {
      screen.getByTestId('show-toast').click();
    });

    expect(screen.getByTestId('toast-content')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByTestId('toast-content')).toBeNull();

    vi.useRealTimers();
  });

  it('dismissOverlay targets specific mode', () => {
    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    // Show both fullscreen and pip
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    act(() => {
      screen.getByTestId('show-pip').click();
    });

    expect(screen.getByTestId('fullscreen-content')).toBeTruthy();
    expect(screen.getByTestId('pip-content')).toBeTruthy();

    // Dismiss only pip
    act(() => {
      screen.getByTestId('dismiss-pip').click();
    });

    expect(screen.getByTestId('fullscreen-content')).toBeTruthy();
    expect(screen.queryByTestId('pip-content')).toBeNull();
  });

  it('high priority fullscreen replaces existing fullscreen', () => {
    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    // Show normal fullscreen
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    expect(screen.getByTestId('fullscreen-content').textContent).toBe('Fullscreen');

    // Try to replace with another normal fullscreen (should not replace)
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    // Still original
    expect(screen.getByTestId('fullscreen-content').textContent).toBe('Fullscreen');

    // Replace with high priority
    act(() => {
      screen.getByTestId('show-fullscreen-high').click();
    });
    expect(screen.getByTestId('fullscreen-high-content').textContent).toBe('HighPriority');
  });

  it('stacks multiple toasts', () => {
    vi.useFakeTimers();

    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    act(() => {
      screen.getByTestId('show-toast-long').click();
    });
    act(() => {
      screen.getByTestId('show-toast-long').click();
    });

    const toasts = screen.getAllByTestId('toast-long-content');
    expect(toasts.length).toBe(2);

    vi.useRealTimers();
  });

  it('hasOverlay reflects only fullscreen state', () => {
    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    // Show pip only
    act(() => {
      screen.getByTestId('show-pip').click();
    });
    expect(screen.getByTestId('has-overlay').textContent).toBe('false');

    // Show fullscreen
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    expect(screen.getByTestId('has-overlay').textContent).toBe('true');

    // Dismiss fullscreen, pip still there
    act(() => {
      screen.getByTestId('dismiss-fullscreen').click();
    });
    expect(screen.getByTestId('has-overlay').textContent).toBe('false');
    expect(screen.getByTestId('pip-content')).toBeTruthy();
  });

  it('dismissOverlay for fullscreen does not affect pip or toasts', () => {
    vi.useFakeTimers();

    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    // Show all three
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    act(() => {
      screen.getByTestId('show-pip').click();
    });
    act(() => {
      screen.getByTestId('show-toast-long').click();
    });

    // Dismiss fullscreen
    act(() => {
      screen.getByTestId('dismiss-fullscreen').click();
    });

    expect(screen.queryByTestId('fullscreen-content')).toBeNull();
    expect(screen.getByTestId('pip-content')).toBeTruthy();
    expect(screen.getByTestId('toast-long-content')).toBeTruthy();

    vi.useRealTimers();
  });

  it('does NOT emit screen:overlay-mounted when only pip is shown', () => {
    // Defensive guard: pip is non-blocking and must not release the
    // menu-suppression gate. Only fullscreen overlays may emit overlay-mounted.
    const handler = vi.fn();
    const unsubscribe = getActionBus().subscribe('screen:overlay-mounted', handler);

    render(
      <ScreenOverlayProvider>
        <SlotTestWidget />
      </ScreenOverlayProvider>
    );

    act(() => {
      screen.getByTestId('show-pip').click();
    });

    expect(handler).not.toHaveBeenCalled();

    // Sanity-check: a fullscreen overlay still emits.
    act(() => {
      screen.getByTestId('show-fullscreen').click();
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ mode: 'fullscreen' });

    unsubscribe();
  });
});
