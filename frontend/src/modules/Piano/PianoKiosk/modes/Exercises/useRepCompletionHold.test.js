import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useRepCompletionHold, { REP_HOLD_MS } from './useRepCompletionHold.js';

const ev = (midi) => ({ notes: [{ midi }] });
const instance = { deck: { sets: 1, reps: 3, unit: 3 }, events: Array.from({ length: 9 }, (_, i) => ev(60 + i)) };

function setup(initial) {
  const logger = { info: vi.fn() };
  const hook = renderHook((props) => useRepCompletionHold({ instance, enabled: true, logger, traceFields: { assessmentId: 'a1' }, ...props }), {
    initialProps: { cursorIndex: initial },
  });
  return { ...hook, logger };
}

describe('useRepCompletionHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the finished rep, every note done, when the cursor crosses into the next rep', () => {
    const { result, rerender, logger } = setup(2);
    expect(result.current).toBeNull();
    rerender({ cursorIndex: 3 });
    expect(result.current).toMatchObject({ repOffset: 0, repIndex: 0 });
    expect(result.current.window.events).toEqual(instance.events.slice(0, 3));
    expect(result.current.window.cursorIndex).toBe(3);
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-completed', expect.objectContaining({ repIndex: 0, unit: 3, holdMs: REP_HOLD_MS, assessmentId: 'a1' }));
  });

  it('releases after REP_HOLD_MS and logs how it ended', () => {
    const { result, rerender, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    act(() => { vi.advanceTimersByTime(REP_HOLD_MS); });
    expect(result.current).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-hold-released', expect.objectContaining({ repIndex: 0, endedBy: 'timer' }));
  });

  it('releases at once when the child makes progress in the next rep (no correct note is ever hidden)', () => {
    const { result, rerender, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    rerender({ cursorIndex: 4 });
    expect(result.current).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-hold-released', expect.objectContaining({ repIndex: 0, endedBy: 'next-input' }));
  });

  it('a backward cursor move (reset) releases the hold labelled reset, not next-input', () => {
    const { result, rerender, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    rerender({ cursorIndex: 0 });
    expect(result.current).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-hold-released', expect.objectContaining({ repIndex: 0, endedBy: 'reset' }));
  });

  it('does not hold inside a rep, at the end of the run, or when disabled', () => {
    const { result, rerender } = setup(0);
    rerender({ cursorIndex: 1 });
    expect(result.current).toBeNull();
    rerender({ cursorIndex: 8 });
    rerender({ cursorIndex: 9 });
    expect(result.current).toBeNull();
    const off = renderHook((p) => useRepCompletionHold({ instance, enabled: false, logger: { info: vi.fn() }, traceFields: {}, ...p }), { initialProps: { cursorIndex: 2 } });
    off.rerender({ cursorIndex: 3 });
    expect(off.result.current).toBeNull();
  });

  it('clears its timer on unmount', () => {
    const { rerender, unmount, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    unmount();
    logger.info.mockClear();
    act(() => { vi.advanceTimersByTime(REP_HOLD_MS * 2); });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('a new instance (runtime swap) drops any hold', () => {
    const { result, rerender } = setup(2);
    rerender({ cursorIndex: 3 });
    const fresh = { ...instance, events: [...instance.events] };
    rerender({ cursorIndex: 0, instance: fresh });
    expect(result.current).toBeNull();
  });
});
