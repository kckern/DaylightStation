import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useStableChord } from './useStableChord.js';

const chord = (name) => ({ displayName: name });
const EMPTY = { displayName: '' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('useStableChord', () => {
  it('does not show a new chord until it has settled', () => {
    const { result, rerender } = renderHook(({ c }) => useStableChord(c, { settleMs: 80, holdMs: 500 }), {
      initialProps: { c: EMPTY },
    });
    rerender({ c: chord('C major') });
    // Not yet — still within the settle window.
    expect(result.current.displayName).toBe('');
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('C major');
  });

  it('does not flash a transient chord that is replaced before it settles', () => {
    const { result, rerender } = renderHook(({ c }) => useStableChord(c, { settleMs: 80, holdMs: 500 }), {
      initialProps: { c: EMPTY },
    });
    // Roll: C5 (partial) → 40ms → C major (full), before the first settles.
    rerender({ c: chord('C5') });
    act(() => { vi.advanceTimersByTime(40); });
    rerender({ c: chord('C major') });
    expect(result.current.displayName).toBe(''); // C5 never showed
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('C major'); // only the settled one
  });

  it('holds the last chord for holdMs on release, then blanks', () => {
    const { result, rerender } = renderHook(({ c }) => useStableChord(c, { settleMs: 80, holdMs: 500 }), {
      initialProps: { c: EMPTY },
    });
    rerender({ c: chord('D minor') });
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('D minor');
    // Release — lingers, then clears.
    rerender({ c: EMPTY });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current.displayName).toBe('D minor');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.displayName).toBe('');
  });

  it('a quick lift-and-replace within holdMs never flickers to empty', () => {
    const { result, rerender } = renderHook(({ c }) => useStableChord(c, { settleMs: 80, holdMs: 500 }), {
      initialProps: { c: EMPTY },
    });
    rerender({ c: chord('C major') });
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('C major');
    // Momentary release, then a new chord before holdMs elapses.
    rerender({ c: EMPTY });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.displayName).toBe('C major'); // still holding
    rerender({ c: chord('G major') });
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('G major'); // settled to the new chord, never blanked
  });

  it('re-identifying the same chord does not reset or flicker', () => {
    const { result, rerender } = renderHook(({ c }) => useStableChord(c, { settleMs: 80, holdMs: 500 }), {
      initialProps: { c: EMPTY },
    });
    rerender({ c: chord('C major') });
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current.displayName).toBe('C major');
    // Same chord re-identified (new object) — stays put, no settle delay.
    rerender({ c: chord('C major') });
    expect(result.current.displayName).toBe('C major');
  });
});
