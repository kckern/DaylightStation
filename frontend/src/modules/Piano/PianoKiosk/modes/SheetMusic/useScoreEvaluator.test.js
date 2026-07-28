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
  enabled: over.enabled ?? true,
  cfg,
  subscribe: over.subscribe,
  currentMeasure: over.currentMeasure,
  boundary: over.boundary, // undefined → the hook's default (0)
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

  // ── Loop wraps (Task 9) ─────────────────────────────────────────────────────
  // A one-measure loop wraps from the end of measure N back to its START, so
  // `currentMeasure` never changes and the advance rule alone never grades.
  it('grades the repeated measure when a single-measure loop wraps', () => {
    const { subscribe, emit } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook(
      (p) => useScoreEvaluator(opts({ subscribe, currentMeasure: 2, boundary: p.boundary, onMeasureGrade, onSilentStop: vi.fn() })),
      { initialProps: { boundary: 0 } },
    );
    act(() => emit(67));                             // play measure 2's note
    expect(onMeasureGrade).not.toHaveBeenCalled();   // mid-measure, nothing yet
    rerender({ boundary: 1 });                       // the loop wrapped
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    expect(onMeasureGrade.mock.calls[0][0]).toMatchObject({ measure: 2, grade: 'green' });
  });

  it('a multi-measure wrap grades the OUTGOING measure exactly once (no double-grade)', () => {
    // m2 → m0 is both a measure-index change AND a boundary bump in the same
    // commit; only the measure that just ended (m2) may be graded, and only once.
    const { subscribe, emit } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook(
      (p) => useScoreEvaluator(opts({ subscribe, currentMeasure: p.m, boundary: p.boundary, onMeasureGrade, onSilentStop: vi.fn() })),
      { initialProps: { m: 2, boundary: 0 } },
    );
    act(() => emit(67));
    rerender({ m: 0, boundary: 1 }); // wrap m2 → m0
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    expect(onMeasureGrade.mock.calls[0][0]).toMatchObject({ measure: 2, grade: 'green' });
  });

  it('consecutive silent wraps of a one-measure loop reach the silent stop (not sooner, not never)', () => {
    const { subscribe } = makeSubscribe();
    const onSilentStop = vi.fn();
    const { rerender } = renderHook(
      (p) => useScoreEvaluator(opts({ subscribe, currentMeasure: 2, boundary: p.boundary, onMeasureGrade: vi.fn(), onSilentStop })),
      { initialProps: { boundary: 0 } },
    );
    rerender({ boundary: 1 }); // silent measure 1 of 2
    expect(onSilentStop).not.toHaveBeenCalled();
    rerender({ boundary: 2 }); // silent measure 2 of 2 → stop
    expect(onSilentStop).toHaveBeenCalledTimes(1);
  });

  it('re-entering Polish after wraps does not fire a phantom grade', () => {
    // `boundary` is monotonic component state upstream — it is never reset. The
    // disabled reset must re-sync it, or the first commit back in Polish would
    // read the stale value as a wrap and grade an empty measure.
    const { subscribe, emit } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook(
      (p) => useScoreEvaluator(opts({ enabled: p.enabled, subscribe, currentMeasure: 2, boundary: p.boundary, onMeasureGrade, onSilentStop: vi.fn() })),
      { initialProps: { enabled: true, boundary: 0 } },
    );
    act(() => emit(67));
    rerender({ enabled: true, boundary: 1 }); // a real wrap → one grade
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    rerender({ enabled: false, boundary: 1 }); // leave Polish
    rerender({ enabled: true, boundary: 1 });  // come back
    expect(onMeasureGrade).toHaveBeenCalledTimes(1); // no phantom
  });

  it('wraps that happen WHILE disabled do not fire a phantom grade on re-enable', () => {
    // The loop follows Listen↔Polish, and Listen wraps bump `boundary` with the
    // evaluator disabled. The disabled reset has to track those, or the first
    // commit back in Polish reads the stale value as a wrap and grades a measure
    // the user has not played yet.
    const { subscribe } = makeSubscribe();
    const onMeasureGrade = vi.fn();
    const { rerender } = renderHook(
      (p) => useScoreEvaluator(opts({ enabled: p.enabled, subscribe, currentMeasure: 2, boundary: p.boundary, onMeasureGrade, onSilentStop: vi.fn() })),
      { initialProps: { enabled: false, boundary: 0 } },
    );
    rerender({ enabled: false, boundary: 1 }); // a Listen loop wrap
    rerender({ enabled: false, boundary: 2 }); // …and another
    rerender({ enabled: true, boundary: 2 });  // Polish + Play
    expect(onMeasureGrade).not.toHaveBeenCalled();
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
