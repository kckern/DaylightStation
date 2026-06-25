/**
 * useMediaRecorderCapture — neutral one-shot mic→Blob recorder.
 * MediaRecorder + getUserMedia are mocked (jsdom has neither).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaRecorderCapture } from './useMediaRecorderCapture.js';

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) { this.stream = stream; this.mimeType = opts?.mimeType || 'audio/webm'; this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; this.onerror = null; }
  start() { this.state = 'recording'; }
  requestData() { this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] };

beforeEach(() => {
  global.MediaRecorder = FakeMediaRecorder;
  global.AudioContext = class { createAnalyser() { return { fftSize: 0, frequencyBinCount: 8, getByteTimeDomainData: () => {} }; } createMediaStreamSource() { return { connect() {} }; } close() { return Promise.resolve(); } };
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
});

describe('useMediaRecorderCapture', () => {
  it('starts recording then stops and resolves a blob with duration', async () => {
    const { result } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(true);

    let take;
    await act(async () => { take = await result.current.stop(); });
    expect(take.blob).toBeInstanceOf(Blob);
    expect(typeof take.durationMs).toBe('number');
    expect(result.current.isRecording).toBe(false);
  });

  it('surfaces a permission error and stays not-recording', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toMatch(/permission/i);
  });
});
