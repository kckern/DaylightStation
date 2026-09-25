import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ScreenOverlayProvider, useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { ScreenExit } from './ScreenExit.jsx';

function Controls() {
  const { showOverlay, dismissOverlay } = useScreenOverlay();
  return (
    <div>
      <button data-testid="show" onClick={() => showOverlay(() => <div>Player</div>)} />
      <button data-testid="dismiss" onClick={() => dismissOverlay()} />
    </div>
  );
}

const mount = (config, navigate) => render(
  <ScreenOverlayProvider>
    <Controls />
    <ScreenExit config={config} navigate={navigate} graceMs={1000} />
  </ScreenOverlayProvider>,
);

describe('ScreenExit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing without an exit target', () => {
    const navigate = vi.fn();
    mount(undefined, navigate);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves after idleSeconds when nothing ever opens', () => {
    const navigate = vi.fn();
    mount({ to: '/piano', idleSeconds: 5 }, navigate);
    act(() => { vi.advanceTimersByTime(4_999); });
    expect(navigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(navigate).toHaveBeenCalledWith('/piano');
  });

  it('stays while the player is up and leaves once it closes', () => {
    const navigate = vi.fn();
    mount({ to: '/piano', idleSeconds: 5 }, navigate);
    act(() => { screen.getByTestId('show').click(); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(navigate).not.toHaveBeenCalled();
    act(() => { screen.getByTestId('dismiss').click(); });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(navigate).toHaveBeenCalledWith('/piano');
  });

  it('does not leave when an overlay reopens inside the grace period', () => {
    const navigate = vi.fn();
    mount({ to: '/piano', idleSeconds: 5 }, navigate);
    act(() => { screen.getByTestId('show').click(); });
    act(() => { screen.getByTestId('dismiss').click(); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { screen.getByTestId('show').click(); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(navigate).not.toHaveBeenCalled();
  });
});
