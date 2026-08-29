// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebcamStream } from './useWebcamStream.js';

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
}
const capture = kind => new FakeMediaStream([{ kind, stop: vi.fn(), getSettings: () => ({ width: 1280 }) }]);

describe('useWebcamStream independent TV fallback', () => {
  beforeEach(() => { globalThis.MediaStream = FakeMediaStream; });

  it('retains both independently usable kinds after combined capture fails', async () => {
    navigator.mediaDevices = { getUserMedia: vi.fn(async constraints => {
      if (constraints.audio && constraints.video) throw new DOMException('combined busy', 'NotReadableError');
      if (constraints.audio && constraints.video === false) return capture('audio');
      if (constraints.video && constraints.audio === false) return capture('video');
      throw new Error('unexpected constraints');
    }) };
    const { result } = renderHook(() => useWebcamStream('camera-id', 'microphone-id'));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.stream.getAudioTracks()).toHaveLength(1);
    expect(result.current.stream.getVideoTracks()).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });
});
