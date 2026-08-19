import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnyKeyToContinue } from './useAnyKeyToContinue.js';

const notes = (...nums) => new Map(nums.map((n) => [n, { velocity: 100, timestamp: 1 }]));

const setup = (initial = { enabled: false, activeNotes: notes() }) => {
  const onContinue = vi.fn();
  const hook = renderHook(
    ({ enabled, activeNotes }) => useAnyKeyToContinue({ enabled, activeNotes, onContinue }),
    { initialProps: initial },
  );
  return { ...hook, onContinue };
};

describe('useAnyKeyToContinue', () => {
  it('does nothing while the game is still running', () => {
    const { rerender, onContinue } = setup();
    rerender({ enabled: false, activeNotes: notes(60) });
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('ignores the keys that were still down when the game ended', () => {
    // The winning move's own keys are held at the instant gameOver flips true.
    // Firing on those would restart before the player saw the result.
    const { rerender, onContinue } = setup();
    rerender({ enabled: true, activeNotes: notes(60, 64) });
    rerender({ enabled: true, activeNotes: notes(60, 64) });
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('continues on the first fresh key after the game ends', () => {
    const { rerender, onContinue } = setup();
    rerender({ enabled: true, activeNotes: notes(60) });   // held from the last move
    rerender({ enabled: true, activeNotes: notes() });     // released
    rerender({ enabled: true, activeNotes: notes(72) });   // a deliberate press
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('counts a re-press of the same key once it has been released', () => {
    const { rerender, onContinue } = setup();
    rerender({ enabled: true, activeNotes: notes(60) });
    rerender({ enabled: true, activeNotes: notes() });
    rerender({ enabled: true, activeNotes: notes(60) });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('fires only once per finished game, however many keys follow', () => {
    const { rerender, onContinue } = setup();
    rerender({ enabled: true, activeNotes: notes() });
    rerender({ enabled: true, activeNotes: notes(72) });
    rerender({ enabled: true, activeNotes: notes() });
    rerender({ enabled: true, activeNotes: notes(74) });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('re-arms for the next game', () => {
    const { rerender, onContinue } = setup();
    rerender({ enabled: true, activeNotes: notes() });
    rerender({ enabled: true, activeNotes: notes(72) });
    expect(onContinue).toHaveBeenCalledTimes(1);
    rerender({ enabled: false, activeNotes: notes() });   // new game underway
    rerender({ enabled: true, activeNotes: notes() });    // and it ends
    rerender({ enabled: true, activeNotes: notes(65) });
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  it('survives a missing notes Map', () => {
    const { rerender, onContinue } = setup();
    expect(() => rerender({ enabled: true, activeNotes: undefined })).not.toThrow();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
