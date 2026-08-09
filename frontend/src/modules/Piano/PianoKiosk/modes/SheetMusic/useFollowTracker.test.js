import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
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

  it('fires onComplete (not onStep) when the LAST step is satisfied, no range (M5)', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    const onComplete = vi.fn();
    // step index 1 is the last of STEPS (length 2). Satisfying it should complete.
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 1, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn(), onComplete }));
    act(() => emit(64)); // the only active note of the last step
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('with a range, the last step wraps (no onComplete)', () => {
    const { subscribe, emit } = makeSubscribe();
    const onComplete = vi.fn();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 1, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn(), onComplete, range: [0, 1] }));
    act(() => emit(64));
    expect(onComplete).not.toHaveBeenCalled();
    expect(onStep).toHaveBeenCalledWith(0); // wrapped to range start
  });

  // Green Hill Zone m2→m3: a G4+B4 chord ties across the barline, so m3's
  // downbeat has only the left hand's C4 as a new onset. Practicing RH-only,
  // that step expects nothing — the gate must step over it, not wait forever.
  const TIED = [
    { onsetQuarter: 0, notes: [{ midi: 67, staff: 0 }, { midi: 60, staff: 1 }] }, // 0 · both
    { onsetQuarter: 1, notes: [{ midi: 60, staff: 1 }] },                          // 1 · LH only (tie held the RH)
    { onsetQuarter: 2, notes: [{ midi: 65, staff: 0 }] },                          // 2 · RH resumes
  ];

  it('steps over an onset the active hand has nothing to play at', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({
      enabled: true, steps: TIED, activeParts: { 0: true, 1: false }, step: 0,
      subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn(), range: [0, 2],
    }));
    act(() => emit(67));
    expect(onStep).toHaveBeenCalledWith(2); // NOT 1 — step 1 is unplayable RH-only
  });

  it('moves off an unplayable step it has been parked on', () => {
    const { subscribe } = makeSubscribe();
    const onStep = vi.fn();
    // Landing on step 1 (LH-only) with RH-only active — e.g. a range whose
    // in-point falls on a left-hand onset. No key can satisfy it, so the gate
    // must move on by itself.
    renderHook(() => useFollowTracker({
      enabled: true, steps: TIED, activeParts: { 0: true, 1: false }, step: 1,
      subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn(), range: [0, 2],
    }));
    expect(onStep).toHaveBeenCalledWith(2);
  });

  it('fires onWrap when the skip carries past the range out-point', () => {
    const { subscribe, emit } = makeSubscribe();
    const onWrap = vi.fn();
    const onStep = vi.fn();
    // Range [0,1] RH-only: step 1 is LH-only, so satisfying step 0 skips it and
    // wraps home — still one completed lap of the loop.
    renderHook(() => useFollowTracker({
      enabled: true, steps: TIED, activeParts: { 0: true, 1: false }, step: 0,
      subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn(), range: [0, 1], onWrap,
    }));
    act(() => emit(67));
    expect(onStep).toHaveBeenCalledWith(0);
    expect(onWrap).toHaveBeenCalledTimes(1);
  });

  it('fires onWrap when the range wraps out→in', () => {
    const { subscribe, emit } = makeSubscribe();
    const onWrap = vi.fn();
    // range [0, 1]: satisfy step 0 (advances to 1), then step 1 → wraps back to 0.
    // A real `step` prop update is needed between the two satisfactions (the
    // hook only reads the range's out-point off the LATEST step), so this
    // harness threads the tracker's own onStep back in via useState, mirroring
    // how ScorePlayer actually drives it.
    const { result } = renderHook(() => {
      const [step, setStep] = useState(0);
      useFollowTracker({
        enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step,
        subscribe, onStep: setStep, onHit: vi.fn(), onWrong: vi.fn(),
        range: [0, 1], onWrap,
      });
      return step;
    });
    act(() => emit(60)); // step 0's only active note in this range (LH off by default here isn't relevant — both active)
    act(() => emit(48)); // completes step 0 → advances to step 1 (no wrap yet)
    expect(result.current).toBe(1);
    expect(onWrap).not.toHaveBeenCalled();
    act(() => emit(64)); // completes step 1 (the range's out-point) → wraps to 0
    expect(onWrap).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });
});
