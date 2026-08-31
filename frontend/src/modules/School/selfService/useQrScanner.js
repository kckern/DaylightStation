import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolLog } from '../schoolLog.js';

export const QR_SCAN_TIMEOUT_MS = 20_000;
export const QR_CAMERA_START_TIMEOUT_MS = 15_000;
export const PORTAL_QR_CONNECT_TIMEOUT_MS = 4_000;
const PORTAL_QR_URL = 'ws://localhost:8771/';
const FRAME_INTERVAL_MS = 125;
const CAMERA_WARMUP_MS = 2_000;
const MAX_FRAME_WIDTH = 640;

const IDLE = Object.freeze({
  phase: 'idle', message: 'Camera off', cameraOn: false, retryLabel: null,
});

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return {
      phase: 'denied', cameraOn: false, retryLabel: 'Try again',
      message: 'Camera permission is blocked. You can use the six-digit code instead.',
    };
  }
  if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
    return {
      phase: 'camera-off', cameraOn: false, retryLabel: 'Try again',
      message: 'The camera is off. Turn it on with the button on top, then try again.',
    };
  }
  return {
    phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
    message: 'The camera is unavailable. You can use the six-digit code instead.',
  };
}

function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const context = new Ctx();
    Promise.resolve(context.resume?.()).catch(() => {});
    return context;
  } catch {
    return null;
  }
}

function closeAudio(context) {
  try { Promise.resolve(context?.close?.()).catch(() => {}); } catch { /* best effort */ }
}

/** The acknowledgement beep: captured, so the paper can come down. */
function beep(context) {
  if (!context) return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 1040;
    const at = context.currentTime;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.08, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscillator.start(at);
    oscillator.stop(at + 0.13);
  } catch { /* visual acknowledgement remains */ }
}

/**
 * Browser-local QR capture for the Portal keypad.
 *
 * The video element is only a frame source. Nothing here sends an image over
 * the wire, stores one, or exposes one to React state; the only value leaving
 * this hook is the decoded opaque school token.
 */
export default function useQrScanner({ onToken, provider = 'browser' } = {}) {
  const [state, setState] = useState(IDLE);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const workerRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const portalSocketRef = useRef(null);
  const lastTokenRef = useRef(null);
  const generationRef = useRef(0);
  const frameIdRef = useRef(0);
  const frameTimerRef = useRef(null);
  const startTimerRef = useRef(null);
  const scanTimerRef = useRef(null);
  const muteTimerRef = useRef(null);
  const capturedRef = useRef(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const clearTimers = useCallback(() => {
    [frameTimerRef, startTimerRef, scanTimerRef, muteTimerRef].forEach((ref) => {
      if (ref.current !== null) window.clearTimeout(ref.current);
      ref.current = null;
    });
  }, []);

  const stopCapture = useCallback(({ keepAudio = false, cancelPortal = false } = {}) => {
    clearTimers();
    const portalSocket = portalSocketRef.current;
    portalSocketRef.current = null;
    if (portalSocket) {
      if (cancelPortal && portalSocket.readyState === 1) {
        try { portalSocket.send(JSON.stringify({ type: 'qr', action: 'cancel' })); } catch { /* closing */ }
      }
      portalSocket.onopen = null;
      portalSocket.onmessage = null;
      portalSocket.onerror = null;
      portalSocket.onclose = null;
      try { portalSocket.close(); } catch { /* already closed */ }
    }
    workerRef.current?.terminate?.();
    workerRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch { /* already stopped */ }
      video.srcObject = null;
    }
    canvasRef.current = null;
    if (!keepAudio) {
      closeAudio(audioRef.current);
      audioRef.current = null;
    }
  }, [clearTimers]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    stopCapture({ cancelPortal: true });
    lastTokenRef.current = null;
    capturedRef.current = false;
    setState(IDLE);
    schoolLog.selfService('qr.cancelled', {});
  }, [stopCapture]);

  const submitToken = useCallback(async (token, generation) => {
    lastTokenRef.current = token;
    setState({ phase: 'read', message: 'Code read…', cameraOn: false, retryLabel: null });
    const verdict = await onTokenRef.current?.(token);
    if (generationRef.current !== generation) return;
    if (verdict?.resolved) return;
    const degraded = verdict?.degraded === true;
    setState({
      phase: degraded ? 'degraded' : 'refused',
      cameraOn: false,
      retryLabel: degraded ? 'Try again' : 'Scan another',
      message: verdict?.sentence
        || (degraded ? 'Computer unavailable. Ask a grown-up.' : 'That QR code did not work. Try another one.'),
    });
  }, []);

  const startBrowser = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    stopCapture();
    capturedRef.current = false;
    lastTokenRef.current = null;
    audioRef.current = primeAudio();
    setState({ phase: 'starting', message: 'Starting camera…', cameraOn: false, retryLabel: null });
    schoolLog.selfService('qr.camera-started', {});

    const fail = (next, detail = null) => {
      if (generationRef.current !== generation) return;
      generationRef.current += 1;
      stopCapture();
      setState(next);
      schoolLog.selfServiceError('qr.camera-failed', {
        phase: next.phase, provider: 'browser', reason: detail,
      });
    };

    startTimerRef.current = window.setTimeout(() => fail({
      phase: 'camera-off', cameraOn: false, retryLabel: 'Try again',
      message: 'The camera did not turn on. Check the button on top, then try again.',
    }, 'start-timeout'), QR_CAMERA_START_TIMEOUT_MS);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const unsupported = new Error('getUserMedia unavailable');
        unsupported.name = 'UnsupportedError';
        throw unsupported;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 }, height: { ideal: 480 },
          frameRate: { ideal: 10, max: 15 },
        },
      });
      if (generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      const video = videoRef.current;
      if (!track || !video) throw new Error('Camera stream has no video track');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await Promise.resolve(video.play()).catch(() => {});

      const cameraWentAway = () => fail({
        phase: 'camera-off', cameraOn: false, retryLabel: 'Try again',
        message: 'The camera turned off. Turn it on with the button on top, then try again.',
      }, 'track-ended');
      track.onended = cameraWentAway;
      track.onmute = () => {
        if (muteTimerRef.current !== null) window.clearTimeout(muteTimerRef.current);
        muteTimerRef.current = window.setTimeout(() => {
          if (track.muted) cameraWentAway();
        }, 1_000);
      };
      track.onunmute = () => {
        if (muteTimerRef.current !== null) window.clearTimeout(muteTimerRef.current);
        muteTimerRef.current = null;
      };

      const warmupStarted = Date.now();
      const waitForFrames = () => new Promise((resolve, reject) => {
        const poll = () => {
          if (generationRef.current !== generation) return reject(new Error('cancelled'));
          if (track.readyState !== 'live') return reject(Object.assign(new Error('camera ended'), { name: 'NotReadableError' }));
          if (video.videoWidth > 2 && video.videoHeight > 2 && !track.muted) return resolve();
          if (Date.now() - warmupStarted >= CAMERA_WARMUP_MS) {
            return reject(Object.assign(new Error('camera produced no usable frames'), { name: 'NotReadableError' }));
          }
          return window.setTimeout(poll, 100);
        };
        poll();
      });
      await waitForFrames();
      if (generationRef.current !== generation) return;

      setState({
        phase: 'scanning', message: 'Camera on',
        cameraOn: true, retryLabel: null,
      });
      schoolLog.selfService('qr.camera-on', {});
      scanTimerRef.current = window.setTimeout(() => {
        if (generationRef.current !== generation) return;
        generationRef.current += 1;
        stopCapture();
        setState({
          phase: 'timeout', cameraOn: false, retryLabel: 'Try again',
          message: 'No QR code found. You can try again or use the six-digit code.',
        });
        schoolLog.selfService('qr.timeout', { timeoutMs: QR_SCAN_TIMEOUT_MS });
      }, QR_SCAN_TIMEOUT_MS);

      const worker = new Worker(new URL('./qrDecode.worker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const canvas = document.createElement('canvas');
      canvasRef.current = canvas;

      let scheduleFrame;
      const capture = (token) => {
        if (capturedRef.current || generationRef.current !== generation) return;
        capturedRef.current = true;
        stopCapture({ keepAudio: true });
        beep(audioRef.current);
        window.setTimeout(() => {
          closeAudio(audioRef.current);
          audioRef.current = null;
        }, 300);
        schoolLog.selfService('qr.captured', {});
        void submitToken(token, generation);
      };
      worker.onmessage = (event) => {
        if (generationRef.current !== generation || capturedRef.current) return;
        if (event.data?.error) {
          fail({
            phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
            message: 'The QR reader stopped working. You can use the six-digit code instead.',
          }, 'decoder');
          return;
        }
        const payload = typeof event.data?.data === 'string' ? event.data.data : '';
        const normalized = payload.trim();
        if (normalized) {
          if (normalized.startsWith('sch:')) {
            // Keep the decoder's complete payload. The registry deliberately
            // tolerates scanner whitespace, and this layer must not invent a
            // second token-normalisation rule before the credential arrives.
            capture(payload);
            return;
          }
          setState({
            phase: 'scanning', cameraOn: true, retryLabel: null,
            message: 'That is not a school QR code. Keep looking…',
          });
        }
        scheduleFrame();
      };
      worker.onerror = () => fail({
        phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
        message: 'The QR reader stopped working. You can use the six-digit code instead.',
      }, 'worker-error');

      const sendFrame = () => {
        if (generationRef.current !== generation || capturedRef.current || !workerRef.current) return;
        try {
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          if (sourceWidth <= 2 || sourceHeight <= 2) { scheduleFrame(); return; }
          const scale = Math.min(1, MAX_FRAME_WIDTH / sourceWidth);
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('2d canvas unavailable');
          context.drawImage(video, 0, 0, width, height);
          const frame = context.getImageData(0, 0, width, height);
          const id = frameIdRef.current + 1;
          frameIdRef.current = id;
          workerRef.current.postMessage({
            id, pixels: frame.data.buffer, width, height,
          }, [frame.data.buffer]);
        } catch {
          fail({
            phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
            message: 'The QR reader is unavailable. You can use the six-digit code instead.',
          }, 'frame');
        }
      };
      scheduleFrame = () => {
        if (generationRef.current !== generation || capturedRef.current) return;
        frameTimerRef.current = window.setTimeout(sendFrame, FRAME_INTERVAL_MS);
      };
      sendFrame();
    } catch (error) {
      if (generationRef.current !== generation || error?.message === 'cancelled') return;
      fail(cameraError(error), error?.name ?? 'error');
    }
  }, [stopCapture, submitToken]);

  const startPortal = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    stopCapture({ cancelPortal: true });
    capturedRef.current = false;
    lastTokenRef.current = null;
    setState({ phase: 'starting', message: 'Starting camera…', cameraOn: false, retryLabel: null });
    schoolLog.selfService('qr.camera-started', { provider: 'portal-keys' });

    const fail = (next, reason) => {
      if (generationRef.current !== generation) return;
      generationRef.current += 1;
      stopCapture();
      setState(next);
      schoolLog.selfServiceError('qr.camera-failed', {
        phase: next.phase, provider: 'portal-keys', reason,
      });
    };

    if (typeof WebSocket === 'undefined') {
      fail({
        phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
        message: 'The QR reader is unavailable. You can use the six-digit code instead.',
      }, 'websocket-unavailable');
      return;
    }

    let started = false;
    let socket;
    try {
      socket = new WebSocket(PORTAL_QR_URL);
      portalSocketRef.current = socket;
    } catch {
      fail({
        phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
        message: 'The QR reader is unavailable. You can use the six-digit code instead.',
      }, 'bridge-connect-threw');
      return;
    }

    startTimerRef.current = window.setTimeout(() => fail({
      phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
      message: 'The QR reader did not respond. You can use the six-digit code instead.',
    }, 'bridge-connect-timeout'), PORTAL_QR_CONNECT_TIMEOUT_MS);

    socket.onmessage = (event) => {
      if (generationRef.current !== generation) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }

      if (message.type === 'ready') {
        if (message.qrScanner !== true) {
          fail({
            phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
            message: 'The QR reader needs an update. You can use the six-digit code instead.',
          }, 'bridge-version');
          return;
        }
        if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
        if (!started) {
          started = true;
          socket.send(JSON.stringify({ type: 'qr', action: 'start' }));
          scanTimerRef.current = window.setTimeout(() => fail({
            phase: 'timeout', cameraOn: false, retryLabel: 'Try again',
            message: 'No QR code found. You can try again or use the six-digit code.',
          }, 'scan-timeout'), QR_SCAN_TIMEOUT_MS + 5_000);
        }
        return;
      }

      if (message.type === 'qr-status') {
        switch (message.status) {
          case 'opened':
            setState({ phase: 'starting', message: 'Starting camera…', cameraOn: false, retryLabel: null });
            break;
          case 'permission-needed':
            setState({
              phase: 'starting', message: 'Allow camera access to scan.',
              cameraOn: false, retryLabel: null,
            });
            break;
          case 'camera-on':
            setState({ phase: 'scanning', message: 'Camera on', cameraOn: true, retryLabel: null });
            schoolLog.selfService('qr.camera-on', { provider: 'portal-keys' });
            break;
          case 'frames-live':
            schoolLog.selfService('qr.frames-live', { provider: 'portal-keys' });
            break;
          case 'foreign':
            setState({
              phase: 'scanning', message: 'That is not a school QR code. Keep looking…',
              cameraOn: true, retryLabel: null,
            });
            break;
          case 'timeout':
            fail({
              phase: 'timeout', cameraOn: false, retryLabel: 'Try again',
              message: 'No QR code found. You can try again or use the six-digit code.',
            }, 'native-timeout');
            break;
          case 'cancelled':
            if (generationRef.current !== generation) return;
            generationRef.current += 1;
            stopCapture();
            setState(IDLE);
            break;
          case 'failed':
            fail(cameraError({
              name: message.reason === 'permission-denied' ? 'NotAllowedError' : 'NotReadableError',
            }), message.reason || 'native-failed');
            break;
          default:
            break;
        }
        return;
      }

      if (message.type !== 'qr-captured' || capturedRef.current) return;
      const token = typeof message.token === 'string' ? message.token : '';
      if (!token.trim().startsWith('sch:')) {
        fail({
          phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
          message: 'The QR reader returned an invalid code. Try again.',
        }, 'invalid-token');
        return;
      }
      capturedRef.current = true;
      stopCapture();
      schoolLog.selfService('qr.captured', { provider: 'portal-keys' });
      void submitToken(token, generation);
    };

    socket.onerror = () => {
      // onclose is the single failure path so one disconnect emits one event.
    };
    socket.onclose = () => {
      if (generationRef.current !== generation || capturedRef.current) return;
      fail({
        phase: 'unavailable', cameraOn: false, retryLabel: 'Try again',
        message: 'The QR reader disconnected. You can use the six-digit code instead.',
      }, started ? 'bridge-disconnected' : 'bridge-connect-failed');
    };
  }, [stopCapture, submitToken]);

  const start = useCallback(() => {
    if (provider === 'portal-keys') {
      startPortal();
      return;
    }
    void startBrowser();
  }, [provider, startBrowser, startPortal]);

  const retry = useCallback(() => {
    if (state.phase === 'degraded' && lastTokenRef.current) {
      const generation = generationRef.current;
      setState({ phase: 'read', message: 'Trying again…', cameraOn: false, retryLabel: null });
      void submitToken(lastTokenRef.current, generation);
      return;
    }
    start();
  }, [start, state.phase, submitToken]);

  useEffect(() => () => {
    generationRef.current += 1;
    stopCapture({ cancelPortal: true });
  }, [stopCapture]);

  return {
    ...state,
    active: state.phase !== 'idle',
    videoRef,
    start,
    retry,
    cancel,
  };
}
