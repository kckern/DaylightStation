import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useModelPauses from './useModelPauses.js';

afterEach(() => { delete window.AudioContext; vi.restoreAllMocks(); });

describe('useModelPauses', () => {
  it('is empty without Web Audio — cuts fall back to where the learner pressed', () => {
    delete window.AudioContext;
    const { result } = renderHook(() => useModelPauses('/audio/1/KR', true));
    expect(result.current.current).toEqual([]);
  });

  it('decodes the model and keeps its pauses', async () => {
    const rate = 1000;
    const samples = new Float32Array(2000);
    for (let i = 0; i < 1000; i += 1) samples[i] = i % 2 ? 0.5 : -0.5;
    for (let i = 1200; i < 2000; i += 1) samples[i] = i % 2 ? 0.5 : -0.5;
    window.AudioContext = class {
      decodeAudioData() { return Promise.resolve({ sampleRate: rate, getChannelData: () => samples }); }
      close() { return Promise.resolve(); }
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const { result } = renderHook(() => useModelPauses('/audio/1/KR', true));
    await waitFor(() => expect(result.current.current).toEqual([1100]));
  });

  // The Portal has a V8 memory ceiling, and most sentences are never cut:
  // decoding every model on arrival spent it for nothing.
  it('decodes nothing until enabled, then decodes once', async () => {
    window.AudioContext = class {
      decodeAudioData() { return Promise.resolve({ sampleRate: 1000, getChannelData: () => new Float32Array(10) }); }
      close() { return Promise.resolve(); }
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const { rerender } = renderHook(({ on }) => useModelPauses('/audio/1/KR', on), { initialProps: { on: false } });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ on: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
