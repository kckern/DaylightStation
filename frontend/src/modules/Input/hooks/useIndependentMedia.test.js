// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
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
