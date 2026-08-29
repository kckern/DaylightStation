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
  const streamRef = useRef(null);
  const loggerRef = useRef(getLogger().child({ component: 'useIndependentMedia' }));

  const acquire = useCallback(async () => {
    const current = ++generation.current;
    streamRef.current?.getTracks().forEach(track => track.stop());
    setResult({ status: 'loading', stream: null, errors: {} });
    const tracks = [];
    const errors = {};
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tracks.push(...audio.getAudioTracks());
    } catch (error) { errors.audio = classify(error); loggerRef.current.warn('media.audio.failed', { reason: errors.audio }); }
    let videoError = null;
    for (const video of VIDEO_TIERS) {
      try {
        const captured = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        tracks.push(...captured.getVideoTracks()); videoError = null; break;
      } catch (error) { videoError = error; }
    }
    if (videoError) { errors.video = classify(videoError); loggerRef.current.warn('media.video.failed', { reason: errors.video }); }
    if (current !== generation.current) { tracks.forEach(track => track.stop()); return; }
    const stream = new MediaStream(tracks);
    streamRef.current = stream;
    setResult({ status: tracks.length ? 'ready' : 'failed', stream, errors });
    loggerRef.current.info('media.acquired', { audio: stream.getAudioTracks().length, video: stream.getVideoTracks().length });
  }, []);

  useEffect(() => {
    const generationRef = generation;
    acquire();
    return () => { generationRef.current++; streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [acquire]);
  return { ...result, retry: acquire };
}
