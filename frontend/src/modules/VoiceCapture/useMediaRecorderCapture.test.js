/**
 * useMediaRecorderCapture — neutral one-shot mic→Blob recorder.
 * MediaRecorder + getUserMedia are mocked (jsdom has neither).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

afterEach(() => vi.restoreAllMocks());

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

  it('retries an unavailable built-in mic with the same processing policy and keeps the negotiated bytes', async () => {
    const { enumerateDevices, getUserMedia } = navigator.mediaDevices;
    enumerateDevices.mockResolvedValue([
      { kind: 'audioinput', label: 'Bluetooth headset', deviceId: 'bluetooth' },
      { kind: 'audioinput', label: 'Internal mic', deviceId: 'internal' },
    ]);
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('disconnected'), { name: 'NotFoundError' }));
    vi.spyOn(FakeMediaRecorder, 'isTypeSupported').mockImplementation(type => type === 'audio/mp4');
    const { result } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    const processing = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    expect(getUserMedia.mock.calls).toEqual([
      [{ audio: { ...processing, deviceId: { exact: 'internal' } } }], [{ audio: processing }],
    ]);
    let take;
    await act(async () => { take = await result.current.stop(); });
    expect(take).toMatchObject({ mimeType: 'audio/mp4', blob: { type: 'audio/mp4', size: 1 } });
  });

  it('foregoes the fallback when the owner leaves during the first permission request', async () => {
    const pending = Promise.withResolvers();
    const { getUserMedia } = navigator.mediaDevices;
    getUserMedia.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useMediaRecorderCapture());
    let start;
    act(() => { start = result.current.start(); });
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    unmount();
    pending.reject(Object.assign(new Error('disconnected'), { name: 'NotFoundError' }));
    await start;
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('discards a take when the owner leaves before a requested recorder stop finishes', async () => {
    let requestedStop;
    vi.spyOn(FakeMediaRecorder.prototype, 'stop').mockImplementationOnce(function () {
      this.state = 'inactive';
      requestedStop = () => this.onstop?.();
    });
    const { result, unmount } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    const take = result.current.stop();
    expect(requestedStop).toBeTypeOf('function');
    unmount();
    requestedStop();
    await expect(take).resolves.toBeNull();
  });
});
