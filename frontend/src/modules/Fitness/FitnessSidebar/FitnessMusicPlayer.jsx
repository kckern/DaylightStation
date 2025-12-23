import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../lib/api.mjs';
import Player from '../../Player/Player.jsx';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { TouchVolumeButtons, snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from './TouchVolumeButtons.jsx';
import FitnessPlaylistSelector from './FitnessPlaylistSelector.jsx';
import '../FitnessCam.scss';
import { usePersistentVolume } from '../usePersistentVolume.js';
import { normalizeDuration } from '../../Player/utils/mediaIdentity.js';
import { guid } from '../../Player/lib/helpers.js';

const LOG_CURVE_TARGET_LEVEL = 50; // midpoint of the touch buttons
const LOG_CURVE_TARGET_VOLUME = 0.1; // 10% output should align with midpoint
const LOG_CURVE_EXPONENT_PER_LEVEL = (() => {
  const denominator = LOG_CURVE_TARGET_LEVEL - 100; // negative value
  const numerator = Math.log10(Math.max(0.0001, LOG_CURVE_TARGET_VOLUME)); // avoid log10(0)
  if (denominator === 0) return -0.01; // fallback to gentle slope
  return numerator / denominator;
})();

const logVolumeFromLevel = (level) => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const exponent = (level - 100) * LOG_CURVE_EXPONENT_PER_LEVEL;
  return Math.min(1, Math.max(0, Math.pow(10, exponent)));
};

const logLevelFromVolume = (volume) => {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const percent = 100 + (Math.log10(volume) / (LOG_CURVE_EXPONENT_PER_LEVEL || -0.01));
  return Math.min(100, Math.max(0, Math.round(percent)));
};



const FitnessMusicPlayer = ({ selectedPlaylistId, videoPlayerRef, videoVolume }) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playQueueData, setPlayQueueData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const audioPlayerRef = useRef(null);
  const loggedTrackRef = useRef(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [isVideoAvailable, setIsVideoAvailable] = useState(false);
  const touchHandledRef = useRef(false);
  
  const fitnessContext = useFitnessContext();
  const { videoPlayerPaused } = fitnessContext || {};
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];
  const setGlobalPlaylistId = fitnessContext?.setSelectedPlaylistId;
  const setMusicOverride = fitnessContext?.setMusicOverride;
  const musicEnabled = fitnessContext?.musicEnabled ?? true;
  const sessionInstance = fitnessContext?.fitnessSessionInstance;

  // Stable Plex client session ID - ensures music player has distinct X-Plex-Client-Identifier from video player
  const musicPlexSession = useMemo(() => `fitness-music-${guid()}`, []);

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

  const currentTrackIdentity = useMemo(() => {
    if (!currentTrack) return null;
    return currentTrack.key
      || currentTrack.plex
      || currentTrack.media_key
      || currentTrack.ratingKey
      || currentTrack.id
      || null;
  }, [currentTrack]);

  const musicVolumeState = usePersistentVolume({
    showId: 'fitness-music',
    seasonId: selectedPlaylistId || 'global',
    trackId: currentTrackIdentity || 'music',
    playerRef: audioPlayerRef
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    
    if (!videoPlayerRef) {
      setIsVideoAvailable(false);
      return;
    }

    let frameId = null;
    // Poll until the fitness video exposes its media element so the slider can mirror the live volume.
    const probeVideoElement = () => {
      if (!videoPlayerRef?.current) {
        setIsVideoAvailable(false);
        frameId = window.requestAnimationFrame(probeVideoElement);
        return;
      }
      const media = videoPlayerRef.current.getMediaElement?.();
      if (!media) {
        setIsVideoAvailable(false);
        frameId = window.requestAnimationFrame(probeVideoElement);
        return;
      }
      setIsVideoAvailable(true);
      videoVolume?.applyToPlayer?.();
    };
    probeVideoElement();
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [videoPlayerRef, videoVolume]);

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
          // Search in the original queue data as it's immutable
          const fullTrackData = playQueueData?.find(track => {
            const trackKey = track.key || track.plex || track.media_key;
            return trackKey === newKey;
          });
          
          if (fullTrackData) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[Track Change] Detected via progress callback:', {
                prevKey,
                newKey,
                prevTitle: prev?.title,
                newTitle: fullTrackData?.title,
                artist: fullTrackData?.artist
              });
            }
            return fullTrackData;
          }
          // Fallback: use media data from progress if not found in queue
          // This can happen when Player auto-advances and we don't have full metadata
          if (process.env.NODE_ENV === 'development') {
            console.log('[Track Change] Using progress media data (not in queue):', newKey);
          }
          return mediaData;
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

  useEffect(() => {
    if (!sessionInstance || typeof sessionInstance.logEvent !== 'function') {
      return;
    }
    if (!currentTrackIdentity) {
      loggedTrackRef.current = null;
      return;
    }
    if (loggedTrackRef.current === currentTrackIdentity) {
      return;
    }
    loggedTrackRef.current = currentTrackIdentity;
    const durationSeconds = normalizeDuration(
      currentTrack?.duration,
      currentTrack?.length,
      currentTrack?.Duration
    );
    sessionInstance.logEvent('media_start', {
      source: 'music_player',
      mediaId: currentTrackIdentity,
      title: currentTrack?.title || currentTrack?.label || null,
      artist: currentTrack?.artist || currentTrack?.albumArtist || currentTrack?.grandparentTitle || null,
      album: currentTrack?.album || currentTrack?.parentTitle || null,
      playlistId: selectedPlaylistId || null,
      plexId: currentTrack?.plex || null,
      mediaKey: currentTrack?.key || currentTrack?.media_key || null,
      durationSeconds,
      volume: Math.round((musicVolumeState.volume || 0) * 100) / 100,
      musicEnabled: Boolean(musicEnabled)
    });
  }, [sessionInstance, currentTrackIdentity, currentTrack, selectedPlaylistId, musicVolumeState.volume, musicEnabled]);

  const handleNext = () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Next] Button clicked');
    }
    // Use Player's advance API instead of mutating local queue state
    // This keeps the Player's internal index in sync with our state
    if (typeof audioPlayerRef.current?.advance === 'function') {
      audioPlayerRef.current.advance(1);
      // Reset progress display - currentTrack will be updated via handleProgress callback
      setProgress(0);
      setDuration(0);
    } else {
      // Log warning - Player.advance() should always be available
      // DO NOT mutate queue here - it causes desync between Player internal state and local state
      // Instead, let handleProgress() handle track updates when Player auto-advances
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FitnessMusicPlayer] Player.advance() not available - track change will occur via progress callback');
      }
    }
  };

  const handleTogglePlayPause = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.toggle();
      // Update local state to reflect the toggle
      setIsPlaying(prev => !prev);
    }
  };

  const videoDisplayLevel = useMemo(
    () => snapToTouchLevel(linearLevelFromVolume(videoVolume?.volume)),
    [videoVolume?.volume]
  );
  const musicDisplayLevel = useMemo(
    () => snapToTouchLevel(logLevelFromVolume(musicVolumeState.volume)),
    [musicVolumeState.volume]
  );

  const handleVideoLevelSelect = (level) => {
    videoVolume?.setVolume?.(linearVolumeFromLevel(level));
  };

  const handleMusicLevelSelect = (level) => {
    musicVolumeState.setVolume(logVolumeFromLevel(level));
  };

  const toggleControls = () => {
    setControlsOpen(prev => !prev);
  };

  const handleMusicToggle = useCallback(() => {
    if (setMusicOverride) {
      setMusicOverride(!musicEnabled);
      return;
    }
    if (setGlobalPlaylistId) {
      setGlobalPlaylistId(null);
    }
  }, [setMusicOverride, musicEnabled, setGlobalPlaylistId]);

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

  useEffect(() => {
    if (musicMediaAvailable) {
      musicVolumeState.applyToPlayer();
    }
  }, [musicMediaAvailable, musicVolumeState]);

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
              {isVideoAvailable && (
                <div className="mix-row">
                  <label id="video-volume-label" className="mix-label">Video Volume: {Math.round((videoVolume?.volume || 0) * 100)}%

                  </label>
                  <div className="mix-controls">
                    <TouchVolumeButtons
                      controlId="video-volume"
                      currentLevel={videoDisplayLevel}
                      disabled={!isVideoAvailable}
                      onSelect={handleVideoLevelSelect}
                    />
                  </div>
                </div>
              )}
              <div className="mix-row">
                <label id="music-volume-label" className="mix-label">Music Volume: {Math.round((musicVolumeState.volume || 0) * 100)}%

                </label>
                <div className="mix-controls">
            <TouchVolumeButtons
              controlId="music-volume"
              currentLevel={musicDisplayLevel}
              disabled={!musicMediaAvailable}
              onSelect={handleMusicLevelSelect}
            />
                </div>
              </div>
            </div>
            <div className="expanded-section">
              {playlists.length > 0 ? (
                <>
                  <button 
                    className="current-playlist-button"
                    onClick={() => setPlaylistModalOpen(true)}
                  >
                    <span className="playlist-icon">🎵</span>
                    <span className="playlist-name">
                      {playlists.find(p => p.id === selectedPlaylistId)?.name || 'Select Playlist'}
                    </span>
                    <span className="playlist-arrow">▼</span>
                  </button>

                  {playlistModalOpen && (
                    <div className="playlist-modal-overlay" onClick={() => setPlaylistModalOpen(false)}>
                      <div className="playlist-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="playlist-modal-header">
                          <h3>Select Playlist</h3>
                          <button className="close-btn" onClick={() => setPlaylistModalOpen(false)}>×</button>
                        </div>
                        <FitnessPlaylistSelector
                          playlists={playlists}
                          selectedPlaylistId={selectedPlaylistId}
                          onSelect={(id) => {
                            if (!id) {
                              handleMusicToggle();
                            } else if (setGlobalPlaylistId) {
                              setGlobalPlaylistId(id);
                            }
                            setPlaylistModalOpen(false);
                            setControlsOpen(false);
                          }}
                          onClose={() => setPlaylistModalOpen(false)}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">No playlists configured.</div>
              )}
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
            play={{ volume: musicVolumeState.volume }}
            onProgress={handleProgress}
            playerType="audio"
            plexClientSession={musicPlexSession}
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
