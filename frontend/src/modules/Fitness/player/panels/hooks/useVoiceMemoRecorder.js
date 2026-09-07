import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { playbackLog } from '@/modules/Player/lib/playbackLogger.js';
import { useFitness } from '@/context/FitnessContext.jsx';

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

const normalizeRecorderError = (err, fallbackMessage = 'Recorder error', code = 'recorder_error', retryable = false, artifact = null) => {
  const message = (err instanceof Error ? err.message : null) || fallbackMessage;
  return {
    code,
    message,
    retryable,
    // The backend persists the capture BEFORE transcribing it, so a failure
    // here is not the end of the recording. When the response names an
    // artifact, the UI must say so — "failed" and "lost" are different words.
    artifact,
    error: err instanceof Error ? err : new Error(String(err || fallbackMessage))
  };
};

/**
 * DaylightAPI throws `HTTP <status>: <statusText> - <body>` for a non-2xx, so
 * the structured body a failed voice-memo upload returns (the artifact ref and
 * its lifecycle state) is only reachable by parsing it back out. Parsed here,
 * in the one consumer that needs it, rather than by changing the shared client.
 */
const parseApiErrorBody = (err) => {
  const message = typeof err?.message === 'string' ? err.message : '';
  const start = message.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(message.slice(start));
  } catch (_) {
    return null;
  }
};

/** What the person is told when transcription fails but the recording did not. */
const artifactMessage = (artifact) => {
  if (artifact?.state === 'retryable') {
    return "Transcription is unavailable right now — your recording is saved and will be transcribed automatically.";
  }
  return 'Transcription failed. Your recording is saved and can be retried.';
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
  onResumeMusic: _onResumeMusic
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
  const lastAudioPayloadRef = useRef(null);
  const retryAbortRef = useRef(null);

  const savedArtifactRef = useRef(null);
  const [savedArtifact, setSavedArtifact] = useState(null);
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

  const emitError = useCallback((err, fallbackMessage, code, retryable = false, artifact = null) => {
    const normalized = normalizeRecorderError(err, fallbackMessage, code, retryable, artifact);
    setError(normalized);
    emitState('error', normalized);
    logVoiceMemo('recorder-error', {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      artifactRef: artifact?.ref || null,
      artifactState: artifact?.state || null
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
          currentShow: fitnessCtx?.currentMedia?.showName || fitnessCtx?.currentMedia?.grandparentTitle,
          currentEpisode: fitnessCtx?.currentMedia?.title,
          recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName || item.grandparentTitle),
          activeUsers: fitnessCtx?.fitnessSessionInstance?.roster?.map(p => p.name),
          householdId: fitnessCtx?.householdId
        }
      };

      // Stash payload immediately so retry works even if upload fails
      lastAudioPayloadRef.current = payload;

      const resp = await Promise.race([
        DaylightAPI('api/v1/fitness/voice_memo', payload, 'POST'),
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
      if (resp.artifact) {
        savedArtifactRef.current = resp.artifact;
        setSavedArtifact(resp.artifact);
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
      // A 502 from the voice-memo route means the provider failed AFTER the
      // capture was safely stored; the body names the artifact. Report that,
      // not a bare "Upload failed" that implies the recording is gone.
      const artifact = parseApiErrorBody(err)?.artifact || null;
      if (artifact) {
        savedArtifactRef.current = artifact;
        setSavedArtifact(artifact);
      }
      emitError(
        artifact ? new Error(artifactMessage(artifact)) : err,
        timedOut ? 'Processing timed out' : 'Upload failed',
        artifact ? 'transcription_failed_capture_saved' : (timedOut ? 'processing_timeout' : 'upload_failed'),
        true,
        artifact
      );
      logVoiceMemo('recording-upload-error', {
        error: err?.message || String(err),
        status: err?.status ?? null,
        artifactRef: artifact?.ref || null,
        artifactState: artifact?.state || null,
        timedOut
      }, { level: 'warn' });
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  }, [
    emitError, emitState, logVoiceMemo, onMemoCaptured, sessionId,
    fitnessCtx?.currentMedia?.grandparentTitle, fitnessCtx?.currentMedia?.showName,
    fitnessCtx?.currentMedia?.title, fitnessCtx?.fitnessSessionInstance?.roster,
    fitnessCtx?.householdId, fitnessCtx?.recentlyPlayed,
  ]);

  const startRecording = useCallback(async () => {
    // Invalidate queued events from the previous recorder before awaiting the
    // microphone. The next recorder may not exist yet when old stop events arrive.
    mediaRecorderRef.current = null;
    // Cancellation belongs to the previous capture, not the next memo.
    cancelledRef.current = false;
    setError(null);
    lastAudioPayloadRef.current = null;
    savedArtifactRef.current = null;
    setSavedArtifact(null);
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
        if (mediaRecorderRef.current !== recorder) return;
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        // A cancelled recorder can deliver queued events after a new capture
        // starts. It must neither upload nor discard the new capture's chunks.
        if (mediaRecorderRef.current !== recorder) return;
        handleRecordingStop();
      };
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
  }, [cleanupStream, clearDurationTimer, emitError, emitLevel, emitState, handleRecordingStop, logVoiceMemo, onPauseMusic, playerRef, preferredMicrophoneId, startLevelMonitor]);

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
  }, [cleanupStream, clearDurationTimer, emitLevel, emitState, logVoiceMemo]);

  const cancelUpload = useCallback(() => {
    // Set cancelled flag to prevent handleRecordingStop from processing
    cancelledRef.current = true;
    lastAudioPayloadRef.current = null;
    savedArtifactRef.current = null;
    setSavedArtifact(null);

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

  const retryTranscription = useCallback(async () => {
    const payload = lastAudioPayloadRef.current;
    if (!payload) throw new Error('No audio available for retry');

    retryAbortRef.current = new AbortController();

    try {
      setUploading(true);
      emitState('processing');

      const resp = await Promise.race([
        DaylightAPI('api/v1/fitness/voice_memo', payload, 'POST'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Processing timed out')), UPLOAD_TIMEOUT_MS))
      ]);

      if (retryAbortRef.current?.signal.aborted) {
        logVoiceMemo('retry-transcription-aborted', { reason: 'user_cancel' });
        return null;
      }

      if (!resp?.ok) {
        throw new Error(resp?.error || 'Transcription failed');
      }

      const memo = resp.memo || null;
      if (memo) {
        logVoiceMemo('retry-transcription-complete', { memoId: memo.memoId || null });
      }
      emitState('ready');
      return memo;
    } catch (err) {
      if (retryAbortRef.current?.signal.aborted) {
        logVoiceMemo('retry-transcription-aborted', { reason: 'user_cancel', phase: 'error' });
        return null;
      }
      const artifact = parseApiErrorBody(err)?.artifact || null;
      if (artifact) {
        savedArtifactRef.current = artifact;
        setSavedArtifact(artifact);
      }
      logVoiceMemo('retry-transcription-error', {
        error: err?.message || String(err),
        artifactRef: artifact?.ref || null,
        artifactState: artifact?.state || null
      }, { level: 'warn' });
      throw artifact ? Object.assign(new Error(artifactMessage(artifact)), { artifact }) : err;
    } finally {
      setUploading(false);
      retryAbortRef.current = null;
    }
  }, [emitState, logVoiceMemo]);

  const hasAudioBlob = Boolean(lastAudioPayloadRef.current);

  useEffect(() => () => {
    clearDurationTimer();
    cleanupStream();

    // Abort any in-flight upload on unmount
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (retryAbortRef.current) {
      retryAbortRef.current.abort();
      retryAbortRef.current = null;
    }
    lastAudioPayloadRef.current = null;
    // Unmount is a cancel: force any still-pending MediaRecorder.onstop handler
    // to discard its chunks instead of uploading. Resetting to false here caused
    // a race where onstop fired after cleanup and proceeded to upload the audio.
    cancelledRef.current = true;

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
    cancelUpload,
    retryTranscription,
    hasAudioBlob,
    // The durable capture behind a failed transcription, when there is one.
    // Its presence is what lets the overlay promise the recording is safe.
    savedArtifact
  };
};

export default useVoiceMemoRecorder;
