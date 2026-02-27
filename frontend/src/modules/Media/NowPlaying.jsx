import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import MediaAppPlayer from './MediaAppPlayer.jsx';
import CastButton from './CastButton.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Main player view: player + track info + progress bar + transport controls + volume.
 *
 * Req: 1.2.4, 1.1.4, 1.1.5, 1.1.6, 1.1.7
 */
const NowPlaying = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, onQueueToggle, onSearchToggle, onDeviceToggle, queueLength }) => {
  const logger = useMemo(() => getLogger().child({ component: 'NowPlaying' }), []);
  const playerRef = useRef(null);

  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
  });
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Auto-fullscreen for video; reset on format change (8.2.2, 8.1.11)
  useEffect(() => {
    if (!currentItem) {
      setIsFullscreen(false);
      return;
    }
    setIsFullscreen(currentItem.format === 'video');
  }, [currentItem?.contentId, currentItem?.format]);

  const handleProgress = useCallback((data) => {
    setPlaybackState({
      currentTime: data.currentTime || 0,
      duration: data.duration || 0,
      paused: data.paused ?? true,
    });
    onPlaybackState?.(data);
  }, [onPlaybackState]);

  const handleToggle = useCallback(() => {
    playerRef.current?.toggle?.();
  }, []);

  const handleSeek = useCallback((e) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekTime = percent * playbackState.duration;
    playerRef.current?.seek?.(seekTime);
  }, [playbackState.duration]);

  const handleVolumeChange = useCallback((e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    const el = playerRef.current?.getMediaElement?.();
    if (el) el.volume = newVolume;
  }, []);

  const handleExitFullscreen = useCallback(() => setIsFullscreen(false), []);

  if (!currentItem) {
    return (
      <div className="media-now-playing media-now-playing--empty">
        <div className="media-empty-state">
          <p>Nothing playing</p>
          <p className="media-empty-hint">Use ?play=hymn:198 to start playback</p>
        </div>
      </div>
    );
  }

  const thumbnailUrl = currentItem.contentId
    ? ContentDisplayUrl(currentItem.contentId)
    : null;

  const progress = playbackState.duration > 0
    ? (playbackState.currentTime / playbackState.duration) * 100
    : 0;

  return (
    <div className="media-now-playing">
      {/* Player (may be embedded or fullscreen) */}
      <MediaAppPlayer
        ref={playerRef}
        contentId={currentItem.contentId}
        config={currentItem.config}
        onItemEnd={onItemEnd}
        onProgress={handleProgress}
        isFullscreen={isFullscreen}
        onExitFullscreen={handleExitFullscreen}
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
          {currentItem.source && (
            <div className="media-track-source">{currentItem.source}</div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="media-progress" onClick={handleSeek}>
        <div className="media-progress-bar">
          <div
            className="media-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="media-progress-times">
          <span>{formatTime(playbackState.currentTime)}</span>
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
        {onSearchToggle && (
          <button className="media-transport-btn" onClick={onSearchToggle} aria-label="Search">
            &#128269;
          </button>
        )}
        {currentItem && <CastButton contentId={currentItem.contentId} className="media-transport-btn" />}
        {onDeviceToggle && (
          <button className="media-transport-btn" onClick={onDeviceToggle} aria-label="Devices">
            &#x1F4F1;
          </button>
        )}
        {onQueueToggle && (
          <button className="media-transport-btn" onClick={onQueueToggle} aria-label="Queue">
            &#9776; {queueLength > 0 && <span className="queue-badge">{queueLength}</span>}
          </button>
        )}
      </div>

      {/* Volume */}
      <div className="media-volume">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
      </div>
    </div>
  );
};

export default NowPlaying;
