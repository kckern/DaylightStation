import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../lib/api.mjs';
import Player from '../../Player/Player.jsx';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import '../FitnessUsers.scss';

const TOUCH_VOLUME_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const snapToTouchLevel = (percent) => {
  if (!Number.isFinite(percent)) return 0;
  return TOUCH_VOLUME_LEVELS.reduce((closest, level) => (
    Math.abs(level - percent) < Math.abs(closest - percent) ? level : closest
  ), TOUCH_VOLUME_LEVELS[0]);
};

const linearVolumeFromLevel = (level) => {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / 100));
};

const linearLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume * 100)));
};

const logVolumeFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const exponent = (level - 100) / 50;
  return Math.min(1, Math.max(0, Math.pow(10, exponent)));
};

const logLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const percent = 100 + 50 * Math.log10(volume);
  return Math.min(100, Math.max(0, Math.round(percent)));
};

const TouchVolumeButtons = ({ controlId, currentLevel, disabled, onSelect }) => (
  <div
    className={`touch-volume ${disabled ? 'disabled' : ''}`}
    role="group"
    aria-disabled={disabled}
    aria-labelledby={`${controlId}-label`}
  >
    {TOUCH_VOLUME_LEVELS.map((level) => {
      const isActive = level === currentLevel;
      const isOn = currentLevel > 0 && level > 0 && level <= currentLevel;
      const className = [
        'touch-volume-button',
        isOn ? 'on' : 'off',
        isActive ? 'active' : ''
      ].filter(Boolean).join(' ');
      return (
        <button
          key={level}
          type="button"
          className={className}
          onTouchStart={() => !disabled && onSelect(level)}
          onClick={() => !disabled && onSelect(level)}
          disabled={disabled}
          aria-pressed={isActive}
          aria-label={level === 0 ? 'Mute / Off' : `${level}% volume`}
        />
      );
    })}
  </div>
);

const FitnessMusicPlayer = ({ selectedPlaylistId, videoPlayerRef }) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playQueueData, setPlayQueueData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const audioPlayerRef = useRef(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.1);
  const [videoVolume, setVideoVolume] = useState(1);
  const touchHandledRef = useRef(false);
  
  const fitnessContext = useFitnessContext();
  const { videoPlayerPaused } = fitnessContext || {};
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];
  const setGlobalPlaylistId = fitnessContext?.setSelectedPlaylistId;

  // Sync music player with video player pause state
  useEffect(() => {
    if (videoPlayerPaused !== undefined && audioPlayerRef.current) {
      if (videoPlayerPaused) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [videoPlayerPaused]);

  useEffect(() => {
    if (!selectedPlaylistId) {
      setControlsOpen(false);
    }
  }, [selectedPlaylistId]);

  const applyMusicVolume = useCallback((volume) => {
    const media = audioPlayerRef.current?.getMediaElement?.();
    if (media && typeof media.volume === 'number') {
      media.volume = volume;
    }
  }, []);

  const applyVideoVolume = useCallback((volume) => {
    if (!videoPlayerRef?.current) return;
    const media = videoPlayerRef.current.getMediaElement?.();
    if (media && typeof media.volume === 'number') {
      media.volume = volume;
    }
  }, [videoPlayerRef]);

  useEffect(() => {
    applyMusicVolume(musicVolume);
  }, [musicVolume, applyMusicVolume]);

  useEffect(() => {
    applyMusicVolume(musicVolume);
  }, [playQueueData, applyMusicVolume, musicVolume]);

  useEffect(() => {
    applyVideoVolume(videoVolume);
  }, [videoVolume, applyVideoVolume]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frameId = null;
    // Poll until the fitness video exposes its media element so the slider can mirror the live volume.
    const probeVideoElement = () => {
      if (!videoPlayerRef?.current) return;
      const media = videoPlayerRef.current.getMediaElement?.();
      if (!media) {
        frameId = window.requestAnimationFrame(probeVideoElement);
        return;
      }
      if (typeof media.volume === 'number') {
        setVideoVolume(media.volume);
      }
    };
    probeVideoElement();
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [videoPlayerRef]);

  // Load playlist when selectedPlaylistId changes
  useEffect(() => {
    if (!selectedPlaylistId) {
      setPlayQueueData(null);
      setCurrentTrack(null);
      return;
    }

    const loadPlaylist = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch playlist data from the media API
        // Use path-based shuffle instead of query param to avoid polluting item data
        const response = await DaylightAPI(`/media/plex/list/${selectedPlaylistId}/playable,shuffle`);
        
        console.log('[Playlist] Raw API response:', response);
        
        if (response && response.items) {
          console.log('[Playlist] Loaded new playlist:', {
            itemCount: response.items.length,
            firstTrack: response.items[0]?.title,
            firstTrackData: response.items[0]
          });
          setPlayQueueData(response.items);
          // Set first track as current
          if (response.items.length > 0) {
            console.log('[Playlist] Setting initial track:', response.items[0]);
            setCurrentTrack(response.items[0]);
          }
        }
      } catch (err) {
        console.error('Error loading playlist:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadPlaylist();
  }, [selectedPlaylistId]);

  const handleProgress = (progressData) => {
    // Update current track key if changed, but keep original track data from queue
    if (progressData?.media) {
      const mediaData = progressData.media;
      const newKey = mediaData.key || mediaData.plex || mediaData.media_key;
      
      setCurrentTrack(prev => {
        const prevKey = prev?.key || prev?.plex || prev?.media_key;
        // Only update if track actually changed
        if (newKey && newKey !== prevKey) {
          // Find the full track data from playQueueData instead of using minimal progressData.media
          const fullTrackData = playQueueData?.find(track => {
            const trackKey = track.key || track.plex || track.media_key;
            return trackKey === newKey;
          });
          
          if (fullTrackData) {
            console.log('[Track Change] Detected:', {
              prevKey,
              newKey,
              prevTitle: prev?.title,
              newTitle: fullTrackData?.title,
              artist: fullTrackData?.artist
            });
            return fullTrackData;
          }
        }
        return prev;
      });
    }
    
    // Update progress bar
    if (progressData?.currentTime !== undefined) {
      setProgress(progressData.currentTime);
    }
    if (progressData?.duration !== undefined) {
      setDuration(progressData.duration);
    }
  };

  const handleNext = () => {
    console.log('[Next] Button clicked');
    setPlayQueueData(prevQueue => {
      if (!prevQueue || prevQueue.length <= 1) {
        return prevQueue;
      }

      const nextQueue = prevQueue.slice(1);
      const nextTrack = nextQueue[0];
      if (nextTrack) {
        setCurrentTrack(nextTrack);
        setProgress(0);
        setDuration(0);
      }

      return nextQueue;
    });
  };

  const handleTogglePlayPause = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.toggle();
      // Update local state to reflect the toggle
      setIsPlaying(prev => !prev);
    }
  };

  const videoDisplayLevel = useMemo(() => snapToTouchLevel(linearLevelFromVolume(videoVolume)), [videoVolume]);
  const musicDisplayLevel = useMemo(() => snapToTouchLevel(logLevelFromVolume(musicVolume)), [musicVolume]);

  const handleVideoLevelSelect = (level) => {
    setVideoVolume(linearVolumeFromLevel(level));
  };

  const handleMusicLevelSelect = (level) => {
    setMusicVolume(logVolumeFromLevel(level));
  };

  const handlePlaylistChange = (event) => {
    const nextId = event.target.value || null;
    if (setGlobalPlaylistId) {
      setGlobalPlaylistId(nextId);
    }
  };

  const toggleControls = () => {
    setControlsOpen(prev => !prev);
  };

  const handleInfoTouchStart = () => {
    // Touch events trigger an extra click; mark so we skip the follow-up click handler.
    touchHandledRef.current = true;
    toggleControls();
  };

  const handleInfoClick = () => {
    if (touchHandledRef.current) {
      touchHandledRef.current = false;
      return;
    }
    toggleControls();
  };

  const handleInfoKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleControls();
    }
  };

  const videoMediaAvailable = Boolean(videoPlayerRef?.current?.getMediaElement?.());
  const musicMediaAvailable = Boolean(audioPlayerRef.current?.getMediaElement?.());

  const formatTime = (seconds) => {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // If no playlist is selected, show a message
  if (!selectedPlaylistId) {
    return (
      <div className="fitness-music-player-container">
        <div className="music-player-empty">
          <div className="empty-icon">🎵</div>
          <div className="empty-text">Choose a playlist to get started</div>
        </div>
      </div>
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="fitness-music-player-container">
        <div className="music-player-empty">
          <div className="empty-icon">⏳</div>
          <div className="empty-text">Loading playlist...</div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="fitness-music-player-container">
        <div className="music-player-empty">
          <div className="empty-icon">⚠️</div>
          <div className="empty-text">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fitness-music-player-container${controlsOpen ? ' controls-open' : ''}`}>
      <div className="music-player-content">
        {/* Album Art */}
        <div 
          className={`music-player-artwork ${!isPlaying ? 'paused' : ''}`}
          onClick={handleTogglePlayPause} 
          style={{ cursor: 'pointer' }}
        >
          {currentTrack?.key || currentTrack?.plex || currentTrack?.media_key ? (
            <img 
              key={currentTrack.key || currentTrack.plex || currentTrack.media_key}
              src={DaylightMediaPath(`media/plex/img/${currentTrack.key || currentTrack.plex || currentTrack.media_key}`)} 
              alt="Album artwork"
              className="artwork-image"
            />
          ) : (
            <div className="artwork-placeholder">
              <span className="artwork-icon">🎵</span>
            </div>
          )}
          {/* Play/Pause Overlay - only shows play icon when paused */}
          <div className="playback-overlay">
            <span className="playback-icon">▶</span>
          </div>
        </div>

        {/* Track Info & Progress */}
        <div 
          className="music-player-info"
          onClick={handleInfoClick}
          onTouchStart={handleInfoTouchStart}
          onKeyDown={handleInfoKeyDown}
          role="button"
          tabIndex={0}
          aria-expanded={controlsOpen}
        >
          <div className="track-details">
            <div className="track-title">
              {currentTrack?.title || currentTrack?.label || 'No track playing'}
            </div>
            <div className="track-artist">
              {(() => {
                const artist = currentTrack?.artist || currentTrack?.albumArtist || currentTrack?.grandparentTitle || currentTrack?.parentTitle || '';
               // console.log('[Artist Debug]', { currentTrack, artist });
                return artist;
              })()}
            </div>
          </div>
          
          <div className="track-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : '0%' }}
              />
            </div>
            <div className="progress-time">
              <span>{formatTime(progress)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* Next Button */}
        <div className="music-player-controls">
          <button 
            className="control-button next-button"
            onClick={handleNext}
            title="Next track"
          >
            <span className="control-icon">⏭</span>
          </button>
        </div>
      </div>

      {controlsOpen && (
        <div className="music-player-expanded">
          <div className="expanded-section">
            {playlists.length > 0 ? (
              <>
                <label htmlFor="fitness-playlist-select" className="mix-label mix-label--top">Playlist</label>
                <select
                  id="fitness-playlist-select"
                  className="playlist-select"
                  value={selectedPlaylistId || ''}
                  onChange={handlePlaylistChange}
                >
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                     🎵 {playlist.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <div className="empty-state">No playlists configured.</div>
            )}
          </div>

          <div className="expanded-section">
            <div className="mix-row">
              <label id="video-volume-label" className="mix-label">Video Volume</label>
              <div className="mix-controls">
                <TouchVolumeButtons
                  controlId="video-volume"
                  currentLevel={videoDisplayLevel}
                  disabled={!videoMediaAvailable}
                  onSelect={handleVideoLevelSelect}
                />
                <span className="mix-value">{Math.round(videoVolume * 100)}%</span>
              </div>
            </div>
            <div className="mix-row">
              <label id="music-volume-label" className="mix-label">Music Volume</label>
              <div className="mix-controls">
                <TouchVolumeButtons
                  controlId="music-volume"
                  currentLevel={musicDisplayLevel}
                  disabled={!musicMediaAvailable}
                  onSelect={handleMusicLevelSelect}
                />
                <span className="mix-value">{Math.round(musicVolume * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Player Component */}
      {playQueueData && playQueueData.length > 0 ? (
        <div style={{ position: 'absolute', left: '-9999px' }}>
          <Player
            ref={audioPlayerRef}
            key={selectedPlaylistId} // Remount only when playlist ID changes
            queue={playQueueData}
            play={{ volume: musicVolume }}
            onProgress={handleProgress}
            playerType="audio"
          />
        </div>
      ) : (
        <div style={{ fontSize: '0.7rem', color: 'red', padding: '1ex' }}>
          No queue data
        </div>
      )}
    </div>
  );
};

export default FitnessMusicPlayer;
