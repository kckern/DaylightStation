import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePianoExitGesture } from './usePianoExitGesture.js';

const notes = (...midis) => new Map(midis.map(midi => [midi, {}]));
const board = { startNote: 28, endNote: 103 };
function setup(initial = notes()) {
  const onExit = vi.fn(), onContinue = vi.fn();
  let props = { activeNotes: initial, keyboard: board, onExit, onContinue, continueEnabled: true, enabled: true, resetKey: 'one' };
  const view = renderHook(p => usePianoExitGesture(p), { initialProps: props });
  return { ...view, onExit, onContinue, set: (patch) => { props = { ...props, ...patch }; view.rerender(props); } };
}
const advance = ms => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('physical piano exit and result recovery', () => {
  it('requires every entering key to be released before an interior key retries once', () => {
    const h = setup(notes(60, 64));
    h.set({ activeNotes: notes(64, 62) });
    expect(h.onContinue).not.toHaveBeenCalled();
    h.set({ activeNotes: notes() }); h.set({ activeNotes: notes(62) });
    expect(h.onContinue).toHaveBeenCalledTimes(1);
    h.set({ activeNotes: notes() }); h.set({ activeNotes: notes(65) });
    expect(h.onContinue).toHaveBeenCalledTimes(1);
  });
  it('holds a lone outer-key retry for the combo window, even for a short tap', () => {
    const h = setup();
    h.set({ activeNotes: notes(28) }); h.set({ activeNotes: notes() });
    advance(299); expect(h.onContinue).not.toHaveBeenCalled();
    advance(1); expect(h.onContinue).toHaveBeenCalledTimes(1);
    expect(h.onExit).not.toHaveBeenCalled();
  });
  it('lets the two-second outer combo win over retry', () => {
    const h = setup();
    h.set({ activeNotes: notes(28) }); advance(200);
    h.set({ activeNotes: notes(28, 103) });
    expect(h.result.current.exitHeld).toBe(true);
    advance(1999); expect(h.onExit).not.toHaveBeenCalled(); expect(h.onContinue).not.toHaveBeenCalled();
    advance(1); expect(h.onExit).toHaveBeenCalledTimes(1);
    advance(3000); expect(h.onExit).toHaveBeenCalledTimes(1); expect(h.onContinue).not.toHaveBeenCalled();
  });
  it('cancels a partial exit without converting its remaining key into retry', () => {
    const h = setup(); h.set({ activeNotes: notes(28, 103) }); advance(1000);
    h.set({ activeNotes: notes(28) }); advance(3000);
    expect(h.onExit).not.toHaveBeenCalled(); expect(h.onContinue).not.toHaveBeenCalled();
    h.set({ activeNotes: notes() }); h.set({ activeNotes: notes(72) });
    expect(h.onContinue).toHaveBeenCalledTimes(1);
  });
  it('re-arms result navigation only after a new result and full release', () => {
    const h = setup(); h.set({ activeNotes: notes(60) });
    h.set({ continueEnabled: false }); h.set({ continueEnabled: true });
    h.set({ activeNotes: notes(60, 62) }); expect(h.onContinue).toHaveBeenCalledTimes(1);
    h.set({ activeNotes: notes() }); h.set({ activeNotes: notes(62) });
    expect(h.onContinue).toHaveBeenCalledTimes(2);
  });
  it('treats outer keys as immediate retry keys when no exit handler exists', () => {
    const h = setup();
    h.set({ onExit: undefined });
    h.set({ activeNotes: notes(28, 103) });
    expect(h.onContinue).toHaveBeenCalledTimes(1);
    expect(h.result.current.exitHeld).toBe(false);
    expect(h.result.current.isExitKey(28)).toBe(false);
    advance(3000); expect(h.onContinue).toHaveBeenCalledTimes(1);
  });
  it('cancels pending timers on disable and unmount and uses configured outer keys', () => {
    const h = setup();
    expect(h.result.current.isExitKey(28)).toBe(true); expect(h.result.current.isExitKey(21)).toBe(false);
    h.set({ activeNotes: notes(28) }); h.set({ enabled: false }); advance(3000);
    expect(h.onContinue).not.toHaveBeenCalled(); expect(h.onExit).not.toHaveBeenCalled();
    h.set({ enabled: true, activeNotes: notes() }); h.set({ activeNotes: notes(28, 103) });
    h.unmount(); advance(3000); expect(h.onExit).not.toHaveBeenCalled();
  });
});
