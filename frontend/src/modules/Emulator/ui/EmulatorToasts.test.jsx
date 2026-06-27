import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EmulatorToasts } from './EmulatorToasts.jsx';

const SFC30 = { id: 'sfc30', label: '8BitDo SFC30', address: 'E4:17:D8:C6:54:F0' };
const inv = (connected) => (connected
  ? [{ address: 'e4:17:d8:c6:54:f0', name: '8Bitdo SFC30 GamePad', connected: true, battery: 60 }]
  : []);

describe('EmulatorToasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows no toast on initial mount (baseline), even if already connected', () => {
    render(<EmulatorToasts btInventory={inv(true)} controllers={[SFC30]} />);
    expect(screen.queryByText(/connected/i)).toBeNull();
  });

  it('toasts on disconnect, auto-dismisses, then toasts on reconnect', () => {
    const { rerender } = render(
      <EmulatorToasts btInventory={inv(true)} controllers={[SFC30]} autoDismissMs={4000} />,
    );

    // connected → disconnected
    act(() => { rerender(<EmulatorToasts btInventory={inv(false)} controllers={[SFC30]} autoDismissMs={4000} />); });
    expect(screen.getByText(/SFC30 disconnected/i)).toBeTruthy();

    // auto-dismiss after the configured delay
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText(/disconnected/i)).toBeNull();

    // disconnected → connected
    act(() => { rerender(<EmulatorToasts btInventory={inv(true)} controllers={[SFC30]} autoDismissMs={4000} />); });
    expect(screen.getByText(/SFC30 connected/i)).toBeTruthy();
  });

  it('does not toast when the feed updates without a connection change', () => {
    const { rerender } = render(
      <EmulatorToasts btInventory={inv(true)} controllers={[SFC30]} autoDismissMs={4000} />,
    );
    // same connected state, different battery → no toast
    act(() => {
      rerender(
        <EmulatorToasts
          btInventory={[{ address: 'e4:17:d8:c6:54:f0', name: '8Bitdo SFC30 GamePad', connected: true, battery: 55 }]}
          controllers={[SFC30]}
          autoDismissMs={4000}
        />,
      );
    });
    expect(screen.queryByText(/connected/i)).toBeNull();
  });
});
