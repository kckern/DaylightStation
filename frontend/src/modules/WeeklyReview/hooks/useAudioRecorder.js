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

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
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

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          setMicLevel(normalized);

          if (normalized < 0.02) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current > SILENCE_WARNING_MS) {
              setSilenceWarning(true);
            }
          } else {
            silenceStartRef.current = null;
            setSilenceWarning(false);
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
    try {
      setError(null);
      setSilenceWarning(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        cleanup();
        setIsRecording(false);
        setMicLevel(0);
        setSilenceWarning(false);

        logger.info('recorder.stopped', { duration: elapsed, blobSize: blob.size });

        if (blob.size > 0 && onRecordingComplete) {
          const base64 = await blobToBase64(blob);
          onRecordingComplete({ audioBase64: base64, mimeType: 'audio/webm', duration: elapsed });
        }
      };

      startLevelMonitor(stream);
      startTimeRef.current = Date.now();
      setDuration(0);
      recorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      logger.info('recorder.started');
    } catch (err) {
      logger.error('recorder.start-failed', { error: err.message });
      setError(`Microphone error: ${err.message}`);
      cleanup();
    }
  }, [cleanup, startLevelMonitor, onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { isRecording, duration, micLevel, silenceWarning, error, startRecording, stopRecording };
}
