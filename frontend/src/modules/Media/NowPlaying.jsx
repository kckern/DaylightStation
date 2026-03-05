import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import MediaAppPlayer from './MediaAppPlayer.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format-appropriate secondary metadata below the track title.
 *
 * Req: 8.1.9
 */
const FormatMetadata = ({ item, duration }) => {
  const { format, subtitle, source } = item;

  if (format === 'video') {
    if (!duration || !isFinite(duration)) return null;
    const m = Math.floor(duration / 60);
    const s = Math.floor(duration % 60);
    return <div className="media-track-meta">{m}:{s.toString().padStart(2, '0')}</div>;
  }

  if (format === 'audio') {
    const meta = subtitle || source;
    return meta ? <div className="media-track-meta">{meta}</div> : null;
  }

  if (format === 'singalong' || format === 'hymn') {
    const meta = subtitle || source;
    return (
      <div className="media-track-meta">
        {meta ? `${meta} · Singalong` : 'Singalong'}
      </div>
    );
  }

  if (format === 'readalong' || format === 'audiobook') {
    const meta = subtitle || source;
    return meta ? <div className="media-track-meta">{meta}</div> : null;
  }

  // Default: show source if available
  return source ? <div className="media-track-meta">{source}</div> : null;
};

/**
 * Main player view: player + track info + progress bar + transport controls + volume.
 *
 * Req: 1.2.4, 1.1.4, 1.1.5, 1.1.6, 1.1.7
 */
const NowPlaying = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, playerRef }) => {
  const logger = useMemo(() => getLogger().child({ component: 'NowPlaying' }), []);
  const { queue } = useMediaApp();

  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
  });
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const preMuteVolume = useRef(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Overlay visibility for video fullscreen auto-hide (8.2.4)
  const [overlayVisible, setOverlayVisible] = useState(true);
  const overlayTimerRef = useRef(null);
  const isDragging = useRef(false);

  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    logger.debug('overlay.show', { format: currentItem?.format });
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    if (currentItem?.format === 'video') {
      overlayTimerRef.current = setTimeout(() => {
        setIsFullscreen(current => {
          if (current) setOverlayVisible(false);
          return current;
        });
      }, 3000);
    }
  }, [currentItem?.format, logger]);

  // Reset overlay when entering/exiting fullscreen
  useEffect(() => {
    if (isFullscreen) {
      showOverlay();
      setPlaybackState(prev => ({ ...prev, isSeeking: false, seekIntent: null }));
      logger.info('player.fullscreen-enter', { format: currentItem?.format });
    } else {
      setOverlayVisible(true);
      setPlaybackState(prev => ({ ...prev, isSeeking: false, seekIntent: null }));
      // Timer cleared by cleanup function
      logger.info('player.fullscreen-exit', { format: currentItem?.format, contentId: currentItem?.contentId });
    }
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [isFullscreen, showOverlay]);

  // Clear fullscreen when nothing is playing or switching to non-video content
  useEffect(() => {
    if (!currentItem) {
      setIsFullscreen(false);
      return;
    }
    const isVideoFormat = currentItem.format === 'video' || currentItem.format === 'dash_video';
    if (!isVideoFormat) setIsFullscreen(false);
  }, [currentItem?.contentId, currentItem?.format]);

  // Keyboard fullscreen toggle (audit #15)
  useEffect(() => {
    const handler = () => {
      const isVideoFormat = currentItem?.format === 'video' || currentItem?.format === 'dash_video';
      if (isVideoFormat) setIsFullscreen(prev => !prev);
    };
    window.addEventListener('media:toggle-fullscreen', handler);
    return () => window.removeEventListener('media:toggle-fullscreen', handler);
  }, [currentItem?.format]);

  useEffect(() => {
    if (currentItem) {
      logger.info('now-playing.content-rendered', {
        contentId: currentItem.contentId,
        title: currentItem.title,
        format: currentItem.format,
        hasThumbnail: !!currentItem.contentId,
        isFullscreen,
      });
    } else {
      logger.info('now-playing.empty-state');
    }
  }, [currentItem?.contentId, isFullscreen, logger]);

  const handleProgress = useCallback((data) => {
    setPlaybackState({
      currentTime: data.currentTime || 0,
      duration: data.duration || 0,
      paused: data.paused ?? true,
      isSeeking: data.isSeeking || false,
      seekIntent: data.seekIntent ?? null,
    });
    onPlaybackState?.(data);
  }, [onPlaybackState]);

  const handleToggle = useCallback(() => {
    logger.debug('player.toggle', { paused: playbackState.paused, contentId: currentItem?.contentId });
    setPlaybackState(prev => ({ ...prev, paused: !prev.paused }));
    playerRef.current?.toggle?.();
  }, [playerRef, logger, playbackState.paused, currentItem?.contentId]);

  const getSeekTime = useCallback((e, bar) => {
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return percent * playbackState.duration;
  }, [playbackState.duration]);

  const handlePointerDown = useCallback((e) => {
    if (playbackState.duration <= 0) return;
    const bar = e.currentTarget;
    isDragging.current = true;
    bar.setPointerCapture(e.pointerId);
    const seekTime = getSeekTime(e, bar);
    setPlaybackState(prev => ({ ...prev, isSeeking: true, seekIntent: seekTime }));
    logger.debug('player.seek-start', { seekTime: Math.round(seekTime) });
  }, [playbackState.duration, getSeekTime, logger]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    const seekTime = getSeekTime(e, e.currentTarget);
    setPlaybackState(prev => ({ ...prev, seekIntent: seekTime }));
  }, [getSeekTime]);

  const handlePointerUp = useCallback((e) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const seekTime = getSeekTime(e, e.currentTarget);
    logger.debug('player.seek', { seekTime: Math.round(seekTime), duration: Math.round(playbackState.duration) });
    playerRef.current?.seek?.(seekTime);
  }, [getSeekTime, playbackState.duration, playerRef, logger]);

  const handleVolumeChange = useCallback((e) => {
    const newVolume = parseFloat(e.target.value);
    logger.debug('player.volume', { volume: newVolume });
    setVolume(newVolume);
    if (newVolume > 0) setMuted(false);
    const el = playerRef.current?.getMediaElement?.();
    if (el) { el.volume = newVolume; el.muted = false; }
  }, [playerRef, logger]);

  const handleMuteToggle = useCallback(() => {
    const el = playerRef.current?.getMediaElement?.();
    if (muted) {
      setMuted(false);
      setVolume(preMuteVolume.current);
      if (el) { el.volume = preMuteVolume.current; el.muted = false; }
    } else {
      preMuteVolume.current = volume;
      setMuted(true);
      if (el) { el.muted = true; }
    }
    logger.debug('player.mute-toggle', { muted: !muted });
  }, [muted, volume, playerRef, logger]);

  const handleExitFullscreen = useCallback(() => setIsFullscreen(false), []);

  const handleExpandFullscreen = useCallback(() => {
    logger.info('player.expand-fullscreen', { format: currentItem?.format });
    setIsFullscreen(true);
  }, [currentItem?.format, logger]);

  // When seeking, show the seek intent position (where user dragged to) instead
  // of the actual currentTime which fluctuates as the browser loads data.
  const isVideoFormat = currentItem?.format === 'video' || currentItem?.format === 'dash_video';

  const displayTime = (playbackState.isSeeking && playbackState.seekIntent != null)
    ? playbackState.seekIntent
    : playbackState.currentTime;
  const progress = playbackState.duration > 0
    ? Math.min(100, Math.max(0, (displayTime / playbackState.duration) * 100))
    : 0;

  const renderTransportOverlay = () => (
    <div
      className={`media-fullscreen-controls${!overlayVisible ? ' media-fullscreen-controls--hidden' : ''}`}
      onClick={(e) => { e.stopPropagation(); showOverlay(); }}
    >
      <div className="media-progress" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => { e.stopPropagation(); showOverlay(); handlePointerDown(e); }} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
        <div className="media-progress-bar">
          <div className="media-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="media-progress-times">
          <span>{formatTime(displayTime)}</span>
          <span>{formatTime(playbackState.duration)}</span>
        </div>
      </div>
      <div className="media-transport">
        <button className="media-transport-btn" onClick={onPrev} aria-label="Previous">&#9198;</button>
        <button
          className="media-transport-btn media-transport-btn--primary"
          onClick={handleToggle}
          aria-label={playbackState.paused ? 'Play' : 'Pause'}
        >
          {playbackState.paused ? '\u25B6' : '\u23F8'}
        </button>
        <button className="media-transport-btn" onClick={onNext} aria-label="Next">&#9197;</button>
      </div>
      <div className="media-volume-inline media-volume-inline--fullscreen">
        <button className="media-mute-btn" onClick={(e) => { e.stopPropagation(); handleMuteToggle(); }} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted || volume === 0 ? '\u{1F507}' : volume < 0.5 ? '\u{1F509}' : '\u{1F50A}'}
        </button>
        <input
          type="range" min="0" max="1" step="0.05"
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          onClick={(e) => e.stopPropagation()}
          aria-label="Volume"
        />
      </div>
    </div>
  );

  if (!currentItem) {
    return (
      <div className="media-now-playing media-now-playing--empty">
        <div className="media-empty-state">
          <p>Nothing playing</p>
          <p className="media-empty-hint">Search or browse to find something to play</p>
        </div>
      </div>
    );
  }

  const thumbnailUrl = currentItem.contentId
    ? ContentDisplayUrl(currentItem.contentId)
    : null;

  return (
    <div className={`media-now-playing${isVideoFormat ? ' media-now-playing--video' : ''}`}>
      {/* Player (may be embedded or fullscreen) */}
      <MediaAppPlayer
        ref={playerRef}
        contentId={currentItem.contentId}
        config={currentItem.config}
        onItemEnd={onItemEnd}
        onProgress={handleProgress}
        isFullscreen={isFullscreen}
        onExitFullscreen={handleExitFullscreen}
        renderOverlay={isFullscreen ? renderTransportOverlay : undefined}
        onPlayerClick={isFullscreen ? showOverlay : handleToggle}
      />

      {/* Track Info */}
      <div className="media-track-info">
        {thumbnailUrl && (
          <div className="media-track-thumbnail">
            <img src={thumbnailUrl} alt="" />
          </div>
        )}
        <div className="media-track-details">
          <div className="media-track-title">{currentItem.title || currentItem.contentId}</div>
          {queue.items.length > 1 && (
            <div className="media-track-position">{queue.position + 1} of {queue.items.length}</div>
          )}
          <FormatMetadata item={currentItem} duration={playbackState.duration} />
          {/* Expand to fullscreen for singalong/readalong (8.1.5, 8.1.7) */}
          {!isFullscreen && (currentItem.format === 'singalong' || currentItem.format === 'hymn' || currentItem.format === 'readalong') && (
            <button
              className="media-expand-btn"
              onClick={handleExpandFullscreen}
              aria-label="Expand to fullscreen"
            >
              &#x26F6;
            </button>
          )}
        </div>
      </div>

      {!isFullscreen && (
        <>
          {/* Progress Bar */}
          <div className="media-progress" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
            <div className="media-progress-bar">
              <div
                className="media-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="media-progress-times">
              <span>{formatTime(displayTime)}</span>
              <span>{formatTime(playbackState.duration)}</span>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="media-transport">
            <button className="media-transport-btn" onClick={onPrev} aria-label="Previous">
              &#9198;
            </button>
            <button
              className="media-transport-btn media-transport-btn--primary"
              onClick={handleToggle}
              aria-label={playbackState.paused ? 'Play' : 'Pause'}
            >
              {playbackState.paused ? '\u25B6' : '\u23F8'}
            </button>
            <button className="media-transport-btn" onClick={onNext} aria-label="Next">
              &#9197;
            </button>
          </div>
        </>
      )}

      {/* Volume — inline with transport */}
      {!isFullscreen && (
        <div className="media-volume-inline">
          <button className="media-mute-btn" onClick={handleMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? '\u{1F507}' : volume < 0.5 ? '\u{1F509}' : '\u{1F50A}'}
          </button>
          <input
            type="range" min="0" max="1" step="0.05"
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
          />
        </div>
      )}
    </div>
  );
};

export default NowPlaying;
