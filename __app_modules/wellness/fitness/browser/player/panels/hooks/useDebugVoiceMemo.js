import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * Minimal debug voice-memo recorder. DEVELOPER-ONLY.
 * Intentionally independent of the workout voice-memo system.
 */
const useDebugVoiceMemo = () => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const maxDurationTimerRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) { /* ignore */ }
      });
      streamRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const handleRecordingStop = useCallback(async () => {
    if (!chunksRef.current.length) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    try {
      setUploading(true);
      const base64 = await blobToBase64(blob);
      const payload = { audioBase64: base64, mimeType: blob.type };
      const resp = await DaylightAPI('api/v1/fitness/debug/voice-memo', payload, 'POST');
      if (!resp?.ok) {
        throw new Error(resp?.error || 'Upload failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setUploading(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = handleRecordingStop;
      recorder.start();
      setIsRecording(true);
      maxDurationTimerRef.current = setTimeout(() => {
        try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
        setIsRecording(false);
        cleanupStream();
      }, MAX_RECORDING_MS);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [cleanupStream, handleRecordingStop]);

  const stopRecording = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
    setIsRecording(false);
    cleanupStream();
  }, [cleanupStream]);

  useEffect(() => () => {
    cleanupStream();
    try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
    mediaRecorderRef.current = null;
  }, [cleanupStream]);

  return { isRecording, uploading, error, startRecording, stopRecording };
};

export default useDebugVoiceMemo;
