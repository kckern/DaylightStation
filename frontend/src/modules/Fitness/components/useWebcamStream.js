import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const defaultConstraints = { video: true, audio: false };

const statusValues = {
  idle: 'idle',
  starting: 'starting',
  ready: 'ready',
  error: 'error',
  stopped: 'stopped',
  reconnecting: 'reconnecting',
};

export function useWebcamStream({
  enabled = true,
  videoConstraints = defaultConstraints.video,
  audioConstraints = defaultConstraints.audio,
  onStream,
  onError,
} = {}) {
  const [status, setStatus] = useState(statusValues.idle);
  const [error, setError] = useState(null);
  const [stream, setStream] = useState(null);
  const activeTracksRef = useRef([]);
  const startRequestRef = useRef(null);
  const retryRef = useRef({ attempts: 0, timer: null });

  const stopTracks = useCallback(() => {
    activeTracksRef.current.forEach((t) => {
      try { t.stop(); } catch (_err) { /* ignore */ }
    });
    activeTracksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    if (!enabled) return null;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const err = new Error('media-devices-unavailable');
      setError(err);
      setStatus(statusValues.error);
      onError?.(err);
      return null;
    }
    if (startRequestRef.current) {
      return startRequestRef.current;
    }
    const constraints = { video: videoConstraints, audio: audioConstraints };
    setStatus(statusValues.starting);
    const request = navigator.mediaDevices.getUserMedia(constraints)
      .then((nextStream) => {
        stopTracks();
        activeTracksRef.current = nextStream.getTracks();
        setStream(nextStream);
        setStatus(statusValues.ready);
        setError(null);
        retryRef.current.attempts = 0;
        onStream?.(nextStream);
        startRequestRef.current = null;
        return nextStream;
      })
      .catch((err) => {
        setStatus(statusValues.error);
        setError(err);
        onError?.(err);
        startRequestRef.current = null;
        return null;
      });
    startRequestRef.current = request;
    return request;
  }, [enabled, videoConstraints, audioConstraints, onStream, onError, stopTracks]);

  const stop = useCallback(() => {
    stopTracks();
    setStream(null);
    setStatus(statusValues.stopped);
  }, [stopTracks]);

  // Reconnect on track end/device loss with capped backoff.
  useEffect(() => {
    if (!stream) return undefined;
    const handleEnded = () => {
      stop();
      const { attempts, timer } = retryRef.current;
      if (timer) return;
      const nextAttempts = attempts + 1;
      const delay = Math.min(5000, 500 * Math.pow(2, attempts));
      retryRef.current = { attempts: nextAttempts, timer: setTimeout(() => {
        retryRef.current.timer = null;
        setStatus(statusValues.reconnecting);
        start();
      }, delay) };
    };
    stream.getTracks().forEach((t) => t.addEventListener('ended', handleEnded));
    return () => {
      stream.getTracks().forEach((t) => t.removeEventListener('ended', handleEnded));
      const { timer } = retryRef.current;
      if (timer) {
        clearTimeout(timer);
        retryRef.current.timer = null;
      }
    };
  }, [stream, start, stop]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return undefined;
    }
    start();
    return () => {
      stop();
    };
  }, [enabled, start, stop]);

  const value = useMemo(() => ({ status, stream, error, start, stop }), [status, stream, error, start, stop]);

  return value;
}
