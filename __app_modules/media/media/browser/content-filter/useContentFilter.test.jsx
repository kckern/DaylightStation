import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Spy on the structured logger so we can assert observability events.
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock("../../../../../frontend/src/lib/logging/singleton.js", () => ({ getChildLogger: () => mockLogger }));

import { useContentFilter } from "./useContentFilter.js";
import { isSkipCardPaused } from "./skipCardState.js";

function makeFakeEl() {
  const handlers = {};
  const el = {
    currentTime: 0,
    muted: false,
    volume: 1,
    paused: false,
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
  };
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => { el.paused = false; });
  return el;
}

const profile = {
  categories: {
    'language/profanity': { effect: 'bleep', sound: 'car-horn' },
    'language/blasphemy': { effect: 'mute' },
    'violence/graphic': { effect: 'skip' },
    nudity: { effect: 'censor-bar' },
  },
};
const edl = {
  cues: [
    { id: 'ble', category: 'language/profanity/fuck', in: 10, out: 12 },
    { id: 'mut', category: 'language/blasphemy/god', in: 20, out: 22 },
    { id: 'skp', category: 'violence/graphic', in: 100, out: 130, label: 'fight' },
    { id: 'cen', category: 'nudity/toplessness', in: 200, out: 206, rect: { x: 0.4, y: 0.5, w: 0.2, h: 0.2 } },
  ],
};

function setup(overrides = {}) {
  const el = makeFakeEl();
  const transport = { seek: vi.fn((s) => { el.currentTime = s; }) };
  const sfx = { play: vi.fn(), stop: vi.fn() };
  // Stable identity, as in production (useCommonMediaController's useCallback):
  // an inline arrow here would re-run the hook's effect on every re-render.
  const getMediaEl = () => el;
  const hook = renderHook(() => useContentFilter({
    getMediaEl, transport, sfx, edl, profile, enabled: true, ...overrides,
  }));
  return { el, transport, sfx, hook };
}

describe('useContentFilter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a resolved summary (effect breakdown) at info on load', () => {
    setup();
    const call = mockLogger.info.mock.calls.find((c) => c[0] === 'content-filter.resolved');
    expect(call, 'content-filter.resolved emitted').toBeTruthy();
    expect(call[1].effects.mute).toBeGreaterThan(0);
    expect(call[1].effects['censor-bar']).toBeGreaterThan(0);
  });

  it('logs a rate-limited apply event (info-visible) when a cue activates', () => {
    const { el } = setup();
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    const call = mockLogger.sampled.mock.calls.find((c) => c[0] === 'content-filter.applied');
    expect(call, 'content-filter.applied emitted').toBeTruthy();
    expect(call[1].effect).toBe('mute');
  });

  it('logs a session summary at unmount', () => {
    const { el, hook } = setup();
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    hook.unmount();
    const call = mockLogger.info.mock.calls.find((c) => c[0] === 'content-filter.session');
    expect(call, 'content-filter.session emitted').toBeTruthy();
    expect(call[1].applied).toBeTruthy();
  });

  it('seeks past a skip cue (past its widened end)', () => {
    const { el, transport } = setup();
    act(() => { el.currentTime = 110; el.fire('timeupdate'); });
    const arg = transport.seek.mock.calls[0][0];
    expect(arg).toBeGreaterThan(130);
    expect(arg).toBeLessThan(131);
  });

  it('releases an active mute when the user seeks away before the cue ends', () => {
    const { el } = setup();
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    expect(el.muted).toBe(true);
    act(() => { el.currentTime = 500; el.fire('seeking'); });
    expect(el.muted).toBe(false); // seek releases the mute immediately
  });

  it('re-arms on the seeked event (not just timeupdate)', () => {
    const { el } = setup();
    act(() => { el.currentTime = 21; el.fire('seeked'); });
    expect(el.muted).toBe(true);
  });

  it('mutes during a mute cue and unmutes on exit', () => {
    const { el } = setup();
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    expect(el.muted).toBe(true);
    act(() => { el.currentTime = 23; el.fire('timeupdate'); });
    expect(el.muted).toBe(false);
  });

  it('bleeps: mutes source and plays the SFX during a bleep cue', () => {
    const { el, sfx } = setup();
    act(() => { el.currentTime = 11; el.fire('timeupdate'); });
    expect(el.muted).toBe(true);
    expect(sfx.play).toHaveBeenCalledWith('car-horn');
    act(() => { el.currentTime = 13; el.fire('timeupdate'); });
    expect(sfx.stop).toHaveBeenCalled();
    expect(el.muted).toBe(false);
  });

  it('exposes active overlay cues (censor-bar) with their effect name', () => {
    const { el, hook } = setup();
    act(() => { el.currentTime = 202; el.fire('timeupdate'); });
    const ov = hook.result.current.activeOverlays;
    expect(ov).toHaveLength(1);
    expect(ov[0].effect).toBe('censor-bar');
    expect(ov[0].cue.id).toBe('cen');
    act(() => { el.currentTime = 210; el.fire('timeupdate'); });
    // On exit the overlay stays mounted, hidden, for the fade (removal: next test).
    expect(hook.result.current.activeOverlays).toEqual([expect.objectContaining({ effect: 'censor-bar', visible: false })]);
  });

  it('fades an overlay OUT: lingers visible:false for the fade window, then removes it', () => {
    vi.useFakeTimers();
    try {
      // Stable getMediaEl/transport/sfx so the effect does NOT re-run on each
      // setState (matches the real app's useCallback/useMemo) — otherwise the fade
      // lifecycle would be torn down every render and never linger.
      const el = makeFakeEl();
      const getMediaEl = () => el;
      const transport = { seek: vi.fn() };
      const sfx = { play: vi.fn(), stop: vi.fn() };
      const hook = renderHook(() => useContentFilter({ getMediaEl, transport, sfx, edl, profile, enabled: true }));

      act(() => { el.currentTime = 202; el.fire('timeupdate'); }); // cue active
      expect(hook.result.current.activeOverlays).toEqual([
        expect.objectContaining({ effect: 'censor-bar', visible: true }),
      ]);

      act(() => { el.currentTime = 210; el.fire('timeupdate'); }); // cue exits → fade out
      expect(hook.result.current.activeOverlays).toEqual([
        expect.objectContaining({ effect: 'censor-bar', visible: false }),
      ]);

      act(() => { vi.advanceTimersByTime(300); }); // fade window elapses → unmount
      expect(hook.result.current.activeOverlays).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending fade-out if the cue re-activates within the window', () => {
    vi.useFakeTimers();
    try {
      const el = makeFakeEl();
      const getMediaEl = () => el;
      const transport = { seek: vi.fn() };
      const sfx = { play: vi.fn(), stop: vi.fn() };
      const hook = renderHook(() => useContentFilter({ getMediaEl, transport, sfx, edl, profile, enabled: true }));

      act(() => { el.currentTime = 202; el.fire('timeupdate'); });      // active
      act(() => { el.currentTime = 210; el.fire('timeupdate'); });      // fading out
      act(() => { el.currentTime = 203; el.fire('timeupdate'); });      // back in-cue
      expect(hook.result.current.activeOverlays).toEqual([
        expect.objectContaining({ effect: 'censor-bar', visible: true }),
      ]);
      // The earlier removal timer must NOT fire now that it's visible again.
      act(() => { vi.advanceTimersByTime(300); });
      expect(hook.result.current.activeOverlays).toEqual([
        expect.objectContaining({ effect: 'censor-bar', visible: true }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not double-render a title-card as both an overlay and activeCard', () => {
    const tcEdl = { cues: [{ id: 'tc', effect: 'title-card', category: 'meta/x', in: 20, out: 24, text: 'Skipped a scene.' }] };
    const { el, hook } = setup({ edl: tcEdl, profile: { categories: {} } });
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    expect(hook.result.current.activeOverlays.some((o) => o.effect === 'title-card')).toBe(true);
    expect(hook.result.current.activeCard).toBeNull(); // rendered via overlay only
  });

  it('skip-card: seeks past, pauses (buffer behind card), shows card, resumes after hold', () => {
    vi.useFakeTimers();
    const scEdl = { cues: [{ id: 'sc', effect: 'skip-card', category: 'x', in: 10, out: 40, text: 'Skipped a scene.', holdSec: 2.5 }] };
    const el = makeFakeEl();
    const transport = { seek: vi.fn((s) => { el.currentTime = s; }) };
    const hook = renderHook(() => useContentFilter({ getMediaEl: () => el, transport, edl: scEdl, profile: { categories: {} }, enabled: true }));
    act(() => { el.currentTime = 11; el.fire('timeupdate'); });
    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(40.05, 2)); // jump to resume point
    expect(el.pause).toHaveBeenCalled();                                    // freeze/buffer behind card
    expect(hook.result.current.activeCard.text).toBe('Skipped a scene.');
    expect(isSkipCardPaused()).toBe(true);                                  // loading spinner suppressed
    act(() => { vi.advanceTimersByTime(2600); });                          // hold elapses (real-time)
    expect(el.play).toHaveBeenCalled();                                    // resume instantly
    expect(hook.result.current.activeCard).toBeNull();
    expect(isSkipCardPaused()).toBe(false);                                // spinner re-enabled
    vi.useRealTimers();
  });

  it('does nothing when disabled', () => {
    const { el, transport } = setup({ enabled: false });
    act(() => { el.currentTime = 110; el.fire('timeupdate'); });
    act(() => { el.currentTime = 11; el.fire('timeupdate'); });
    expect(transport.seek).not.toHaveBeenCalled();
    expect(el.muted).toBe(false);
  });

  it('ignores cues whose effect has no registered handler', () => {
    const weird = { cues: [{ id: 'x', category: 'x', in: 10, out: 12, effect: 'no-such-effect' }] };
    const { el, transport, hook } = setup({ edl: weird, profile: { categories: {} } });
    act(() => { el.currentTime = 11; el.fire('timeupdate'); });
    expect(transport.seek).not.toHaveBeenCalled();
    expect(hook.result.current.activeOverlays).toEqual([]);
  });

  it('a bleep cue with no sound starts the tone through the sfx player', () => {
    const sfx = { play: vi.fn(), tone: vi.fn(), stop: vi.fn() };
    const { el } = setup({
      sfx,
      profile: { categories: { language: { effect: 'bleep' } } },
      edl: { cues: [{ id: 'b1', category: 'language/profanity/damn', in: 10, out: 11, precision: 'ms' }] },
    });
    act(() => { el.currentTime = 10.5; el.fire('timeupdate'); });
    expect(sfx.tone).toHaveBeenCalledTimes(1);
    expect(el.muted).toBe(true);
  });

  it('fireCount increments once per cue entry', () => {
    const { el, hook } = setup();
    expect(hook.result.current.fireCount).toBe(0);
    act(() => { el.currentTime = 20.5; el.fire('timeupdate'); });
    act(() => { el.currentTime = 20.7; el.fire('timeupdate'); }); // same cue, no new entry
    expect(hook.result.current.fireCount).toBe(1);
  });

  describe('overlapping word cues (padded windows overlap)', () => {
    // "damn" 10.0–10.3 and "hell" 10.6–10.9 resolve with pads to 9.80–10.45 and
    // 10.40–11.05. The first cue's exit must not release audio the second holds.
    const words = { cues: [
      { id: 'damn', category: 'language/profanity/damn', in: 10.0, out: 10.3, precision: 'ms' },
      { id: 'hell', category: 'language/profanity/hell', in: 10.6, out: 10.9, precision: 'ms' },
    ] };
    const tickAt = (el, t) => act(() => { el.currentTime = t; el.fire('timeupdate'); });

    it('resolves to the overlapping padded windows', () => {
      const { hook } = setup({ edl: words, profile: { categories: { language: { effect: 'mute' } } } });
      const [a, b] = hook.result.current.effectiveCues;
      expect([+a.in.toFixed(2), +a.out.toFixed(2)]).toEqual([9.8, 10.45]);
      expect([+b.in.toFixed(2), +b.out.toFixed(2)]).toEqual([10.4, 11.05]);
    });

    it('mute: stays muted from the first exit until the second cue ends', () => {
      const { el } = setup({ edl: words, profile: { categories: { language: { effect: 'mute' } } } });
      tickAt(el, 10.0);
      tickAt(el, 10.42); // both entered
      tickAt(el, 10.5); // first exits, second still entered
      expect(el.muted).toBe(true);
      tickAt(el, 11.0);
      expect(el.muted).toBe(true);
      tickAt(el, 11.2);
      expect(el.muted).toBe(false);
    });

    it('bleep: the first exit does not stop the tone the second cue relies on', () => {
      const sfx = { play: vi.fn(), tone: vi.fn(), stop: vi.fn() };
      const { el } = setup({ sfx, edl: words, profile: { categories: { language: { effect: 'bleep' } } } });
      tickAt(el, 10.0);
      tickAt(el, 10.42);
      tickAt(el, 10.5);
      tickAt(el, 11.0);
      expect(el.muted).toBe(true);
      expect(sfx.stop).not.toHaveBeenCalled();
      tickAt(el, 11.2);
      expect(el.muted).toBe(false);
      expect(sfx.stop).toHaveBeenCalled();
    });
  });

  it('survives an unstable getMediaEl/transport identity (new arrow every render)', () => {
    const el = makeFakeEl();
    const sfx = { play: vi.fn(), tone: vi.fn(), stop: vi.fn() };
    const hook = renderHook(() => useContentFilter({
      getMediaEl: () => el, transport: { seek: (s) => { el.currentTime = s; } },
      sfx, edl, profile, enabled: true,
    }));
    act(() => { el.currentTime = 20.5; el.fire('timeupdate'); });
    expect(el.muted).toBe(true);
    expect(hook.result.current.fireCount).toBe(1);
    act(() => { el.currentTime = 21; el.fire('timeupdate'); });
    act(() => { el.currentTime = 21.5; el.fire('timeupdate'); });
    expect(el.muted).toBe(true);
    expect(hook.result.current.fireCount).toBe(1);
  });
});
