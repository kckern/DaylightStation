import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A MediaElementAudioSourceNode's output ALREADY carries element.volume and
// element.muted (measured in Firefox and Chromium, see
// ops:docs/_wip/bugs/2026-10-23-fitness-audio-ducking-goes-to-zero.md). The
// gain used to be element.volume x boost, which squared every duck. It is now
// the UN-DUCKED level x boost: normal loudness stays level^2 x boost (as it
// always was), and a duck, which lowers only element.volume, scales the output
// by exactly duck_to.

let boostStored = 1;
const store = {
  getVolume: () => ({ level: 0.4, muted: false, boost: boostStored }),
  setVolume: vi.fn((_ids, patch) => ({ level: 0.4, muted: false, ...patch })),
};
vi.mock('../nav/useVolumeStore.js', () => ({ useVolumeStore: () => store }));

const debug = vi.fn();
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { debug: (...a) => debug(...a), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger };
});

import { useMediaAmplifier } from './useMediaAmplifier.js';

// Fake WebAudio: the source node passes element.volume through (as the browser
// does), the gain node multiplies, and `audible()` is what reaches the speakers.
let contexts = [];
class FakeGain {
  constructor() {
    this.value = 1;
    this.setTargetAtTime = vi.fn((v) => { this.value = v; });
    this.cancelScheduledValues = vi.fn();
  }
}
class FakeContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.close = vi.fn();
    this.resume = vi.fn();
    contexts.push(this);
  }
  createMediaElementSource(el) {
    this.source = { mediaElement: el, connect: vi.fn(), disconnect: vi.fn() };
    return this.source;
  }
  createGain() {
    this.gainNode = { gain: new FakeGain(), connect: vi.fn(), disconnect: vi.fn() };
    return this.gainNode;
  }
}

const makeElement = (volume = 1) => {
  const el = document.createElement('video');
  el.volume = volume;
  return el;
};
// Browsers queue a volumechange task when volume/muted is set; the test DOM
// fires none, so dispatch it the way the browser would.
const setVol = (el, v) => { el.volume = v; el.dispatchEvent(new Event('volumechange')); };
const gainOf = () => contexts.at(-1).gainNode.gain.value;
// What a listener hears: the source applies element.volume/muted, then the gain.
const audible = (el) => (el.muted ? 0 : el.volume) * gainOf();

// The pre-fix formula, for "normal loudness is unchanged" comparisons.
const oldAudible = (volume, boost) => volume * (volume * boost);

describe('useMediaAmplifier — un-ducked level x boost (duck applied once)', () => {
  beforeEach(() => {
    contexts = [];
    boostStored = 1;
    debug.mockClear();
    window.AudioContext = FakeContext;
  });
  afterEach(() => { delete window.AudioContext; });

  it('un-ducked output is unchanged from the old formula (level^2 x boost)', () => {
    for (const [level, boost] of [[0.4, 1], [0.8, 1], [0.3, 2]]) {
      contexts = [];
      boostStored = boost;
      const el = makeElement(level);
      const { unmount } = renderHook(() => useMediaAmplifier(el, { level }));
      expect(gainOf()).toBeCloseTo(level * boost, 6);
      expect(audible(el)).toBeCloseTo(oldAudible(level, boost), 6);
      unmount();
    }
  });

  it('gain does not follow element.volume while the un-ducked level is fixed', () => {
    const el = makeElement(0.4);
    renderHook(() => useMediaAmplifier(el, { level: 0.4 }));
    act(() => setVol(el, 0.08));
    expect(gainOf()).toBeCloseTo(0.4, 6);
    act(() => setVol(el, 0.4));
    expect(gainOf()).toBeCloseTo(0.4, 6);
  });

  it.each([0.1, 0.15, 0.2, 0.3])('a %s duck yields exactly duck_to of the un-ducked output', (duckTo) => {
    const el = makeElement(0.4);
    renderHook(() => useMediaAmplifier(el, { level: 0.4 }));
    const unducked = audible(el);
    expect(unducked).toBeCloseTo(oldAudible(0.4, 1), 6);
    // The volume system ducks by writing element.volume = level * duck_to.
    act(() => setVol(el, 0.4 * duckTo));
    expect(audible(el) / unducked).toBeCloseTo(duckTo, 6);
    act(() => setVol(el, 0.4));
    expect(audible(el)).toBeCloseTo(unducked, 6);
  });

  it('follows a change of the un-ducked level (user volume change)', () => {
    const el = makeElement(0.4);
    const { rerender } = renderHook(({ level }) => useMediaAmplifier(el, { level }), { initialProps: { level: 0.4 } });
    act(() => setVol(el, 0.6));
    rerender({ level: 0.6 });
    expect(gainOf()).toBeCloseTo(0.6, 6);
    expect(audible(el)).toBeCloseTo(oldAudible(0.6, 1), 6);
  });

  it('applies a stored boost: gain = level x boost, duck still linear', () => {
    boostStored = 3;
    const el = makeElement(0.5);
    renderHook(() => useMediaAmplifier(el, { level: 0.5 }));
    expect(gainOf()).toBeCloseTo(1.5, 6);
    const unducked = audible(el);
    act(() => setVol(el, 0.5 * 0.15));
    expect(audible(el) / unducked).toBeCloseTo(0.15, 6);
  });

  it('a boost change updates the gain and persists the boost', () => {
    const el = makeElement(0.5);
    const { result } = renderHook(() => useMediaAmplifier(el, { level: 0.5 }));
    act(() => result.current.setBoost(2));
    expect(gainOf()).toBeCloseTo(1, 6);
    expect(store.setVolume).toHaveBeenCalledWith(expect.anything(), { boost: 2 });
  });

  it('without a level it falls back to element.volume (legacy formula)', () => {
    const el = makeElement(0.4);
    renderHook(() => useMediaAmplifier(el));
    expect(gainOf()).toBeCloseTo(0.4, 6);
  });

  it('mute zeroes the gain (harmless double for mute)', () => {
    const el = makeElement(0.5);
    renderHook(() => useMediaAmplifier(el, { level: 0.5 }));
    // Browsers fire volumechange on a muted toggle; the test DOM does not, so
    // dispatch it the way the browser would.
    const toggle = (m) => { el.muted = m; el.dispatchEvent(new Event('volumechange')); };
    act(() => toggle(true));
    expect(gainOf()).toBe(0);
    act(() => toggle(false));
    expect(gainOf()).toBeCloseTo(0.5, 6);
  });

  it('logs the effective gain at debug level when it changes', () => {
    const el = makeElement(0.5);
    const { result } = renderHook(() => useMediaAmplifier(el, { level: 0.5 }));
    act(() => result.current.setBoost(2));
    expect(debug).toHaveBeenCalledWith('media_amplifier.gain',
      expect.objectContaining({ gain: 1, boost: 2, level: 0.5, levelSource: 'volume-store' }));
  });

  it('tears the graph down on unmount', () => {
    const el = makeElement(0.5);
    const { unmount } = renderHook(() => useMediaAmplifier(el, { level: 0.5 }));
    const ctx = contexts.at(-1);
    unmount();
    expect(ctx.source.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });
});
