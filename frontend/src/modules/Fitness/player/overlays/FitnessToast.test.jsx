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

  it('cleanly shows a new toast after the previous one fully dismissed and unmounted', () => {
    const onDone = vi.fn();
    const { rerender } = render(<FitnessToast toast={{ id: 1, title: 'A', durationMs: 4000 }} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); }); // toast 1 fully done
    expect(onDone).toHaveBeenCalledWith(1);
    rerender(<FitnessToast toast={null} onDone={onDone} />); // slot cleared
    rerender(<FitnessToast toast={{ id: 2, title: 'B', subtitle: 'second', durationMs: 4000 }} onDone={onDone} />);
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); });
    expect(onDone).toHaveBeenCalledWith(2);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('dismisses on click: fires onDone(id) once after the exit animation', () => {
    const onDone = vi.fn();
    const { container } = render(<FitnessToast toast={{ id: 9, title: 'Tap me', durationMs: 4000 }} onDone={onDone} />);
    const root = container.querySelector('.fitness-toast');
    expect(root).not.toBeNull();
    act(() => { root.click(); });
    // Not immediate — exit animation plays first.
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(320 + 5); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(9);
    // The original duration timer must NOT also fire onDone again.
    act(() => { vi.advanceTimersByTime(4000 + 320 + 5); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
