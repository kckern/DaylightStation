import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CoinCeremony, { CEREMONY_EXIT_MS } from './CoinCeremony.jsx';

const KID = { id: 'test-learner', name: 'Alpha' };
const toast = (over = {}) => ({ id: 1, revision: 0, learnerId: 'test-learner', gained: 3, total: 15, kid: KID, ...over });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CoinCeremony', () => {
  it('renders nothing without a toast', () => {
    render(<CoinCeremony toast={null} onDone={vi.fn()} />);
    expect(screen.queryByTestId('coin-ceremony')).toBeNull();
  });

  it('+N large, the week total smaller, the face, the name and the silver coin', () => {
    render(<CoinCeremony toast={toast()} onDone={vi.fn()} />);
    const pop = screen.getByTestId('coin-ceremony');
    expect(within(pop).getByText('+3')).toHaveClass('school-coin-ceremony__gained');
    expect(within(pop).getByText('15 this week')).toHaveClass('school-coin-ceremony__total');
    expect(within(pop).getByText('Alpha')).toHaveClass('school-coin-ceremony__name');
    expect(pop.querySelector('svg.coin-icon[data-metal="silver"]')).toBeTruthy();
    expect(within(pop).getByRole('status').textContent).toBe('Alpha earned 3 silver. 15 this week.');
    // It never takes focus from the keypad.
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves by itself after durationMs plus the exit, once', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<CoinCeremony toast={toast()} durationMs={1000} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(999); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('button').className).toContain('is-exiting');
    act(() => { vi.advanceTimersByTime(CEREMONY_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it('a merged rise (new revision) restarts its clock', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(<CoinCeremony toast={toast()} durationMs={1000} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(900); });
    rerender(<CoinCeremony toast={toast({ revision: 1, gained: 4, total: 16 })} durationMs={1000} onDone={onDone} />);
    expect(screen.getByText('+4')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(900); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100 + CEREMONY_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a tap, or OK on the focused card, dismisses it now', () => {
    const onDone = vi.fn();
    render(<CoinCeremony toast={toast()} onDone={onDone} />);
    const card = screen.getByRole('button', { name: 'Dismiss: Alpha earned 3 silver' });
    fireEvent.click(card);
    expect(onDone).toHaveBeenCalledWith(1);
  });
});
