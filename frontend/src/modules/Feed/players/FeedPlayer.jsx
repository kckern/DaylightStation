import { useState, useRef, useEffect, useCallback } from 'react';
import { RemuxPlayer } from '../../Player/renderers/RemuxPlayer.jsx';
import { useFeedPlayer } from './FeedPlayerContext.jsx';
import getLogger from '../../../lib/logging/Logger.js';

// Recreate child each call to pick up sessionLog context set by FeedApp
function log() { return getLogger().child({ module: 'feed-player' }); }

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Speaker icon SVG for volume control.
 * Three visual states: muted (x), low (single wave), high (double wave).
 */
function SpeakerIcon({ volume, muted }) {
  if (muted || volume === 0) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3z" />
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" />
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (volume < 0.5) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3z" />
        <path d="M14 11.5c0.6 0.9 0.6 2.1 0 3" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3z" />
      <path d="M14 11.5c0.6 0.9 0.6 2.1 0 3" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17 8.5c1.3 1.8 1.3 5.2 0 7" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

/**
 * FeedPlayer — video player with controls for feed detail views.
 * Handles both combined streams (single URL) and split streams (video + audio via RemuxPlayer).
 * Falls back via onError on any failure.
 */
export default function FeedPlayer({ playerData, onError, aspectRatio = '16 / 9' }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const wrapperRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef(null);
  const mountTimeRef = useRef(performance.now());
  const firstFrameLoggedRef = useRef(false);
  const isSplit = !!(playerData.videoUrl && playerData.audioUrl);

  useEffect(() => {
    mountTimeRef.current = performance.now();
    firstFrameLoggedRef.current = false;
  }, [playerData]);

  // Log mount with stream info
  useEffect(() => {
    log().info('feedPlayer.mount', {
      mode: isSplit ? 'split' : 'combined',
      hasVideo: !!playerData.videoUrl,
      hasAudio: !!playerData.audioUrl,
      hasUrl: !!playerData.url,
      provider: playerData.provider,
      videoUrl: playerData.videoUrl || null,
      audioUrl: playerData.audioUrl || null,
      url: playerData.url || null,
    });
    return () => log().info('feedPlayer.unmount');
  }, []);

  // Read playback preferences from context
  const {
    volume,
    muted,
    speed,
    cycleSpeed,
    setVolume,
    toggleMute,
    registerPlayerEl,
  } = useFeedPlayer();

  // Register wrapper element for IntersectionObserver visibility tracking
  useEffect(() => {
    registerPlayerEl(wrapperRef.current);
    return () => registerPlayerEl(null);
  }, [registerPlayerEl]);

  // Apply volume to non-split video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v || isSplit) return;
    v.volume = volume;
  }, [volume, isSplit]);

  // Apply speed to non-split video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v || isSplit) return;
    v.playbackRate = speed;
  }, [speed, isSplit]);

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
    log().info('feedPlayer.seek', { from: Math.round(v.currentTime), to: Math.round(t), duration: Math.round(v.duration || 0) });
    v.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
  }, []);

  const handleProgressClick = useCallback((e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(duration, pct * duration)));
  }, [duration, seek]);

  const handlePlay = useCallback(() => { log().info('feedPlayer.play', { mode: isSplit ? 'split' : 'combined', provider: playerData.provider }); setPlaying(true); }, [isSplit, playerData.provider]);
  const handlePause = useCallback(() => { log().info('feedPlayer.pause', { mode: isSplit ? 'split' : 'combined', currentTime: videoRef.current?.currentTime, duration: videoRef.current?.duration }); setPlaying(false); }, [isSplit]);

  // RemuxPlayer callback refs
  const handleRemuxMediaRef = useCallback((el) => {
    videoRef.current = el;
  }, []);

  const handleRemuxRegisterMediaAccess = useCallback((access) => {
    if (access?.getMediaEl) videoRef.current = access.getMediaEl();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="feed-player"
      style={{ position: 'relative', aspectRatio, background: '#000', overflow: 'hidden' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      {isSplit ? (
        <RemuxPlayer
          videoUrl={playerData.videoUrl}
          audioUrl={playerData.audioUrl}
          onError={() => { log().error('feedPlayer.error', { mode: 'split' }); onError?.('stream-error'); }}
          onMediaRef={handleRemuxMediaRef}
          onRegisterMediaAccess={handleRemuxRegisterMediaAccess}
          onPlaybackMetrics={({ isPaused }) => {
            if (typeof isPaused === 'boolean') {
              if (!isPaused && !firstFrameLoggedRef.current) {
                firstFrameLoggedRef.current = true;
                log().info('feedPlayer.firstFrame', {
                  mode: 'split',
                  durationMs: Math.round(performance.now() - mountTimeRef.current),
                });
              }
              setPlaying(!isPaused);
            }
          }}
          volume={volume}
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
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (!v) return;
              log().info('feedPlayer.loadedMetadata', {
                mode: 'combined',
                width: v.videoWidth,
                height: v.videoHeight,
                duration: v.duration,
                src: playerData.url,
              });
            }}
            onCanPlay={() => {
              log().info('feedPlayer.canplay', {
                mode: 'combined',
                durationMs: Math.round(performance.now() - mountTimeRef.current),
              });
            }}
            onEnded={() => {
              log().info('feedPlayer.ended', {
                mode: 'combined',
                duration: videoRef.current?.duration,
              });
              setPlaying(false);
            }}
            onPlaying={() => {
              if (!firstFrameLoggedRef.current) {
                firstFrameLoggedRef.current = true;
                log().info('feedPlayer.firstFrame', {
                  mode: 'combined',
                  durationMs: Math.round(performance.now() - mountTimeRef.current),
                });
              }
            }}
            onError={() => { log().error('feedPlayer.error', { mode: 'combined', src: playerData.url }); onError?.('stream-error'); }}
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

        {/* Mute toggle */}
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex' }}
        >
          <SpeakerIcon volume={volume} muted={muted} />
        </button>

        {/* Volume slider */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          style={{ width: '60px', accentColor: 'white', cursor: 'pointer' }}
        />

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
