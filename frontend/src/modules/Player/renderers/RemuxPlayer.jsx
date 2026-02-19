// frontend/src/modules/Player/renderers/RemuxPlayer.jsx
import React, { useRef, useEffect, useCallback, useState } from 'react';

/**
 * RemuxPlayer — syncs a visible <video> (video-only stream) with a hidden
 * <audio> element. Video is the leader, audio follows.
 *
 * Falls back via onError if either element fails or sync drifts too far.
 */
const SYNC_DRIFT_THRESHOLD = 0.5; // seconds
const SYNC_CHECK_INTERVAL_MS = 1000;

export function RemuxPlayer({
  videoUrl,
  audioUrl,
  onError,
  onMediaRef,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  volume = 1,
  playbackRate = 1,
  style,
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const [ready, setReady] = useState(false);

  // Register media access for Player ecosystem
  useEffect(() => {
    if (!videoRef.current) return;
    onRegisterMediaAccess?.({
      getMediaEl: () => videoRef.current,
    });
  }, [ready, onRegisterMediaAccess]);

  // Sync audio to video on play/pause/seek
  const syncAudio = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    // Match play state
    if (video.paused && !audio.paused) audio.pause();
    if (!video.paused && audio.paused) audio.play().catch(() => {});

    // Match seek — correct drift
    const drift = Math.abs(video.currentTime - audio.currentTime);
    if (drift > SYNC_DRIFT_THRESHOLD) {
      // If drift is extreme, it may indicate a broken stream
      if (drift > 3) {
        onError?.('sync-drift-extreme');
        return;
      }
      audio.currentTime = video.currentTime;
    }
  }, [onError]);

  // Video event handlers
  const handlePlay = useCallback(() => {
    audioRef.current?.play().catch(() => {});
    onPlaybackMetrics?.({ isPaused: false });
  }, [onPlaybackMetrics]);

  const handlePause = useCallback(() => {
    audioRef.current?.pause();
    onPlaybackMetrics?.({ isPaused: true });
  }, [onPlaybackMetrics]);

  const handleSeeked = useCallback(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.currentTime = videoRef.current.currentTime;
    }
    onPlaybackMetrics?.({ isSeeking: false });
  }, [onPlaybackMetrics]);

  const handleSeeking = useCallback(() => {
    onPlaybackMetrics?.({ isSeeking: true });
  }, [onPlaybackMetrics]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    onPlaybackMetrics?.({
      seconds: video.currentTime,
      isPaused: video.paused,
    });
  }, [onPlaybackMetrics]);

  const handleError = useCallback((_e) => {
    onError?.('video-error');
  }, [onError]);

  const handleAudioError = useCallback(() => {
    onError?.('audio-error');
  }, [onError]);

  // Volume and playback rate sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) video.playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate]);

  // Periodic sync check
  useEffect(() => {
    syncIntervalRef.current = setInterval(syncAudio, SYNC_CHECK_INTERVAL_MS);
    return () => clearInterval(syncIntervalRef.current);
  }, [syncAudio]);

  // Report media ref
  useEffect(() => {
    if (videoRef.current) {
      onMediaRef?.(videoRef.current);
      setReady(true);
    }
  }, [onMediaRef]);

  return (
    <>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        autoPlay
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }}
      />
      <audio
        ref={audioRef}
        src={audioUrl}
        autoPlay
        onError={handleAudioError}
      />
    </>
  );
}
