import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentFilter } from './useContentFilter.js';

function makeFakeEl() {
  const handlers = {};
  return {
    currentTime: 0,
    muted: false,
    volume: 1,
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
  };
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

  it('seeks past a skip cue', () => {
    const { el, transport } = setup();
    act(() => { el.currentTime = 110; el.fire('timeupdate'); });
    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(130.05, 2));
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
