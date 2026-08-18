import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNoteLauncher } from './useNoteLauncher.js';
import { buildLauncherSlots } from './launcherNotes.js';

vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

const { slots } = buildLauncherSlots([
  { id: 'invaders', label: 'Invaders', icon: 'i', status: 'released' },
  { id: 'tetris', label: 'Tetris', icon: 't', status: 'released' },
]);

/** Build an activeNotes Map. All notes share a timestamp so combos read as held. */
const notes = (...nums) => new Map(nums.map(n => [n, { velocity: 100, timestamp: Date.now() }]));

function setup() {
  return renderHook(
    ({ activeNotes }) => useNoteLauncher({ activeNotes, slots }),
    { initialProps: { activeNotes: new Map() } }
  );
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useNoteLauncher', () => {
  it('starts closed with no game', () => {
    const { result } = setup();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBeNull();
  });

  it('opens when the lowest and highest keys are struck together', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    expect(result.current.isOpen).toBe(true);
  });

  it('does not re-toggle while the combo keys stay down', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: notes(21, 108, 64) });   // still held, extra note
    expect(result.current.isOpen).toBe(true);
  });

  it('treats re-striking one combo key as the same gesture, not a new press', () => {
    // The latch clears only when BOTH keys are up. Let go of the top key and
    // re-strike it while the bottom one stays down and it is still one press --
    // otherwise a slightly ragged two-hand chord toggles twice and the launcher
    // flickers shut the moment it opens.
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    expect(result.current.isOpen).toBe(true);
    rerender({ activeNotes: notes(21) });             // top key up, bottom still down
    rerender({ activeNotes: notes(21, 108) });        // re-struck
    expect(result.current.isOpen).toBe(true);
  });

  it('closes when the combo is released and pressed again', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });
    expect(result.current.isOpen).toBe(false);
  });

  it('launches the game bound to a struck key', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(62) });            // D4 -> tetris
    expect(result.current.activeGameId).toBe('tetris');
    expect(result.current.isOpen).toBe(false);
  });

  it('ignores notes no key is bound to, so you can noodle over the menu', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(61) });            // C#4 - unbound
    rerender({ activeNotes: notes(64) });            // E4  - in range, but only 2 slots
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeGameId).toBeNull();
  });

  it('picks the lowest note when several are struck at once', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(62, 60) });
    expect(result.current.activeGameId).toBe('invaders');   // C4 wins
  });

  it('does not select a slot note that was already down when it opened', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(60) });                   // C4 held first
    rerender({ activeNotes: notes(60, 21, 108) });          // then the combo
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeGameId).toBeNull();
  });

  it('ignores slot notes struck while the launcher is closed', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(60) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(62) });
    expect(result.current.activeGameId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('closes on the 30s timeout and leaves the running game alone', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });                   // start invaders
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });              // reopen over the game
    rerender({ activeNotes: new Map() });
    expect(result.current.isOpen).toBe(true);

    act(() => { vi.advanceTimersByTime(30000); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBe('invaders');   // game survives
  });

  it('does not reset the timeout when you play unbound notes', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });

    act(() => { vi.advanceTimersByTime(20000); });
    rerender({ activeNotes: notes(61) });                   // noodle
    rerender({ activeNotes: new Map() });
    act(() => { vi.advanceTimersByTime(10000); });

    expect(result.current.isOpen).toBe(false);
  });

  it('does not reset the timeout when the caller re-renders with a fresh options object', () => {
    // The caller will almost certainly pass `options={{}}` inline, minting a new
    // object every render. If the timeout effect keys off anything derived from
    // that identity, an idle re-render silently buys the launcher another 30s.
    const { result, rerender } = renderHook(
      ({ activeNotes }) => useNoteLauncher({ activeNotes, slots, options: {} }),
      { initialProps: { activeNotes: new Map() } }
    );
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });

    act(() => { vi.advanceTimersByTime(29000); });
    for (let i = 0; i < 5; i += 1) rerender({ activeNotes: new Map() });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(result.current.isOpen).toBe(false);
  });

  it('holding the combo for 2s quits to free-play', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });                   // start invaders
    expect(result.current.activeGameId).toBe('invaders');

    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });              // press and hold
    expect(result.current.isHolding).toBe(true);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeGameId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('a released combo is a tap, not a hold', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ activeNotes: new Map() });
    expect(result.current.isHolding).toBe(false);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.isOpen).toBe(true);               // still open, not quit
  });

  it('re-opens normally after a hold-to-quit', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    act(() => { vi.advanceTimersByTime(2000); });           // quit to free-play
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isHolding).toBe(false);

    rerender({ activeNotes: new Map() });                   // release
    rerender({ activeNotes: notes(21, 108) });              // press again
    expect(result.current.isOpen).toBe(true);
  });

  it('dismiss() closes without disturbing the running game', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });

    act(() => { result.current.dismiss('escape'); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBe('invaders');
  });

  it('exitGame() quits the running game and closes the launcher', () => {
    // What a game's own quit button and the crash boundary call. Unlike
    // dismiss(), this one is meant to cost you the game.
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });                   // start invaders
    expect(result.current.activeGameId).toBe('invaders');

    act(() => { result.current.exitGame('quit-button'); });
    expect(result.current.activeGameId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('exitGame() closes an open launcher too', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });              // launcher open over the game
    rerender({ activeNotes: new Map() });
    expect(result.current.isOpen).toBe(true);

    act(() => { result.current.exitGame('crash'); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBeNull();
  });

  it('honours an initialGame for URL deep-links', () => {
    const { result } = renderHook(() =>
      useNoteLauncher({ activeNotes: new Map(), slots, initialGame: 'tetris' })
    );
    expect(result.current.activeGameId).toBe('tetris');
    expect(result.current.isOpen).toBe(false);
  });

  it('survives a caller with no MIDI map yet', () => {
    // useMidiSubscription always hands back a Map, but Task 6 wires this hook
    // above that hook's own readiness -- rendering before MIDI exists must not
    // throw, it must just sit there closed.
    const { result } = renderHook(() => useNoteLauncher({ activeNotes: undefined, slots }));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBeNull();
  });

  it('leaves no timers behind on unmount', () => {
    const { rerender, unmount } = setup();
    rerender({ activeNotes: notes(21, 108) });   // launcher open AND combo held:
    expect(vi.getTimerCount()).toBeGreaterThan(0); // both timers armed
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
