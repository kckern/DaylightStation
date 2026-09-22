import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useModelPauses from './useModelPauses.js';

afterEach(() => { delete window.AudioContext; vi.restoreAllMocks(); });

describe('useModelPauses', () => {
  it('is empty without Web Audio — cuts fall back to where the learner pressed', () => {
    delete window.AudioContext;
    const { result } = renderHook(() => useModelPauses('/audio/1/KR'));
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
    const { result } = renderHook(() => useModelPauses('/audio/1/KR'));
    await waitFor(() => expect(result.current.current).toEqual([1100]));
  });
});
