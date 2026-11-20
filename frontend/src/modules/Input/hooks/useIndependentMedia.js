import { useCallback, useEffect, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

const VIDEO_TIERS = [
  { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } },
  { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } },
  true,
];

const classify = error => {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'permission_denied';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'hardware_missing';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'device_busy';
  if (error?.name === 'OverconstrainedError' || error?.name === 'ConstraintNotSatisfiedError') return 'constraints_failed';
  return 'capture_failed';
};

export function useIndependentMedia() {
  const [result, setResult] = useState({ status: 'loading', stream: null, errors: {} });
  const generation = useRef(0);
  const tracksRef = useRef([]);
  const loggerRef = useRef(getLogger().child({ component: 'useIndependentMedia' }));

  const release = useCallback(() => {
    generation.current++;
    tracksRef.current.forEach(track => track.stop());
    tracksRef.current = [];
  }, []);

  const stop = useCallback(() => {
    release();
    setResult({ status: 'idle', stream: null, errors: {} });
  }, [release]);

  const acquire = useCallback(async () => {
    release();
    const current = generation.current;
    setResult({ status: 'loading', stream: null, errors: {} });
    const tracks = tracksRef.current;
    const errors = {};
    function keep(captured) {
      if (current === generation.current) tracks.push(...captured.getTracks());
      else captured.getTracks().forEach(track => track.stop());
    }

    try {
      keep(await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
    } catch (error) { errors.audio = classify(error); loggerRef.current.warn('media.audio.failed', { reason: errors.audio }); }
    if (current !== generation.current) return;

    let videoError = null;
    for (const video of VIDEO_TIERS) {
      try {
        keep(await navigator.mediaDevices.getUserMedia({ audio: false, video }));
        videoError = null;
        break;
      } catch (error) {
        videoError = error;
        if (current !== generation.current || classify(error) !== 'constraints_failed') break;
      }
    }
    if (current !== generation.current) return;
    if (videoError) { errors.video = classify(videoError); loggerRef.current.warn('media.video.failed', { reason: errors.video }); }
    const stream = new MediaStream(tracks);
    setResult({ status: tracks.length ? 'ready' : 'failed', stream, errors });
    loggerRef.current.info('media.acquired', { audio: stream.getAudioTracks().length, video: stream.getVideoTracks().length });
  }, [release]);

  useEffect(() => {
    void acquire();
    return release;
  }, [acquire, release]);
  return { ...result, retry: acquire, stop };
}
