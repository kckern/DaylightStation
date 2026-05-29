import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import FitnessToast, { TOAST_EXIT_MS } from './FitnessToast.jsx';

describe('FitnessToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing when there is no toast', () => {
    const { container } = render(<FitnessToast toast={null} onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the title and subtitle', () => {
    render(<FitnessToast toast={{ id: 1, title: 'Felix', subtitle: 'is riding the NiceDay', durationMs: 4000 }} onDone={() => {}} />);
    expect(screen.getByText('Felix')).toBeTruthy();
    expect(screen.getByText('is riding the NiceDay')).toBeTruthy();
  });

  it('calls onDone with the toast id after durationMs + exit', () => {
    const onDone = vi.fn();
    render(<FitnessToast toast={{ id: 1, title: 'Felix', durationMs: 4000 }} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it('resets the timer when a new toast id arrives and fires onDone once for the new id', () => {
    const onDone = vi.fn();
    const { rerender } = render(<FitnessToast toast={{ id: 1, title: 'A', durationMs: 4000 }} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(2000); });
    rerender(<FitnessToast toast={{ id: 2, title: 'B', durationMs: 4000 }} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(2);
  });
});
