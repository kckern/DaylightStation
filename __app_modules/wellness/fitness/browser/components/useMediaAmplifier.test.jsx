import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A MediaElementAudioSourceNode's output ALREADY carries element.volume and
// element.muted (measured in Firefox and Chromium, see
// ops:docs/_wip/bugs/2026-10-23-fitness-audio-ducking-goes-to-zero.md). So the
// amplifier's GainNode must be the boost alone; multiplying by element.volume
// again squares every level and every duck.

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
const gainOf = () => contexts.at(-1).gainNode.gain.value;
// What a listener hears: the source applies element.volume/muted, then the gain.
const audible = (el) => (el.muted ? 0 : el.volume) * gainOf();

describe('useMediaAmplifier — gain is boost only (volume applied once)', () => {
  beforeEach(() => {
    contexts = [];
    boostStored = 1;
    debug.mockClear();
    window.AudioContext = FakeContext;
  });
  afterEach(() => { delete window.AudioContext; });

  it('sets gain to boost regardless of element.volume', () => {
    const el = makeElement(0.4);
    renderHook(() => useMediaAmplifier(el));
    expect(gainOf()).toBeCloseTo(1, 6);
    act(() => { el.volume = 0.08; });
    expect(gainOf()).toBeCloseTo(1, 6);
    act(() => { el.volume = 1; });
    expect(gainOf()).toBeCloseTo(1, 6);
  });

  it('a 0.15 duck yields 0.15x the effective level, not 0.0225x', () => {
    const el = makeElement(0.4);
    renderHook(() => useMediaAmplifier(el));
    const unducked = audible(el);
    expect(unducked).toBeCloseTo(0.4, 6);
    // The volume system ducks by writing element.volume = level * duck_to.
    act(() => { el.volume = 0.4 * 0.15; });
    expect(audible(el) / unducked).toBeCloseTo(0.15, 6);
  });

  it('applies a stored boost as the gain, independent of volume', () => {
    boostStored = 3;
    const el = makeElement(0.5);
    renderHook(() => useMediaAmplifier(el));
    expect(gainOf()).toBeCloseTo(3, 6);
    act(() => { el.volume = 0.1; });
    expect(gainOf()).toBeCloseTo(3, 6);
    expect(audible(el)).toBeCloseTo(0.3, 6);
  });

  it('a boost change updates the gain to the new boost', () => {
    const el = makeElement(0.5);
    const { result } = renderHook(() => useMediaAmplifier(el));
    act(() => result.current.setBoost(2));
    expect(gainOf()).toBeCloseTo(2, 6);
    expect(store.setVolume).toHaveBeenCalledWith(expect.anything(), { boost: 2 });
    act(() => { el.volume = 0.25; });
    expect(gainOf()).toBeCloseTo(2, 6);
  });

  it('mute silences through the gain as well (harmless double for mute)', () => {
    const el = makeElement(0.5);
    renderHook(() => useMediaAmplifier(el));
    // Browsers fire volumechange on a muted toggle; the test DOM does not, so
    // dispatch it the way the browser would.
    const toggle = (m) => { el.muted = m; el.dispatchEvent(new Event('volumechange')); };
    act(() => toggle(true));
    expect(gainOf()).toBe(0);
    act(() => toggle(false));
    expect(gainOf()).toBeCloseTo(1, 6);
  });

  it('logs the effective gain at debug level when it changes', () => {
    const el = makeElement(0.5);
    const { result } = renderHook(() => useMediaAmplifier(el));
    act(() => result.current.setBoost(2));
    expect(debug).toHaveBeenCalledWith('media_amplifier.gain', expect.objectContaining({ gain: 2, boost: 2 }));
  });

  it('tears the graph down on unmount', () => {
    const el = makeElement(0.5);
    const { unmount } = renderHook(() => useMediaAmplifier(el));
    const ctx = contexts.at(-1);
    unmount();
    expect(ctx.source.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });
});
