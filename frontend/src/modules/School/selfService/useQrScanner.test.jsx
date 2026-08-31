import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useQrScanner, { QR_SCAN_TIMEOUT_MS } from './useQrScanner.js';

vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

const TOKEN = 'sch:ABCDEFGHJKLMNPQR';

let decoded;
let workers;
let oscillatorStart;
let canvasContext;

class FakeWorker {
  constructor() {
    this.terminate = vi.fn();
    this.postMessage = vi.fn(() => {
      if (decoded !== undefined) this.onmessage?.({ data: { id: 1, data: decoded } });
    });
    workers.push(this);
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.close = vi.fn(async () => {});
    this.resume = vi.fn(async () => {});
  }

  createOscillator() {
    return {
      connect: vi.fn(),
      frequency: { value: 0 },
      start: oscillatorStart,
      stop: vi.fn(),
      type: '',
    };
  }

  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };
  }
}

function camera({ muted = false, width = 640, height = 480 } = {}) {
  const track = {
    muted,
    readyState: 'live',
    stop: vi.fn(function stop() { this.readyState = 'ended'; }),
    onended: null,
    onmute: null,
    onunmute: null,
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  const video = {
    videoWidth: width,
    videoHeight: height,
    srcObject: null,
    muted: false,
    playsInline: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  };
  return { track, stream, video };
}

function mountScanner(onToken, setup = camera()) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => setup.stream) },
  });
  const hook = renderHook(() => useQrScanner({ onToken }));
  hook.result.current.videoRef.current = setup.video;
  return { ...hook, ...setup };
}

describe('useQrScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    decoded = undefined;
    workers = [];
    oscillatorStart = vi.fn();
    canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16) })),
    };
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    window.AudioContext = FakeAudioContext;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete navigator.mediaDevices;
  });

  it('stops the camera and beeps as soon as a school QR is captured, before resolving it', async () => {
    const rawPayload = ` ${TOKEN}\r\n`;
    decoded = rawPayload;
    let stoppedAtResolve = false;
    const setup = camera();
    const onToken = vi.fn(async (_token) => {
      stoppedAtResolve = setup.track.stop.mock.calls.length === 1;
      return { resolved: false, degraded: false, sentence: 'Try another QR.' };
    });
    const { result, track, video } = mountScanner(onToken, setup);

    await act(async () => {
      await result.current.start();
      await Promise.resolve();
    });

    expect(onToken).toHaveBeenCalledWith(rawPayload);
    expect(stoppedAtResolve).toBe(true);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.pause).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(oscillatorStart).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ phase: 'refused', cameraOn: false, retryLabel: 'Scan another' });
  });

  it('does not beep or submit a non-school QR and keeps scanning', async () => {
    decoded = 'https://example.com/not-school';
    const onToken = vi.fn();
    const { result, track } = mountScanner(onToken);

    await act(async () => { await result.current.start(); });

    expect(onToken).not.toHaveBeenCalled();
    expect(oscillatorStart).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('scanning');
    expect(result.current.message).toMatch(/not a school QR/i);
  });

  it('recognises the Portal privacy-off 2×2 muted stream as camera off', async () => {
    const setup = camera({ muted: true, width: 2, height: 2 });
    const { result, track } = mountScanner(vi.fn(), setup);

    let starting;
    await act(async () => {
      starting = result.current.start();
      await vi.advanceTimersByTimeAsync(2_100);
      await starting;
    });

    expect(track.stop).toHaveBeenCalled();
    expect(result.current.phase).toBe('camera-off');
    expect(result.current.message).toMatch(/camera is off/i);
  });

  it('stops scanning after the 20-second active window', async () => {
    const { result, track } = mountScanner(vi.fn());
    await act(async () => { await result.current.start(); });
    expect(result.current).toMatchObject({ phase: 'scanning', cameraOn: true, message: 'Camera on' });

    await act(async () => { await vi.advanceTimersByTimeAsync(QR_SCAN_TIMEOUT_MS); });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ phase: 'timeout', cameraOn: false, retryLabel: 'Try again' });
  });
});
