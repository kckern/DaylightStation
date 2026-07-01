import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Spy on the structured logger so we can assert observability events.
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock('../logging/singleton.js', () => ({ getChildLogger: () => mockLogger }));

import { useContentFilter } from './useContentFilter.js';

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
  const hook = renderHook(() => useContentFilter({
    getMediaEl: () => el, transport, sfx, edl, profile, enabled: true, ...overrides,
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
    expect(hook.result.current.activeOverlays).toEqual([]);
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
    act(() => { vi.advanceTimersByTime(2600); });                          // hold elapses (real-time)
    expect(el.play).toHaveBeenCalled();                                    // resume instantly
    expect(hook.result.current.activeCard).toBeNull();
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
});
