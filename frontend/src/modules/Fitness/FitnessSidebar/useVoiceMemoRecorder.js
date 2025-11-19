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
  onError
} = {}) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordingStartTimeRef = useRef(null);
  const wasPlayingBeforeRecordingRef = useRef(false);
  const durationIntervalRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const clearDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
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

  const handleRecordingStop = useCallback(async () => {
    if (!chunksRef.current.length) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    try {
      setUploading(true);
      const base64 = await blobToBase64(blob);
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: sessionId || null,
        startedAt: recordingStartTimeRef.current || Date.now(),
        endedAt: Date.now()
      };
      const resp = await DaylightAPI('api/fitness/voice_memo', payload, 'POST');
      if (!resp?.ok) {
        const message = resp?.error || 'Transcription failed';
        setError(message);
        if (onError) onError(new Error(message));
        return;
      }
      const memo = resp.memo || null;
      if (memo && onMemoCaptured) {
        onMemoCaptured(memo);
      }
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped.message || 'Upload failed');
      if (onError) onError(wrapped);
    } finally {
      setUploading(false);
    }
  }, [onError, onMemoCaptured, sessionId]);

  const startRecording = useCallback(async () => {
    setError(null);
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
      clearDurationTimer();
      durationIntervalRef.current = setInterval(() => {
        if (!recordingStartTimeRef.current) return;
        const elapsed = Date.now() - recordingStartTimeRef.current;
        setRecordingDuration(elapsed);
      }, 100);
    } catch (err) {
      resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped.message || 'Failed to access microphone');
      if (onError) onError(wrapped);
    }
  }, [clearDurationTimer, handleRecordingStop, onError, playerRef, preferredMicrophoneId]);

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch (_) {
      // ignore
    }
    setIsRecording(false);
    clearDurationTimer();
    setRecordingDuration(0);
    cleanupStream();
    resumeMediaIfNeeded(playerRef, wasPlayingBeforeRecordingRef);
  }, [cleanupStream, clearDurationTimer, playerRef]);

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
