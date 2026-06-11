import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- realtime-bpm-analyzer mock: capture event handlers, expose a fake node ---
const analyzerHandlers = {};
const fakeAnalyzer = {
  node: { connect: vi.fn(), disconnect: vi.fn() },
  on: vi.fn((event, cb) => { analyzerHandlers[event] = cb; }),
  reset: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn()
};
const createRealtimeBpmAnalyzer = vi.fn().mockResolvedValue(fakeAnalyzer);
vi.mock('realtime-bpm-analyzer', () => ({
  createRealtimeBpmAnalyzer: (...args) => createRealtimeBpmAnalyzer(...args)
}));

import { useDanceBpm, pickBpm, BPM_MIN, BPM_MAX, BPM_HYSTERESIS } from './useDanceBpm.js';

// --- AudioContext mock ---
function makeCtx(initialState = 'running') {
  const sources = [];
  const ctx = {
    state: initialState,
    destination: { kind: 'destination' },
    resume: vi.fn(async () => { ctx.state = 'running'; }),
    close: vi.fn(async () => { ctx.state = 'closed'; }),
    createMediaElementSource: vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
    _sources: sources
  };
  return ctx;
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('pickBpm (pure candidate selection)', () => {
  it('rounds the top candidate tempo', () => {
    expect(pickBpm([{ tempo: 127.6, count: 12 }], null)).toBe(128);
  });

  it('keeps the current bpm on empty/invalid candidates', () => {
    expect(pickBpm([], 120)).toBe(120);
    expect(pickBpm(null, 120)).toBe(120);
    expect(pickBpm([{ tempo: NaN }], 120)).toBe(120);
    expect(pickBpm(null, null)).toBeNull();
  });

  it('rejects out-of-range tempos', () => {
    expect(pickBpm([{ tempo: BPM_MIN - 5 }], 100)).toBe(100);
    expect(pickBpm([{ tempo: BPM_MAX + 40 }], 100)).toBe(100);
    expect(pickBpm([{ tempo: 300 }], null)).toBeNull();
  });

  it('applies hysteresis: small wobble keeps the current bpm', () => {
    expect(pickBpm([{ tempo: 121 }], 120)).toBe(120);
    expect(pickBpm([{ tempo: 120 + BPM_HYSTERESIS }], 120)).toBe(120 + BPM_HYSTERESIS);
  });
});

describe('useDanceBpm', () => {
  let ctx;
  let mediaEl;
  let playerRef;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.keys(analyzerHandlers).forEach((k) => delete analyzerHandlers[k]);
    fakeAnalyzer.node.connect.mockClear();
    fakeAnalyzer.on.mockClear();
    fakeAnalyzer.reset.mockClear();
    fakeAnalyzer.stop.mockClear();
    createRealtimeBpmAnalyzer.mockClear();
    ctx = makeCtx();
    global.AudioContext = vi.fn(function AudioContextMock() { return ctx; });
    mediaEl = document.createElement('audio');
    playerRef = { current: { getMediaElement: () => mediaEl } };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.AudioContext;
  });

  it('attaches the current media element to the analyzer and routes audio to destination', async () => {
    renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    expect(createRealtimeBpmAnalyzer).toHaveBeenCalledWith(ctx, expect.objectContaining({ continuousAnalysis: true }));
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(mediaEl);
    expect(ctx._sources[0].connect).toHaveBeenCalledWith(fakeAnalyzer.node);
    expect(fakeAnalyzer.node.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('bpm events update detectedBpm via pickBpm', async () => {
    const { result } = renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    expect(result.current.detectedBpm).toBeNull();
    act(() => analyzerHandlers.bpm({ bpm: [{ tempo: 127.7, count: 9 }] }));
    expect(result.current.detectedBpm).toBe(128);
    act(() => analyzerHandlers.bpm({ bpm: [{ tempo: 128.9, count: 9 }] })); // within hysteresis
    expect(result.current.detectedBpm).toBe(128);
    act(() => analyzerHandlers.bpm({ bpm: [{ tempo: 95.2, count: 9 }] }));
    expect(result.current.detectedBpm).toBe(95);
  });

  it('re-attaches when the player swaps to a new media element (track change remount)', async () => {
    renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
    const nextEl = document.createElement('audio');
    playerRef.current.getMediaElement = () => nextEl;
    await tick(1100);
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(ctx.createMediaElementSource).toHaveBeenLastCalledWith(nextEl);
    expect(ctx._sources[0].disconnect).toHaveBeenCalled(); // old element source detached
  });

  it('does not create a second source for the same element', async () => {
    renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    await tick(3000);
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it('resets the analyzer when the track key changes', async () => {
    const { rerender } = renderHook(({ trackKey }) => useDanceBpm({ playerRef, trackKey }),
      { initialProps: { trackKey: 'plex:1' } });
    await flush();
    fakeAnalyzer.reset.mockClear();
    rerender({ trackKey: 'plex:2' });
    expect(fakeAnalyzer.reset).toHaveBeenCalled();
  });

  it('never wires the element into a suspended context (no silent party); attaches after resume succeeds', async () => {
    ctx = makeCtx('suspended');
    const stubbornResume = vi.fn(async () => {}); // resume that does NOT reach running
    ctx.resume = stubbornResume;
    global.AudioContext = vi.fn(function AudioContextMock() { return ctx; });
    renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    expect(ctx.createMediaElementSource).not.toHaveBeenCalled();
    expect(stubbornResume).toHaveBeenCalled();
    // context finally resumes on a later poll
    ctx.resume = vi.fn(async () => { ctx.state = 'running'; });
    await tick(2100);
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(mediaEl);
  });

  it('closes the audio context and stops the analyzer on unmount', async () => {
    const { unmount } = renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    unmount();
    expect(fakeAnalyzer.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('reports nothing and stays inert when Web Audio is unavailable', async () => {
    delete global.AudioContext;
    const { result } = renderHook(() => useDanceBpm({ playerRef }));
    await flush();
    await tick(2000);
    expect(result.current.detectedBpm).toBeNull();
    expect(createRealtimeBpmAnalyzer).not.toHaveBeenCalled();
  });
});
