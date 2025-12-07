import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const resolveAudioConstraints = (preferredMicrophoneId) => {
  if (!preferredMicrophoneId || preferredMicrophoneId === 'default') {
    return true;
  }
  return { deviceId: { exact: preferredMicrophoneId } };
};

const resolvePlaybackState = (api) => {
  if (!api) return null;
  const direct = api.getPlaybackState?.();
  if (direct) return direct;
  const controller = api.getMediaController?.();
  return controller?.getPlaybackState?.() || controller?.transport?.getPlaybackState?.() || null;
};

const normalizeRecorderError = (err, fallbackMessage = 'Recorder error', code = 'recorder_error', retryable = false) => {
  const message = (err instanceof Error ? err.message : null) || fallbackMessage;
  return {
    code,
    message,
    retryable,
    error: err instanceof Error ? err : new Error(String(err || fallbackMessage))
  };
};

const pauseMediaIfNeeded = (playerRef, wasPlayingRef) => {
  const api = playerRef?.current;
  if (!api) {
    wasPlayingRef.current = false;
    return;
  }
  const playbackState = resolvePlaybackState(api);
  if (playbackState && playbackState.isPaused === false) {
    wasPlayingRef.current = true;
    api.pause?.();
    return;
  }
  wasPlayingRef.current = false;
};

const resumeMediaIfNeeded = (playerRef, wasPlayingRef) => {
  if (!wasPlayingRef.current) return;
  const api = playerRef?.current;
  if (!api) {
    wasPlayingRef.current = false;
    return;
  }
  api.play?.();
  wasPlayingRef.current = false;
};

const useVoiceMemoRecorder = ({
  sessionId,
  playerRef,
  preferredMicrophoneId,
  onMemoCaptured,
  onError,
  onStateChange,
  onLevel
} = {}) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelDataRef = useRef(null);
  const levelRafRef = useRef(null);
  const lastLevelAtRef = useRef(0);
  const recordingStartTimeRef = useRef(null);
  const wasPlayingBeforeRecordingRef = useRef(false);
  const durationIntervalRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const emitState = useCallback((state, detail) => {
    if (typeof onStateChange === 'function') {
      try {
        onStateChange(state, detail);
      } catch (_) {
        // ignore consumer errors
      }
    }
  }, [onStateChange]);

  const emitLevel = useCallback((level) => {
    if (typeof onLevel === 'function') {
      try {
        onLevel(level);
      } catch (_) {
        // ignore consumer errors
      }
    }
  }, [onLevel]);

  const emitError = useCallback((err, fallbackMessage, code, retryable = false) => {
    const normalized = normalizeRecorderError(err, fallbackMessage, code, retryable);
    setError(normalized);
    emitState('error', normalized);
    if (typeof onError === 'function') {
      try {
        onError(normalized);
      } catch (_) {
        // ignore consumer errors
      }
    }
    return normalized;
  }, [emitState, onError]);

  const clearDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    lastLevelAtRef.current = 0;
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (_) {
        // ignore
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    levelDataRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {
          // ignore
        }
      });
      streamRef.current = null;
    }
  }, []);

  const LEVEL_SAMPLE_INTERVAL_MS = 70; // ~14 fps
  const UPLOAD_TIMEOUT_MS = 15000;

  const startLevelMonitor = useCallback((stream) => {
    if (!stream || !onLevel) return;
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      levelDataRef.current = dataArray;

      const sample = () => {
        const analyserNode = analyserRef.current;
        const buf = levelDataRef.current;
        if (!analyserNode || !buf) return;
        analyserNode.getByteTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const centered = (buf[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / buf.length);
        const level = Math.max(0, Math.min(1, rms * 1.8));
        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          emitLevel(level);
        }
        levelRafRef.current = requestAnimationFrame(sample);
      };

      levelRafRef.current = requestAnimationFrame(sample);
    } catch (_) {
      // ignore metering failures; recording can proceed without VU
    }
  }, [emitLevel, onLevel]);

  const handleRecordingStop = useCallback(async () => {
    if (!chunksRef.current.length) return;

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error('Processing timed out'));
      }, UPLOAD_TIMEOUT_MS);
    });

    try {
      setUploading(true);
      emitState('processing');
      const base64 = await blobToBase64(blob);
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: sessionId || null,
        startedAt: recordingStartTimeRef.current || Date.now(),
        endedAt: Date.now()
      };

      const resp = await Promise.race([
        DaylightAPI('api/fitness/voice_memo', payload, 'POST'),
        timeoutPromise
      ]);

      if (!resp?.ok) {
        emitError(resp?.error || 'Transcription failed', 'Transcription failed', 'transcription_failed', true);
        return;
      }
      if (timedOut) {
        emitError(new Error('Processing timed out'), 'Processing timed out', 'processing_timeout', true);
        return;
      }

      const memo = resp.memo || null;
      if (memo && onMemoCaptured) {
        onMemoCaptured(memo);
      }
      emitState('ready');
    } catch (err) {
      emitError(err, timedOut ? 'Processing timed out' : 'Upload failed', timedOut ? 'processing_timeout' : 'upload_failed', true);
    } finally {
      setUploading(false);
    }
  }, [emitError, emitState, onMemoCaptured, sessionId]);

  const startRecording = useCallback(async () => {
    setError(null);
    emitState('requesting');
    emitLevel(null);
    pauseMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
    try {
      const audioConstraints = resolveAudioConstraints(preferredMicrophoneId);
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (primaryError) {
        if (audioConstraints !== true) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw primaryError;
        }
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      startLevelMonitor(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = handleRecordingStop;
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      recorder.start();
      setIsRecording(true);
      emitState('recording');
      clearDurationTimer();
      durationIntervalRef.current = setInterval(() => {
        if (!recordingStartTimeRef.current) return;
        const elapsed = Date.now() - recordingStartTimeRef.current;
        setRecordingDuration(elapsed);
      }, 100);
    } catch (err) {
      resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
      emitError(err, 'Failed to access microphone', 'mic_access_denied', false);
    }
  }, [clearDurationTimer, emitError, emitLevel, emitState, handleRecordingStop, playerRef, preferredMicrophoneId, startLevelMonitor]);

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch (_) {
      // ignore
    }
    setIsRecording(false);
    emitState('processing');
    clearDurationTimer();
    setRecordingDuration(0);
    cleanupStream();
    resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
    emitLevel(null);
  }, [cleanupStream, clearDurationTimer, emitLevel, emitState, playerRef]);

  useEffect(() => () => {
    clearDurationTimer();
    cleanupStream();
    try {
      mediaRecorderRef.current?.stop();
    } catch (_) {
      // ignore
    }
    mediaRecorderRef.current = null;
  }, [cleanupStream, clearDurationTimer]);

  return {
    isRecording,
    recordingDuration,
    uploading,
    error,
    setError,
    startRecording,
    stopRecording
  };
};

export default useVoiceMemoRecorder;
