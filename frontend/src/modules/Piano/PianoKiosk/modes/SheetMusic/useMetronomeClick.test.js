import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useMetronomeClick } from './useMetronomeClick.js';

afterEach(() => cleanup());

// One shared scheduler spy behind a STABLE factory reference, so the mount
// effect (which depends on `createScheduler`) doesn't resubscribe.
function makeHarness() {
  const sched = { start: vi.fn(), stop: vi.fn(), setBpm: vi.fn() };
  const createScheduler = () => sched;
  return { sched, createScheduler };
}

describe('useMetronomeClick', () => {
  it('starts the scheduler with the bpm when enabled', () => {
    const { sched, createScheduler } = makeHarness();
    renderHook(() => useMetronomeClick({ enabled: true, bpm: 120, createScheduler }));
    expect(sched.start).toHaveBeenCalledTimes(1);
    expect(sched.start).toHaveBeenCalledWith(120);
  });

  it('does not start when disabled from the start', () => {
    const { sched, createScheduler } = makeHarness();
    renderHook(() => useMetronomeClick({ enabled: false, bpm: 120, createScheduler }));
    expect(sched.start).not.toHaveBeenCalled();
  });

  it('stops the scheduler when disabled', () => {
    const { sched, createScheduler } = makeHarness();
    const { rerender } = renderHook(
      ({ on }) => useMetronomeClick({ enabled: on, bpm: 120, createScheduler }),
      { initialProps: { on: true } },
    );
    expect(sched.start).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    expect(sched.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the scheduler on unmount', () => {
    const { sched, createScheduler } = makeHarness();
    const { unmount } = renderHook(() => useMetronomeClick({ enabled: true, bpm: 120, createScheduler }));
    unmount();
    expect(sched.stop).toHaveBeenCalledTimes(1);
  });

  it('retunes via setBpm (no restart) when bpm changes while enabled', () => {
    const { sched, createScheduler } = makeHarness();
    const { rerender } = renderHook(
      ({ bpm }) => useMetronomeClick({ enabled: true, bpm, createScheduler }),
      { initialProps: { bpm: 120 } },
    );
    expect(sched.start).toHaveBeenCalledTimes(1);
    rerender({ bpm: 90 });
    expect(sched.setBpm).toHaveBeenLastCalledWith(90);
    expect(sched.start).toHaveBeenCalledTimes(1); // NOT restarted
    expect(sched.stop).not.toHaveBeenCalled();
  });
});
