import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import CycleEventToast, { CYCLE_TOAST_DURATION_MS, CYCLE_TOAST_EXIT_MS, CYCLE_TOAST_VARIANTS } from "./CycleEventToast.jsx";

const parkedToast = { id: 1, variant: 'parked', icon: null, title: 'User_4 is parked', subtitle: 'Pedal to rejoin' };

describe('CycleEventToast', () => {
  it('renders nothing when there is no toast', () => {
    const { queryByTestId } = render(<CycleEventToast toast={null} onDone={() => {}} />);
    expect(queryByTestId('cycle-event-toast')).toBeNull();
  });

  it('shows the title, subtitle and variant in plain language', () => {
    const { getByTestId } = render(<CycleEventToast toast={parkedToast} onDone={() => {}} />);
    const el = getByTestId('cycle-event-toast');
    expect(el.getAttribute('data-variant')).toBe('parked');
    expect(el.textContent).toContain('User_4 is parked');
    expect(el.textContent).toContain('Pedal to rejoin');
  });

  it('knows the parked and nosensor variants and has no dnf or penalty variant', () => {
    expect(CYCLE_TOAST_VARIANTS).toEqual(expect.arrayContaining(['parked', 'nosensor']));
    expect(CYCLE_TOAST_VARIANTS).not.toContain('dnf');
    expect(CYCLE_TOAST_VARIANTS).not.toContain('penalty');
  });

  // A heart-rate zone going up is good news: its own positive variant.
  it('has a boost variant and shows it', () => {
    expect(CYCLE_TOAST_VARIANTS).toContain('boost');
    const { getByTestId } = render(
      <CycleEventToast toast={{ id: 9, variant: 'boost', icon: null, title: 'Rider A: Hot ×1.4' }} onDone={() => {}} />
    );
    expect(getByTestId('cycle-event-toast').getAttribute('data-variant')).toBe('boost');
    expect(getByTestId('cycle-event-toast').className).toContain('cycle-event-toast--boost');
  });

  it('auto-dismisses after its duration via onDone', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      render(<CycleEventToast toast={parkedToast} onDone={onDone} />);
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
      const { getByTestId } = render(<CycleEventToast toast={parkedToast} onDone={onDone} />);
      fireEvent.click(getByTestId('cycle-event-toast'));
      act(() => { vi.advanceTimersByTime(CYCLE_TOAST_EXIT_MS + 10); });
      expect(onDone).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
