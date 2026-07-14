import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoreEvaluator } from './useScoreEvaluator.js';

function makeSubscribe() {
  let cb = null;
  const subscribe = (fn) => { cb = fn; return () => { cb = null; }; };
  return { subscribe, emit: (note) => cb?.({ type: 'note_on', velocity: 80, note }) };
}

const cfg = { silentMeasuresToStop: 2, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } };
// expectedByMeasure[m] = midis due in measure m
const EXPECTED = { 0: [60], 1: [64], 2: [67] };
const opts = (over) => ({
  enabled: true,
  cfg,
  subscribe: over.subscribe,
  currentMeasure: over.currentMeasure,
  expectedForMeasure: (m) => EXPECTED[m] || [],
  driftForNote: () => 0, // on-time
  onMeasureGrade: over.onMeasureGrade,
  onSilentStop: over.onSilentStop,
});

describe('useScoreEvaluator', () => {
  it('grades a measure when currentMeasure advances', () => {
    const { subscribe, emit } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook((p) => useScoreEvaluator(opts({ subscribe, currentMeasure: p.m, onMeasureGrade, onSilentStop: vi.fn() })), { initialProps: { m: 0 } });
    act(() => emit(60)); // play measure 0's note
    rerender({ m: 1 }); // advance → grade measure 0
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    expect(onMeasureGrade.mock.calls[0][0]).toMatchObject({ measure: 0, grade: 'green' });
  });

  it('fires onSilentStop after N consecutive silent measures', () => {
    const { subscribe } = makeSubscribe();
    const onSilentStop = vi.fn();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook((p) => useScoreEvaluator(opts({ subscribe, currentMeasure: p.m, onMeasureGrade, onSilentStop })), { initialProps: { m: 0 } });
    rerender({ m: 1 }); // measure 0 silent (1)
    rerender({ m: 2 }); // measure 1 silent (2) → stop
    expect(onSilentStop).toHaveBeenCalledTimes(1);
  });

  it('a non-silent measure resets the silent run', () => {
    const { subscribe, emit } = makeSubscribe();
    const onSilentStop = vi.fn();
    const { rerender } = renderHook((p) => useScoreEvaluator(opts({ subscribe, currentMeasure: p.m, onMeasureGrade: vi.fn(), onSilentStop })), { initialProps: { m: 0 } });
    rerender({ m: 1 });          // measure 0 silent (1)
    act(() => emit(64));         // play measure 1
    rerender({ m: 2 });          // measure 1 graded (not silent) → reset
    rerender({ m: 3 });          // measure 2 silent (1)
    expect(onSilentStop).not.toHaveBeenCalled();
  });

  it('finalize() grades the current (final) measure once — end-of-piece completion (H1)', () => {
    const { subscribe, emit } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { result } = renderHook(() => useScoreEvaluator(opts({ subscribe, currentMeasure: 2, onMeasureGrade, onSilentStop: vi.fn() })));
    act(() => emit(67));         // play measure 2's note; cursor never leaves it
    act(() => result.current.finalize());
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    expect(onMeasureGrade.mock.calls[0][0]).toMatchObject({ measure: 2, grade: 'green' });
    act(() => result.current.finalize()); // idempotent
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
  });

  it('finalize() is a no-op when disabled', () => {
    const { subscribe } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { result } = renderHook(() => useScoreEvaluator({
      enabled: false, cfg, subscribe, currentMeasure: 2,
      expectedForMeasure: (m) => EXPECTED[m] || [], driftForNote: () => 0,
      onMeasureGrade, onSilentStop: vi.fn(),
    }));
    act(() => result.current.finalize());
    expect(onMeasureGrade).not.toHaveBeenCalled();
  });
});
