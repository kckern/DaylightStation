import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RewardsChest, { CHEST_OPEN_MS } from './RewardsChest.jsx';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('RewardsChest', () => {
  it('is icon-only, waits for opening, and ignores repeated taps', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<RewardsChest name="Alex" onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: "Open Alex's rewards" });
    expect(button.textContent).toBe('');
    fireEvent.click(button); fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(CHEST_OPEN_MS - 1));
    expect(onOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens immediately with reduced motion and cancels pending opens on unmount', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const onOpen = vi.fn();
    const { unmount } = render(<RewardsChest name="Alex" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount(); onOpen.mockClear();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const next = render(<RewardsChest name="Jamie" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button')); next.unmount();
    act(() => vi.advanceTimersByTime(CHEST_OPEN_MS));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
