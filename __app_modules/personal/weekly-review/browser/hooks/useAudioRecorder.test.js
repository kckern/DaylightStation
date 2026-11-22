import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from "./useAudioRecorder.js";

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
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });
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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useAudioRecorder', () => {
  it('records the Shield bridge stream and forwards native PCM to the audio worklet', async () => {
    let socket;
    const stream = { getTracks: () => [], getAudioTracks: () => [] };
    const postMessage = vi.fn();
    vi.stubGlobal('WebSocket', class {
      constructor(url) { this.url = url; socket = this; }
      close() {}
    });
    vi.stubGlobal('AudioContext', class extends global.AudioContext {
      audioWorklet = { addModule: vi.fn() };
      createMediaStreamDestination() { return { stream }; }
    });
    vi.stubGlobal('AudioWorkletNode', class {
      port = { postMessage };
      connect() {}
      disconnect() {}
    });
    const hook = renderHook(() => useAudioRecorder({ onChunk: vi.fn() }));
    try {
      await act(async () => {
        const starting = hook.result.current.startRecording();
        expect(socket.url).toBe('ws://localhost:8765');
        await socket.onmessage({ data: '{"sampleRate":48000,"channels":1,"format":"pcm_s16le"}' });
        await starting;
      });
      const pcm = Int16Array.of(-320, 0, 320).buffer;
      socket.onmessage({ data: pcm });
      expect(postMessage).toHaveBeenCalledWith(pcm, [pcm]);
      expect(FakeMediaRecorder.instances[0].stream).toBe(stream);
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
      vi.unstubAllGlobals();
    }
  });

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

  it('numbers the final chunk after unmount in sequence, not as 0', async () => {
    // MediaRecorder delivers its last dataavailable after stop, which happens
    // as the review closes. A seq reset in cleanup sent that chunk as 0 and the
    // server refused it (409 out-of-order), losing the end of the narration.
    const onChunk = vi.fn();
    const hook = renderHook(() => useAudioRecorder({ onChunk }));
    await act(async () => { await hook.result.current.startRecording(); });
    const recorder = FakeMediaRecorder.instances[0];
    const blob = { size: 10 };
    recorder.ondataavailable({ data: blob });
    recorder.ondataavailable({ data: blob });
    hook.unmount();
    recorder.ondataavailable({ data: blob });
    expect(onChunk.mock.calls.map(([c]) => c.seq)).toEqual([0, 1, 2]);
  });

  it('starts a new recording at seq 0', async () => {
    const onChunk = vi.fn();
    const { result } = renderHook(() => useAudioRecorder({ onChunk }));
    await act(async () => { await result.current.startRecording(); });
    FakeMediaRecorder.instances[0].ondataavailable({ data: { size: 10 } });
    await act(async () => { result.current.stopRecording(); });
    await act(async () => { await result.current.startRecording(); });
    FakeMediaRecorder.instances[1].ondataavailable({ data: { size: 10 } });
    expect(onChunk.mock.calls.map(([c]) => c.seq)).toEqual([0, 0]);
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

  it('rebuilds the level monitor after reconnect so firstAudibleFrameSeen can still flip', async () => {
    // Audible AudioContext: getByteTimeDomainData yields a level above threshold.
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
    // Audio confirmed once during the original session.
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(result.current.firstAudibleFrameSeen).toBe(true);

    // Simulate a drop + reconnect, then prove the monitor is live again by
    // observing the mic level update on the NEW stream (regression guard: the
    // reconnect path must re-attach the analyser, not just the MediaRecorder).
    await act(async () => { trackHandlers.ended?.(); });
    let ok;
    await act(async () => { ok = await result.current.reconnect(); });
    expect(ok).toBe(true);
    result.current.micLevelRef.current = 0; // reset, then let the rebuilt loop run
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(result.current.micLevelRef.current).toBeGreaterThan(0);
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
