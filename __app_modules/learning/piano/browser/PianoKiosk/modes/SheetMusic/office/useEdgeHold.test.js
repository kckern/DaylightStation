import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useEdgeHold from './useEdgeHold.js';

const LOW = 28;
const HIGH = 103;
const held = (...notes) => new Map(notes.map((note) => [note, { velocity: 80, timestamp: 1 }]));
const setup = (onHold, enabled = true) => renderHook(
  ({ activeNotes }) => useEdgeHold({ activeNotes, low: LOW, high: HIGH, enabled, onHold }),
  { initialProps: { activeNotes: held() } },
);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useEdgeHold (the board\'s lowest + highest keys, held)', () => {
  it('fires once after both edge keys are held 2 s', () => {
    const onHold = vi.fn();
    const { result, rerender } = setup(onHold);
    rerender({ activeNotes: held(LOW, HIGH) });
    expect(result.current.holding).toBe(true);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(onHold).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(result.current.holding).toBe(false);
    // Still held, other notes come and go: the same hold, not a second one.
    rerender({ activeNotes: held(LOW, HIGH, 60) });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onHold).toHaveBeenCalledTimes(1);
    // Let go of both and hold again: a new hold.
    rerender({ activeNotes: held() });
    rerender({ activeNotes: held(LOW, HIGH) });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onHold).toHaveBeenCalledTimes(2);
  });

  it('never fires for one edge key, or for a release before 2 s', () => {
    const onHold = vi.fn();
    const { result, rerender } = setup(onHold);
    rerender({ activeNotes: held(LOW) });
    act(() => { vi.advanceTimersByTime(3000); });
    rerender({ activeNotes: held(LOW, HIGH) });
    act(() => { vi.advanceTimersByTime(1500); });
    rerender({ activeNotes: held(LOW) }); // the top key up early
    expect(result.current.holding).toBe(false);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does nothing while switched off', () => {
    const onHold = vi.fn();
    const { result, rerender } = setup(onHold, false);
    rerender({ activeNotes: held(LOW, HIGH) });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onHold).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
  });
});
