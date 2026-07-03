import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFollowTracker } from './useFollowTracker.js';

function makeSubscribe() {
  let cb = null;
  const subscribe = (fn) => { cb = fn; return () => { cb = null; }; };
  return { subscribe, emit: (note) => cb?.({ type: 'note_on', velocity: 80, note }) };
}

const STEPS = [
  { onsetQuarter: 0, notes: [{ midi: 60, staff: 0 }, { midi: 48, staff: 1 }] },
  { onsetQuarter: 1, notes: [{ midi: 64, staff: 0 }] },
];

describe('useFollowTracker', () => {
  it('does NOT advance until all active-staff notes are struck', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 0, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn() }));
    act(() => emit(60));
    expect(onStep).not.toHaveBeenCalled(); // LH 48 still needed
    act(() => emit(48));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('advances on the melody note alone when LH is deactivated', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: false }, step: 0, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn() }));
    act(() => emit(60));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('flags a plausible wrong note (within 2 octaves, not expected)', () => {
    const { subscribe, emit } = makeSubscribe();
    const onWrong = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 0, subscribe, onStep: vi.fn(), onHit: vi.fn(), onWrong }));
    act(() => emit(61));
    expect(onWrong).toHaveBeenCalled();
  });
});
