import React, { useEffect, useRef, useState } from 'react';
import '../FitnessUsers.scss';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import FitnessVideo from './FitnessVideo.jsx';

// UI Label Constants
const UI_LABELS = {
  RECORD_BUTTON: '● Record Voice Memo',
  STOP_BUTTON_PREFIX: '■ Stop Recording Memo',
  SAVING_STATUS: 'Saving...',
  UPLOADING_STATUS: 'Uploading & Transcribing…',
  EMPTY_LIST: 'No memos yet.',
  ERROR_PREFIX: '⚠️',
  RECORD_TOOLTIP: 'Start recording',
  STOP_TOOLTIP: 'Stop and transcribe'
};

// Helper: convert recorded Blob to base64 data URL
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const FitnessVoiceMemo = ({ minimal = false, menuOpen = false, onToggleMenu, playerRef }) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordingStartTimeRef = useRef(null);
  const wasPlayingBeforeRecordingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState(null);
  const [memos, setMemos] = useState([]); // local displayed memos (subset of session)
  const [uploading, setUploading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const fitnessCtx = useFitnessContext();
  const session = fitnessCtx?.fitnessSession;

  // Pause video following the playPause pattern from FitnessPlayerFooterControls
  const pauseVideo = () => {
    const api = playerRef?.current;
    if (!api) return;
    
    // Check if currently playing
    const media = api.getMediaElement?.();
    if (media && !media.paused) {
      wasPlayingBeforeRecordingRef.current = true;
      if (typeof api.pause === 'function') {
        api.pause();
      } else if (media) {
        media.pause();
      }
    } else {
      wasPlayingBeforeRecordingRef.current = false;
    }
  };

  // Resume video if it was playing before
  const resumeVideo = () => {
    if (!wasPlayingBeforeRecordingRef.current) return;
    
    const api = playerRef?.current;
    if (!api) return;
    
    if (typeof api.play === 'function') {
      api.play();
    } else {
      const media = api.getMediaElement?.();
      if (media) {
        media.play();
      }
    }
    wasPlayingBeforeRecordingRef.current = false;
  };

  // Start recording
  const startRecording = async () => {
    setError(null);
    
    // Pause video before starting recording
    pauseVideo();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = handleRecordingStop;
      mr.start();
      mediaRecorderRef.current = mr;
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      setIsRecording(true);
    } catch (e) {
      console.error('Mic access error', e);
      setError(e.message || 'Failed to access microphone');
      // Resume video if recording failed to start
      resumeVideo();
    }
  };

  // Stop recording
  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch(e) {}
    setIsRecording(false);
    // Stop tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // Resume video after stopping recording
    resumeVideo();
  };

  // After MediaRecorder stops
  const handleRecordingStop = async () => {
    if (!chunksRef.current.length) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    try {
      setUploading(true);
      const base64 = await blobToBase64(blob); // data URL
      const createdAt = Date.now();
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: session?.sessionId || null,
        startedAt: createdAt,
        endedAt: Date.now()
      };
      const resp = await DaylightAPI('api/fitness/voice_memo', payload, 'POST');
      if (!resp?.ok) {
        setError(resp?.error || 'Transcription failed');
      } else {
        const memo = resp.memo;
        // Push into session model
        try { session?.addVoiceMemo?.(memo); } catch(e) { console.warn('addVoiceMemo failed', e); }
        setMemos(prev => [...prev, memo]);
      }
    } catch(e) {
      console.error('Upload voice memo error', e);
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    // Update recording duration every 100ms while recording
    let interval;
    if (isRecording && recordingStartTimeRef.current) {
      interval = setInterval(() => {
        const elapsed = Date.now() - recordingStartTimeRef.current;
        setRecordingDuration(elapsed);
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch(_){ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Format milliseconds to MM:SS
  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Combined Video + Controls Container */}
      <div className="media-controls-container">
        {/* Video Section */}
        <div className="media-video-section">
          <FitnessVideo minimal />
        </div>
        
        {/* Button Panel Section */}
        <div className="media-button-panel">
          {/* Config Button - Top */}
          <button
            className="media-config-btn"
            onClick={onToggleMenu}
            title="Open menu"
          >
            ⋮
          </button>
          
          {/* Record/Stop Button - Middle or Bottom */}
          {!isRecording && !uploading && (
            <button
              className="media-record-btn"
              onClick={startRecording}
              disabled={uploading}
              title={UI_LABELS.RECORD_TOOLTIP}
            >
              ●
            </button>
          )}
          {isRecording && (
            <button
              className="media-stop-btn"
              onClick={stopRecording}
              title={UI_LABELS.STOP_TOOLTIP}
            >
              ■
            </button>
          )}
          {uploading && (
            <button
              className="media-saving-btn"
              disabled
              title="Saving memo"
            >
              ⏳
            </button>
          )}
          
          {/* Counter Button - Bottom (when memos exist) */}
          {memos.length > 0 && !isRecording && !uploading && (
            <button
              className="media-counter-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Hide memos' : 'Show memos'}
            >
              {memos.length}
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && <div className="voice-memo-error">{UI_LABELS.ERROR_PREFIX} {error}</div>}

      {/* Collapsible Memo List - Below the media container */}
      {memos.length > 0 && isExpanded && (
        <ul className="voice-memo-list">
          {memos.slice().reverse().map(m => (
            <li key={m.createdAt} className="voice-memo-item" title={new Date(m.createdAt).toLocaleTimeString()}>
              <span className="memo-text">{m.transcriptClean || m.transcriptRaw || 'Processing...'}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default FitnessVoiceMemo;
