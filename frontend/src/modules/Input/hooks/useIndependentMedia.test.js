// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIndependentMedia } from './useIndependentMedia.js';

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
}
const mediaError = name => Object.assign(new Error(name), { name });
const captured = kind => new FakeMediaStream([{ kind, stop: vi.fn() }]);

describe('useIndependentMedia', () => {
  beforeEach(() => { globalThis.MediaStream = FakeMediaStream; });

  it('stops the acquired microphone immediately and drops a late camera after exit', async () => {
    let resolveCamera;
    const audio = captured('audio');
    const video = captured('video');
    const camera = new Promise(resolve => { resolveCamera = resolve; });
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValueOnce(audio).mockReturnValueOnce(camera),
    };
    const { result } = renderHook(() => useIndependentMedia());
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
    act(() => result.current.stop());
    expect(audio.getTracks()[0].stop).toHaveBeenCalledOnce();
    await act(async () => resolveCamera(video));
    expect(video.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
  });

  it('keeps video when microphone permission is denied', async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn(async constraints => {
      if (constraints.audio) throw mediaError('NotAllowedError');
      return captured('video');
    }) };
    const { result } = renderHook(() => useIndependentMedia());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.errors.audio).toBe('permission_denied');
    expect(result.current.stream.getVideoTracks()).toHaveLength(1);
  });

  it('keeps audio when every video constraint fails', async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn(async constraints => {
      if (constraints.audio) return captured('audio');
      throw mediaError('OverconstrainedError');
    }) };
    const { result } = renderHook(() => useIndependentMedia());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.errors.video).toBe('constraints_failed');
    expect(result.current.stream.getAudioTracks()).toHaveLength(1);
  });
});
