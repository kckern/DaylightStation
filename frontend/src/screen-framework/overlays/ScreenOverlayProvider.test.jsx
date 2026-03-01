import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';

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
