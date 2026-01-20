import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { playbackLog } from '../../Player/lib/playbackLogger.js';
import { useFitness } from '../../../context/FitnessContext.jsx';

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

/**
 * Resolve playback state from various player API shapes.
 * Handles: getPlaybackState(), getMediaController(), and native .paused property.
 * @param {Object} api - Player API object
 * @returns {Object|null} - { isPaused: boolean } or null
 */
export const resolvePlaybackState = (api) => {
  if (!api) return null;

  // Priority 1: Direct getPlaybackState() method
  const direct = api.getPlaybackState?.();
  if (direct) return direct;

  // Priority 2: MediaController API
  const controller = api.getMediaController?.();
  const controllerState = controller?.getPlaybackState?.() || controller?.transport?.getPlaybackState?.();
  if (controllerState) return controllerState;

  // Priority 3: Native video element .paused property
  if (typeof api.paused === 'boolean') {
    return { isPaused: api.paused };
  }

  return null;
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

// Maximum recording duration: 5 minutes
const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * Pause media player if it's currently playing.
 * Handles multiple API shapes: direct pause(), getMediaController().pause().
 * @param {Object} playerRef - React ref to player
 * @param {Object} wasPlayingRef - React ref to track if we should resume later
 */
export const pauseMediaIfNeeded = (playerRef, wasPlayingRef) => {
  const api = playerRef?.current;
  if (!api) {
    wasPlayingRef.current = false;
    return;
  }

  const playbackState = resolvePlaybackState(api);
  const isPlaying = playbackState && playbackState.isPaused === false;

  if (!isPlaying) {
    wasPlayingRef.current = false;
    return;
  }

  // Mark that we paused it (so we can resume later)
  wasPlayingRef.current = true;

  // Try multiple pause APIs
  if (typeof api.pause === 'function') {
    api.pause();
    return;
  }

  // Fallback: MediaController API
  const controller = api.getMediaController?.();
  if (typeof controller?.pause === 'function') {
    controller.pause();
    return;
  }
};

/**
 * Resume media player if we previously paused it.
 * Handles multiple API shapes: direct play(), getMediaController().play().
 * @param {Object} playerRef - React ref to player
 * @param {Object} wasPlayingRef - React ref tracking if we paused it
 */
export const resumeMediaIfNeeded = (playerRef, wasPlayingRef) => {
  if (!wasPlayingRef.current) return;

  const api = playerRef?.current;
  if (!api) {
    wasPlayingRef.current = false;
    return;
  }

  // Reset the flag
  wasPlayingRef.current = false;

  // Try multiple play APIs
  if (typeof api.play === 'function') {
    api.play();
    return;
  }

  // Fallback: MediaController API
  const controller = api.getMediaController?.();
  if (typeof controller?.play === 'function') {
    controller.play();
    return;
  }
};

const useVoiceMemoRecorder = ({
  sessionId,
  playerRef,
  preferredMicrophoneId,
  onMemoCaptured,
  onError,
  onStateChange,
  onLevel,
  onPauseMusic,
  onResumeMusic
} = {}) => {
  const fitnessCtx = useFitness();
  const logVoiceMemo = useCallback((event, payload = {}, options = {}) => {
    playbackLog('voice-memo', {
      event,
      ...payload
    }, {
      level: options.level || 'info',
      context: {
        source: 'VoiceMemoRecorder',
        sessionId: sessionId || null,
        ...(options.context || {})
      },
      tags: options.tags || undefined
    });
  }, [sessionId]);

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
  const lastStateRef = useRef(null);
  const abortControllerRef = useRef(null);
  const cancelledRef = useRef(false);

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
    if (lastStateRef.current !== state) {
      logVoiceMemo('recorder-state', { state, detail }, { level: 'debug' });
      lastStateRef.current = state;
    }
  }, [logVoiceMemo, onStateChange]);

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
    logVoiceMemo('recorder-error', {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable
    }, { level: 'warn' });
    if (typeof onError === 'function') {
      try {
        onError(normalized);
      } catch (_) {
        // ignore consumer errors
      }
    }
    return normalized;
  }, [emitState, logVoiceMemo, onError]);

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
      logVoiceMemo('recorder-level-start', {}, { level: 'debug' });
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

        // Logarithmic scaling for perceptual loudness
        // Maps typical speech range (-60dB to 0dB) to 0-1
        const MIN_DB = -60;
        const MAX_DB = 0;
        const db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB;
        const normalized = (db - MIN_DB) / (MAX_DB - MIN_DB);
        const level = Math.max(0, Math.min(1, normalized));

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          emitLevel(level);
        }
        levelRafRef.current = requestAnimationFrame(sample);
      };

      levelRafRef.current = requestAnimationFrame(sample);
    } catch (_) {
      logVoiceMemo('recorder-level-error', { reason: 'metering-failed' }, { level: 'warn' });
      // ignore metering failures; recording can proceed without VU
    }
  }, [emitLevel, logVoiceMemo, onLevel]);

  const handleRecordingStop = useCallback(async () => {
    // Guard: If already cancelled, discard chunks and exit
    if (cancelledRef.current) {
      logVoiceMemo('recording-stop-cancelled', {
        chunksDiscarded: chunksRef.current.length,
        reason: 'user_cancel'
      });
      chunksRef.current = [];
      cancelledRef.current = false;
      return;
    }

    if (!chunksRef.current.length) return;

    logVoiceMemo('recording-stop', { chunks: chunksRef.current.length });

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];

    // Create abort controller for this upload
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

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

      // Check if aborted during base64 conversion
      if (signal.aborted) {
        logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'base64' });
        return;
      }

      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: sessionId || null,
        startedAt: recordingStartTimeRef.current || Date.now(),
        endedAt: Date.now(),
        context: {
          currentShow: fitnessCtx?.currentMedia?.showName || fitnessCtx?.currentMedia?.show,
          currentEpisode: fitnessCtx?.currentMedia?.title,
          recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName || item.show),
          activeUsers: fitnessCtx?.fitnessSessionInstance?.roster?.map(p => p.name),
          householdId: fitnessCtx?.householdId
        }
      };

      const resp = await Promise.race([
        DaylightAPI('api/fitness/voice_memo', payload, 'POST'),
        timeoutPromise
      ]);

      // Check if aborted during API call
      if (signal.aborted) {
        logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'api' });
        return;
      }

      if (!resp?.ok) {
        emitError(resp?.error || 'Transcription failed', 'Transcription failed', 'transcription_failed', true);
        return;
      }
      if (timedOut) {
        emitError(new Error('Processing timed out'), 'Processing timed out', 'processing_timeout', true);
        return;
      }

      const memo = resp.memo || null;

      // Final abort check before triggering callback
      if (signal.aborted) {
        logVoiceMemo('recording-callback-suppressed', {
          reason: 'overlay_closed',
          memoId: memo?.memoId
        });
        return;
      }

      if (memo && onMemoCaptured) {
        onMemoCaptured(memo);
      }
      if (memo) {
        logVoiceMemo('recording-upload-complete', { memoId: memo.memoId || null, durationMs: payload?.endedAt - payload?.startedAt });
      } else {
        logVoiceMemo('recording-upload-complete', { memoId: null, durationMs: payload?.endedAt - payload?.startedAt });
      }
      emitState('ready');
    } catch (err) {
      // Don't emit error if aborted
      if (signal.aborted) {
        logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'error' });
        return;
      }
      emitError(err, timedOut ? 'Processing timed out' : 'Upload failed', timedOut ? 'processing_timeout' : 'upload_failed', true);
      logVoiceMemo('recording-upload-error', {
        error: err?.message || String(err),
        timedOut
      }, { level: 'warn' });
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  }, [emitError, emitState, logVoiceMemo, onMemoCaptured, sessionId]);

  const startRecording = useCallback(async () => {
    setError(null);
    emitState('requesting');
    emitLevel(null);
    pauseMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
    // Also pause music player
    if (typeof onPauseMusic === 'function') {
      try { onPauseMusic(); } catch (_) { /* ignore */ }
    }
    logVoiceMemo('recording-start-request', { preferredMicrophoneId: preferredMicrophoneId || null });
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
      logVoiceMemo('recording-started', {
        trackCount: typeof stream?.getTracks === 'function' ? stream.getTracks().length : null,
        preferredMicrophoneId: preferredMicrophoneId || null
      });
      clearDurationTimer();
      durationIntervalRef.current = setInterval(() => {
        if (!recordingStartTimeRef.current) return;
        const elapsed = Date.now() - recordingStartTimeRef.current;
        setRecordingDuration(elapsed);
        // Auto-stop at max duration (5 minutes)
        if (elapsed >= MAX_RECORDING_MS) {
          logVoiceMemo('recording-max-duration-reached', { elapsed, maxMs: MAX_RECORDING_MS });
          try {
            mediaRecorderRef.current?.stop();
          } catch (_) { /* ignore */ }
          setIsRecording(false);
          emitState('processing');
          clearDurationTimer();
          cleanupStream();
          // resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
          // Also resume music player
          // if (typeof onResumeMusic === 'function') {
          //   try { onResumeMusic(); } catch (_) { /* ignore */ }
          // }
          emitLevel(null);
        }
      }, 100);
    } catch (err) {
      // resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
      // Also resume music player on error
      // if (typeof onResumeMusic === 'function') {
      //   try { onResumeMusic(); } catch (_) { /* ignore */ }
      // }
      emitError(err, 'Failed to access microphone', 'mic_access_denied', false);
      logVoiceMemo('recording-start-error', { error: err?.message || String(err) }, { level: 'warn' });
    }
  }, [clearDurationTimer, emitError, emitLevel, emitState, handleRecordingStop, logVoiceMemo, onPauseMusic, onResumeMusic, playerRef, preferredMicrophoneId, startLevelMonitor]);

  const stopRecording = useCallback(() => {
    logVoiceMemo('recording-stop-request');
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
    // resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
    // Also resume music player
    // if (typeof onResumeMusic === 'function') {
    //   try { onResumeMusic(); } catch (_) { /* ignore */ }
    // }
    emitLevel(null);
  }, [cleanupStream, clearDurationTimer, emitLevel, emitState, logVoiceMemo, onResumeMusic, playerRef]);

  const cancelUpload = useCallback(() => {
    // Set cancelled flag to prevent handleRecordingStop from processing
    cancelledRef.current = true;

    // Abort any in-flight API request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Discard any pending chunks
    const chunksDiscarded = chunksRef.current.length;
    chunksRef.current = [];

    // Reset state
    setUploading(false);
    emitState('idle');

    logVoiceMemo('recording-cancelled', {
      reason: 'user_cancel',
      chunksDiscarded,
      wasUploading: uploading
    });
  }, [emitState, logVoiceMemo, uploading]);

  useEffect(() => () => {
    clearDurationTimer();
    cleanupStream();

    // Abort any in-flight upload on unmount
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    cancelledRef.current = false;

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
    stopRecording,
    cancelUpload
  };
};

export default useVoiceMemoRecorder;
