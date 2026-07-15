import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDetectedKey } from './useDetectedKey.js';

// Feed pitch classes as a stream of NEW notes. Each pitch class is placed at a
// distinct MIDI octave so every step registers as a fresh key (only new keys
// count toward the rolling buffer), matching how live playing hits the hook.
function midiFor(pc, step) {
  return pc + 12 * step; // distinct per step, still pc % 12 === pc
}

function playSequence(pitchClasses) {
  // Each render swaps in a singleton Map with the next new note. Releasing the
  // previous note does not affect the key buffer.
  const { result, rerender } = renderHook(
    ({ notes }) => useDetectedKey(notes),
    { initialProps: { notes: new Map() } },
  );
  pitchClasses.forEach((pc, i) => {
    act(() => {
      rerender({ notes: new Map([[midiFor(pc, i), {}]]) });
    });
  });
  return result;
}

describe('useDetectedKey', () => {
  it('starts at C with empty input', () => {
    const { result } = renderHook(() => useDetectedKey(new Map()));
    expect(result.current).toBe('C');
  });

  it('stays at C with fewer than five buffered notes', () => {
    const result = playSequence([7, 11, 2]); // 3 new notes < 5
    expect(result.current).toBe('C');
  });

  it('detects G major from a rolling stream of new notes', () => {
    // Same G-major run proven for the improved detectKey.
    const result = playSequence([7, 11, 2, 7, 11, 2, 9, 6, 4, 7]);
    expect(result.current).toBe('G');
  });

  it('does not change the key when notes are released', () => {
    const { result, rerender } = renderHook(
      ({ notes }) => useDetectedKey(notes),
      { initialProps: { notes: new Map() } },
    );
    const gMajor = [7, 11, 2, 7, 11, 2, 9, 6, 4, 7];
    gMajor.forEach((pc, i) => {
      act(() => rerender({ notes: new Map([[midiFor(pc, i), {}]]) }));
    });
    expect(result.current).toBe('G');

    // Release everything — key must hold.
    act(() => rerender({ notes: new Map() }));
    expect(result.current).toBe('G');
  });
});
