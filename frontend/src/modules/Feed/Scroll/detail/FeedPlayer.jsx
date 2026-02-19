import { useState, useRef, useEffect, useCallback } from 'react';
import { RemuxPlayer } from '../../../Player/renderers/RemuxPlayer.jsx';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];

/**
 * FeedPlayer — video player with controls for feed detail views.
 * Handles both combined streams (single URL) and split streams (video + audio via RemuxPlayer).
 * Falls back via onError on any failure.
 */
export default function FeedPlayer({ playerData, onError, aspectRatio = '16 / 9' }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef(null);
  const isSplit = !!(playerData.videoUrl && playerData.audioUrl);

  // Auto-hide controls after 3s of playing
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    if (!playing) return;
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, [playing]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (playing) scheduleHide();
    else setControlsVisible(true);
    return () => clearTimeout(hideTimerRef.current);
  }, [playing, scheduleHide]);

  // Sync progress bar via rAF for smoothness
  useEffect(() => {
    let raf;
    const update = () => {
      const v = videoRef.current;
      if (v) {
        setCurrentTime(v.currentTime);
        if (v.duration && Number.isFinite(v.duration)) setDuration(v.duration);
        if (progressRef.current && v.duration) {
          progressRef.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      audioRef.current?.play().catch(() => {});
    } else {
      v.pause();
      audioRef.current?.pause();
    }
  }, []);

  const seek = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEED_STEPS.indexOf(prev);
      const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
      const v = videoRef.current;
      if (v) v.playbackRate = next;
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const handleProgressClick = useCallback((e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(duration, pct * duration)));
  }, [duration, seek]);

  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);

  // RemuxPlayer callback refs
  const handleRemuxMediaRef = useCallback((el) => {
    videoRef.current = el;
  }, []);

  const handleRemuxRegisterMediaAccess = useCallback((access) => {
    if (access?.getMediaEl) videoRef.current = access.getMediaEl();
  }, []);

  return (
    <div
      className="feed-player"
      style={{ position: 'relative', aspectRatio, background: '#000', overflow: 'hidden' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      {isSplit ? (
        <RemuxPlayer
          videoUrl={playerData.videoUrl}
          audioUrl={playerData.audioUrl}
          onError={() => onError?.('stream-error')}
          onMediaRef={handleRemuxMediaRef}
          onRegisterMediaAccess={handleRemuxRegisterMediaAccess}
          onPlaybackMetrics={({ isPaused }) => {
            if (typeof isPaused === 'boolean') setPlaying(!isPaused);
          }}
          volume={1}
          playbackRate={speed}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <>
          <video
            ref={videoRef}
            src={playerData.url}
            autoPlay
            playsInline
            onPlay={handlePlay}
            onPause={handlePause}
            onError={() => onError?.('stream-error')}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </>
      )}

      {/* Control bar overlay */}
      <div
        className="feed-player-controls"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          padding: '24px 8px 6px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
          opacity: controlsVisible ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: controlsVisible ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.3)', borderRadius: '2px', cursor: 'pointer', marginBottom: '4px' }}
          onClick={handleProgressClick}
        >
          <div ref={progressRef} style={{ height: '100%', background: '#fff', borderRadius: '2px', width: '0%' }} />
        </div>

        {/* Play/Pause */}
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {playing
              ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
              : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>

        {/* Time */}
        <span style={{ color: '#fff', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <span style={{ flex: 1 }} />

        {/* Speed */}
        <button
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}x`}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', cursor: 'pointer', padding: '1px 6px', borderRadius: '3px', fontSize: '11px' }}
        >
          {speed}x
        </button>
      </div>

      {/* Click-to-toggle play/pause on video area */}
      {!isSplit && (
        <div
          style={{ position: 'absolute', inset: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) toggle();
          }}
        />
      )}
    </div>
  );
}
