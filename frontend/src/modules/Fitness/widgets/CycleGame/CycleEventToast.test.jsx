import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import CycleEventToast, { CYCLE_TOAST_DURATION_MS, CYCLE_TOAST_EXIT_MS } from './CycleEventToast.jsx';

const dnfToast = { id: 1, variant: 'dnf', icon: '🛑', title: 'Alan — Did Not Finish', subtitle: 'Stopped pedaling for 20s' };

describe('CycleEventToast', () => {
  it('renders nothing when there is no toast', () => {
    const { queryByTestId } = render(<CycleEventToast toast={null} onDone={() => {}} />);
    expect(queryByTestId('cycle-event-toast')).toBeNull();
  });

  it('shows the title, subtitle and variant in plain language', () => {
    const { getByTestId } = render(<CycleEventToast toast={dnfToast} onDone={() => {}} />);
    const el = getByTestId('cycle-event-toast');
    expect(el.getAttribute('data-variant')).toBe('dnf');
    expect(el.textContent).toContain('Did Not Finish');
    expect(el.textContent).toContain('Stopped pedaling for 20s');
  });

  it('auto-dismisses after its duration via onDone', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      render(<CycleEventToast toast={dnfToast} onDone={onDone} />);
      expect(onDone).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(CYCLE_TOAST_DURATION_MS + CYCLE_TOAST_EXIT_MS + 10); });
      expect(onDone).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismisses early on tap', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const { getByTestId } = render(<CycleEventToast toast={dnfToast} onDone={onDone} />);
      fireEvent.click(getByTestId('cycle-event-toast'));
      act(() => { vi.advanceTimersByTime(CYCLE_TOAST_EXIT_MS + 10); });
      expect(onDone).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
