import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useVoiceCapture from './useVoiceCapture.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function microphone() {
  const requests = [];
  const started = vi.fn();
  const stopped = vi.fn();
  const stream = { getTracks: () => [{ stop: stopped }] };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => requests.push(resolve)) } });
  class Recorder {
    state = 'inactive';
    start() { this.state = 'recording'; started(); }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  return { requests, started, stopped, stream };
}

describe('voice capture activity lifetime', () => {
  it('releases permission granted after its activity unmounts without starting a recorder', async () => {
    const mic = microphone();
    const { result, unmount } = renderHook(() => useVoiceCapture());
    let pending;
    act(() => { pending = result.current.start(); });
    unmount();
    await act(async () => { mic.requests[0](mic.stream); await pending; });
    expect(mic.stopped).toHaveBeenCalledTimes(1);
    expect(mic.started).not.toHaveBeenCalled();
  });

  it('cancels pending permission without invalidating a subsequent recording', async () => {
    const mic = microphone();
    const { result } = renderHook(() => useVoiceCapture());
    let abandoned;
    act(() => { abandoned = result.current.start(); result.current.cancel(); });
    await act(async () => { mic.requests[0](mic.stream); await abandoned; });
    expect(mic.started).not.toHaveBeenCalled();
    let current;
    act(() => { current = result.current.start(); });
    await act(async () => { mic.requests[1](mic.stream); expect(await current).toBe(true); });
    expect(mic.started).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBe(mic.stream);
  });
});
