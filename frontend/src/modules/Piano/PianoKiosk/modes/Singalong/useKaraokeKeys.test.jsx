// useKaraokeKeys.test.jsx — the karaoke keyboard vocabulary, and the override
// contract with the shared Player: handled keys are swallowed in the capture
// phase (the Player's window bubble listener must never see them); unhandled
// keys (Space etc.) flow through untouched. Audio and the mix context are
// mocked — jsdom has neither.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useKaraokeKeys, { APPLAUSE_SFX_DIR, DOUBLE_PRESS_MS } from './useKaraokeKeys.js';
import { stepToLevel } from '../../volumeCurve.js';

// NOTE: vi.hoisted() factories run before any top-level `import` binding is
// initialized (even ones not part of a vi.mock() factory) — calling the
// imported stepToLevel() here throws a TDZ ReferenceError on `__vi_import_*`
// under vitest 4. `mediaLevel` is a placeholder only: beforeEach() below
// unconditionally overwrites it with the real stepToLevel(2, 'log') value
// before every test runs, so this never affects an assertion.
const h = vi.hoisted(() => ({
  mix: { mediaLevel: 0, setMediaLevel: vi.fn() },
  audios: [],
  fetch: vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../PianoMixContext.jsx', () => ({ usePianoMix: () => h.mix }));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightMediaPath: (p) => `http://test${p}` }));

class FakeAudio {
  constructor(src) { this.src = src; this.currentTime = 99; this.play = vi.fn(() => Promise.resolve()); h.audios.push(this); }
}

const press = (key, opts = {}) => {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...opts });
  window.dispatchEvent(e);
  return e;
};

const deps = () => ({
  onSkip: vi.fn(),
  onRestart: vi.fn(),
  onEndSong: vi.fn(),
  onToggleFullscreen: vi.fn(),
  keyControlRef: { current: { step: vi.fn(), reset: vi.fn(), engineFailed: false } },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', h.fetch);
  h.audios.length = 0;
  h.fetch.mockClear();
  h.fetch.mockImplementation(() => Promise.resolve({ ok: false }));
  h.mix.setMediaLevel.mockClear();
  h.mix.mediaLevel = stepToLevel(2, 'log');
});
afterEach(() => { vi.useRealTimers(); });

describe('useKaraokeKeys', () => {
  it('ArrowRight seeks forward and NEVER skips, even double-pressed fast', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    // Simulate the shared Player's window bubble listener.
    const playerListener = vi.fn();
    window.addEventListener('keydown', playerListener);
    press('ArrowRight');
    vi.advanceTimersByTime(50); // well inside the double-press window
    press('ArrowRight');
    expect(d.onSkip).toHaveBeenCalledTimes(2);
    expect(d.onSkip).toHaveBeenLastCalledWith(15);
    expect(d.onEndSong).not.toHaveBeenCalled();
    expect(playerListener).not.toHaveBeenCalled(); // swallowed before the Player
    window.removeEventListener('keydown', playerListener);
  });

  it('single ArrowLeft seeks back; a fast second ArrowLeft restarts at 0:00', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('ArrowLeft');
    expect(d.onSkip).toHaveBeenLastCalledWith(-15);
    vi.advanceTimersByTime(DOUBLE_PRESS_MS - 100);
    press('ArrowLeft');
    expect(d.onRestart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DOUBLE_PRESS_MS + 100);
    press('ArrowLeft');
    expect(d.onSkip).toHaveBeenCalledTimes(2); // slow press seeks again, no restart
    expect(d.onRestart).toHaveBeenCalledTimes(1);
  });

  it('End ends the song; Home toggles fullscreen', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('End');
    expect(d.onEndSong).toHaveBeenCalledTimes(1);
    press('Home');
    expect(d.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp/ArrowDown step the key through the KeyControl api, gated on engine failure', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('ArrowUp');
    expect(d.keyControlRef.current.step).toHaveBeenLastCalledWith(1);
    press('ArrowDown');
    expect(d.keyControlRef.current.step).toHaveBeenLastCalledWith(-1);
    d.keyControlRef.current.engineFailed = true;
    press('ArrowUp');
    expect(d.keyControlRef.current.step).toHaveBeenCalledTimes(2); // no third call
  });

  it('plus/minus (top row and numpad) step media volume on the shared five-step curve', () => {
    const d = deps();
    const { rerender } = renderHook(() => useKaraokeKeys(d));
    press('+');
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(3, 'log'));
    press('-', { code: 'NumpadSubtract' });
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(1, 'log'));
    // clamp at Max: simulate already at top step. Mutating the mocked mix
    // object in place doesn't itself trigger a re-render the way a real
    // context update would — force one, mirroring production where
    // setMediaLevel's state update re-renders every usePianoMix() consumer
    // (including this hook's owning component), refreshing cbRef.current.
    h.mix.mediaLevel = stepToLevel(4, 'log');
    rerender();
    press('=');
    expect(h.mix.setMediaLevel).toHaveBeenLastCalledWith(stepToLevel(4, 'log'));
  });

  it('Numpad 0 plays a random applause file from the discovered folder', async () => {
    // HEAD probes: only 001 and 003 exist (gap at 002 must be tolerated).
    h.fetch.mockImplementation((url) => Promise.resolve({ ok: /001\.mp3$|003\.mp3$/.test(url) }));
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.audios.length).toBe(1);
    expect(h.audios[0].src).toMatch(new RegExp(`http://test${APPLAUSE_SFX_DIR}/(001|003)\\.mp3$`));
    expect(h.audios[0].play).toHaveBeenCalled();
    // Second press: discovery is cached (no new probe volley), a fresh Audio
    // plays (overlapping applause is fine).
    const probesAfterFirst = h.fetch.mock.calls.length;
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.fetch.mock.calls.length).toBe(probesAfterFirst);
    expect(h.audios.length).toBe(2);
  });

  it('an empty applause folder only warns — never throws', async () => {
    h.fetch.mockImplementation(() => Promise.resolve({ ok: false }));
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    press('0', { code: 'Numpad0' });
    await vi.runAllTimersAsync();
    expect(h.audios.length).toBe(0);
  });

  it('top-row 0 does nothing; unhandled keys reach the Player untouched', () => {
    const d = deps();
    renderHook(() => useKaraokeKeys(d));
    const playerListener = vi.fn();
    window.addEventListener('keydown', playerListener);
    press('0', { code: 'Digit0' });
    expect(h.audios.length).toBe(0);
    const space = press(' ');
    expect(playerListener).toHaveBeenCalledTimes(2); // Digit0 + Space both flowed through
    expect(space.defaultPrevented).toBe(false);
    window.removeEventListener('keydown', playerListener);
  });

  it('removes its listener on unmount', () => {
    const d = deps();
    const { unmount } = renderHook(() => useKaraokeKeys(d));
    unmount();
    press('End');
    expect(d.onEndSong).not.toHaveBeenCalled();
  });
});
