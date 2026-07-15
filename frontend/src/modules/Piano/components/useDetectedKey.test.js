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

  it('treats release-then-repress of the same pitch class as a new-note edge', () => {
    // Guards the correctness property that lastKeysRef is updated BEFORE the
    // no-new-notes early return: a release clears the "last keys", so re-pressing
    // the SAME MIDI that was held just before the release still counts as new and
    // advances the buffer.
    //
    // Setup: four notes ending on MIDI 67 (pc 7) leave the buffer at length 4 —
    // one short of detectKey's 5-note minimum — so the key is still 'C'. After a
    // release, re-pressing 67 must push a 5th pitch class and let detection fire
    // (→ 'G'). If the ref update moved below the early return, the release would
    // NOT clear 67 from lastKeys, the re-press would be swallowed, the buffer
    // would stay at 4, and the key would stay stuck on 'C'.
    const { result, rerender } = renderHook(
      ({ notes }) => useDetectedKey(notes),
      { initialProps: { notes: new Map() } },
    );

    // Four new notes, last one MIDI 67 (pc 7). Buffer pitch classes [11,2,7,7].
    [71, 62, 79, 67].forEach((midi) => {
      act(() => rerender({ notes: new Map([[midi, {}]]) }));
    });
    expect(result.current).toBe('C'); // only 4 buffered notes < 5

    // Release everything — key unchanged, and lastKeys is cleared.
    act(() => rerender({ notes: new Map() }));
    expect(result.current).toBe('C');

    // Re-press the SAME MIDI (67) held right before the release. This must count
    // as a new note → 5th buffer entry → detection fires and tracks the run.
    act(() => rerender({ notes: new Map([[67, {}]]) }));
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
