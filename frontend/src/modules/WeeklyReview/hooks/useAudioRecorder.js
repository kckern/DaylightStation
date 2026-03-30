import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const logger = getLogger().child({ component: 'weekly-review-recorder' });

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const LEVEL_SAMPLE_INTERVAL_MS = 50;
const SILENCE_WARNING_MS = 5000;

export function useAudioRecorder({ onRecordingComplete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRafRef = useRef(null);
  const lastLevelAtRef = useRef(0);
  const silenceStartRef = useRef(null);
  const peakLevelRef = useRef(0);
  const chunkCountRef = useRef(0);

  const cleanup = useCallback(() => {
    logger.debug('recorder.cleanup');
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      const trackCount = streamRef.current.getTracks().length;
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      logger.debug('recorder.tracks-stopped', { trackCount });
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    peakLevelRef.current = 0;
    chunkCountRef.current = 0;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startLevelMonitor = useCallback((stream) => {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      logger.info('recorder.level-monitor-started', { sampleRate: audioContext.sampleRate, fftSize: analyser.fftSize });

      const sample = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const centered = (dataArray[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

        // Track peak level
        if (normalized > peakLevelRef.current) {
          peakLevelRef.current = normalized;
        }

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          setMicLevel(normalized);

          if (normalized < 0.02) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            const silenceDuration = now - silenceStartRef.current;
            if (silenceDuration > SILENCE_WARNING_MS) {
              setSilenceWarning(prev => {
                if (!prev) {
                  logger.warn('recorder.silence-warning', { silenceDurationMs: Math.round(silenceDuration) });
                }
                return true;
              });
            }
          } else {
            if (silenceStartRef.current) {
              const silenceDuration = now - silenceStartRef.current;
              setSilenceWarning(prev => {
                if (prev) {
                  logger.info('recorder.silence-cleared', { silenceDurationMs: Math.round(silenceDuration) });
                }
                return false;
              });
            }
            silenceStartRef.current = null;
          }
        }
        levelRafRef.current = requestAnimationFrame(sample);
      };
      levelRafRef.current = requestAnimationFrame(sample);
    } catch (err) {
      logger.warn('recorder.level-monitor-failed', { error: err.message });
    }
  }, []);

  const startRecording = useCallback(async () => {
    logger.info('recorder.start-requested');
    try {
      setError(null);
      setSilenceWarning(false);

      logger.debug('recorder.requesting-mic');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const tracks = stream.getAudioTracks();
      const trackInfo = tracks.map(t => ({
        label: t.label,
        id: t.id.slice(0, 8),
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      }));
      logger.info('recorder.mic-acquired', { trackCount: tracks.length, tracks: trackInfo });

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      chunkCountRef.current = 0;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          chunkCountRef.current++;
        }
      };

      recorder.onerror = (e) => {
        logger.error('recorder.media-recorder-error', { error: e.error?.message || 'unknown' });
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        const blobSizeKb = Math.round(blob.size / 1024);
        const peakLevel = peakLevelRef.current;

        logger.info('recorder.stopped', {
          duration: elapsed,
          blobSize: blob.size,
          blobSizeKb,
          chunkCount: chunkCountRef.current,
          peakLevel: Math.round(peakLevel * 100) / 100,
        });

        cleanup();
        setIsRecording(false);
        setMicLevel(0);
        setSilenceWarning(false);

        if (blob.size > 0 && onRecordingComplete) {
          logger.info('recorder.converting-to-base64', { blobSizeKb });
          const base64 = await blobToBase64(blob);
          logger.info('recorder.base64-ready', { base64LengthKb: Math.round(base64.length / 1024) });
          onRecordingComplete({ audioBase64: base64, mimeType: 'audio/webm', duration: elapsed });
        } else if (blob.size === 0) {
          logger.warn('recorder.empty-blob', { duration: elapsed, chunkCount: chunkCountRef.current });
        }
      };

      startLevelMonitor(stream);
      startTimeRef.current = Date.now();
      setDuration(0);
      recorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        const seconds = Math.round((Date.now() - startTimeRef.current) / 1000);
        setDuration(seconds);
        if (seconds > 0 && seconds % 30 === 0) {
          logger.debug('recorder.heartbeat', {
            seconds,
            chunkCount: chunkCountRef.current,
            peakLevel: Math.round(peakLevelRef.current * 100) / 100,
          });
        }
      }, 1000);

      logger.info('recorder.started', { mimeType: 'audio/webm' });
    } catch (err) {
      logger.error('recorder.start-failed', {
        error: err.message,
        name: err.name,
        constraint: err.constraint,
      });
      setError(`Microphone error: ${err.message}`);
      cleanup();
    }
  }, [cleanup, startLevelMonitor, onRecordingComplete]);

  const stopRecording = useCallback(() => {
    const state = mediaRecorderRef.current?.state;
    logger.info('recorder.stop-requested', { recorderState: state });
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      logger.warn('recorder.stop-ignored', { recorderState: state || 'null' });
    }
  }, []);

  return { isRecording, duration, micLevel, silenceWarning, error, startRecording, stopRecording };
}
