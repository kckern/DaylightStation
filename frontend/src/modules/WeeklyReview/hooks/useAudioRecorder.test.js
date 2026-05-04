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

  it('sets firstAudibleFrameSeen=true when audible audio is observed by the level monitor', async () => {
    // Override AudioContext mock so getByteTimeDomainData populates the array
    // with values that yield normalized > 0.02 (the audible threshold).
    // 200/128 centered = 0.5625 → rms ≈ 0.5625 → db ≈ -5 → normalized ≈ 0.92.
    global.AudioContext = class {
      state = 'running';
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          getByteTimeDomainData: (arr) => {
            for (let i = 0; i < arr.length; i++) arr[i] = 200;
          },
        };
      }
      createMediaStreamSource() { return { connect: () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    };

    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.firstAudibleFrameSeen).toBe(false);

    await act(async () => { await result.current.startRecording(); });

    // Allow at least one RAF tick (mocked as setTimeout(16)) to drive the level monitor.
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(result.current.firstAudibleFrameSeen).toBe(true);
  });

  it('exposes disconnected=true when audio track ends', async () => {
    const trackHandlers = {};
    global.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      const track = {
        kind: 'audio', readyState: 'live', stop: vi.fn(),
        addEventListener: (ev, fn) => { trackHandlers[ev] = fn; },
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    });
    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.disconnected).toBe(false);
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.disconnected).toBe(false);
    await act(async () => { trackHandlers.ended?.(); });
    expect(result.current.disconnected).toBe(true);
  });

  it('reconnect resolves to true on success and clears disconnected', async () => {
    const trackHandlers = {};
    global.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      const track = {
        kind: 'audio', readyState: 'live', stop: vi.fn(),
        addEventListener: (ev, fn) => { trackHandlers[ev] = fn; },
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    });
    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    await act(async () => { await result.current.startRecording(); });
    await act(async () => { trackHandlers.ended?.(); });
    expect(result.current.disconnected).toBe(true);
    let ok;
    await act(async () => { ok = await result.current.reconnect(); });
    expect(ok).toBe(true);
    expect(result.current.disconnected).toBe(false);
  });

  it('exposes micLevelRef whose .current updates without React re-render', async () => {
    global.AudioContext = class {
      state = 'running';
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          getByteTimeDomainData: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 200; },
        };
      }
      createMediaStreamSource() { return { connect: () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    };

    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.micLevelRef).toBeDefined();
    expect(result.current.micLevelRef.current).toBe(0);

    await act(async () => { await result.current.startRecording(); });
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    expect(result.current.micLevelRef.current).toBeGreaterThan(0);
  });
});
