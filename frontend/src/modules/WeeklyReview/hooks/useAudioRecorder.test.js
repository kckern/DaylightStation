import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from './useAudioRecorder.js';

// Minimal mocks for the WebAudio + MediaRecorder surface.
class FakeMediaRecorder {
  static instances = [];
  state = 'inactive';
  ondataavailable = null;
  onerror = null;
  onstop = null;
  constructor(stream) { this.stream = stream; FakeMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  requestData() {}
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  global.MediaRecorder = FakeMediaRecorder;
  global.crypto = { randomUUID: () => 'test-uuid' };
  // Stub navigator.mediaDevices.getUserMedia to return a fake track-bearing stream.
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => {
      const track = { kind: 'audio', readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }),
  };
  // Stub WebSocket so getBridgeStream rejects fast and falls back.
  global.WebSocket = class { constructor() { setTimeout(() => this.onerror?.(), 0); } close() {} };
  // Stub AudioContext minimally — startLevelMonitor will fail silently and that's OK for this test.
  global.AudioContext = class {
    state = 'running';
    createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData: () => {} }; }
    createMediaStreamSource() { return { connect: () => {} }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('useAudioRecorder', () => {
  it('exposes firstAudibleFrameSeen=false until a level above threshold is observed', async () => {
    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.firstAudibleFrameSeen).toBe(false);
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.firstAudibleFrameSeen).toBe(false);
  });
});
