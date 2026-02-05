import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import Player from '../../Player/Player.jsx';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { TouchVolumeButtons, snapToTouchLevel, linearVolumeFromLevel, linearLevelFromVolume } from './TouchVolumeButtons.jsx';
import FitnessPlaylistSelector from './FitnessPlaylistSelector.jsx';
import '../FitnessSidebar.scss';
import { usePersistentVolume } from '../usePersistentVolume.js';
import { normalizeDuration } from '../../Player/utils/mediaIdentity.js';
import { guid } from '../../Player/lib/helpers.js';
import getLogger from '../../../lib/logging/Logger.js';

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



const FitnessMusicPlayer = forwardRef(({ selectedPlaylistId, videoPlayerRef, videoVolume }, ref) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const isPlayingRef = useRef(true); // Track current playing state for sync effects
  const audioPlayerRef = useRef(null);
  const wasPlayingBeforePauseRef = useRef(false);
  const loggedTrackRef = useRef(null);
  const titleContainerRef = useRef(null);
  const marqueeTextRef = useRef(null);
  const [scrollDistance, setScrollDistance] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [isVideoAvailable, setIsVideoAvailable] = useState(false);
  const touchHandledRef = useRef(false);
  const expansionCooldownRef = useRef(false);
  // BUG-04 Fix: Precise timestamp guarding for interaction transitions
  const mountTimeRef = useRef(performance.now());
  const interactionLockRef = useRef(0); // stores timestamp of last major UI transition
  
  const fitnessContext = useFitnessContext();
  const { videoPlayerPaused, voiceMemoOverlayState } = fitnessContext || {};
  const voiceMemoOpen = Boolean(voiceMemoOverlayState?.open);
  const playlists = fitnessContext?.plexConfig?.music_playlists || [];
  const setGlobalPlaylistId = fitnessContext?.setSelectedPlaylistId;
  const setMusicOverride = fitnessContext?.setMusicOverride;
  const musicEnabled = fitnessContext?.musicEnabled ?? true;
  const sessionInstance = fitnessContext?.fitnessSessionInstance;

  // Stable Plex client session ID - ensures music player has distinct X-Plex-Client-Identifier from video player
  const musicPlexSession = useMemo(() => `fitness-music-${guid()}`, []);

  // Expose pause/resume API for external callers (e.g., voice memo recording)
  useImperativeHandle(ref, () => ({
    pause: () => {
      if (audioPlayerRef.current) {
        wasPlayingBeforePauseRef.current = isPlaying;
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      }
    },
    resume: () => {
      if (audioPlayerRef.current && wasPlayingBeforePauseRef.current) {
        audioPlayerRef.current.play();
        setIsPlaying(true);
      }
    },
    isPlaying: () => isPlaying
  }), [isPlaying]);

  // Keep isPlayingRef in sync with state for use in effects
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Sync music player with video player pause state AND voice memo overlay
  // Music pauses when: video pauses OR voice memo opens
  // Music resumes when: video resumes AND voice memo is closed (if was playing before)
  useEffect(() => {
    if (!audioPlayerRef.current) return;

    const shouldPause = videoPlayerPaused || voiceMemoOpen;

    if (shouldPause) {
      // Store playing state before pausing (only if currently playing)
      if (isPlayingRef.current) {
        wasPlayingBeforePauseRef.current = true;
      }
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else if (wasPlayingBeforePauseRef.current) {
      // Resume only if it was playing before AND both video is playing and voice memo is closed
      audioPlayerRef.current.play();
      setIsPlaying(true);
      wasPlayingBeforePauseRef.current = false;
    }
  }, [videoPlayerPaused, voiceMemoOpen]);

  useEffect(() => {
    if (!selectedPlaylistId) {
      setControlsOpen(false);
    }
  }, [selectedPlaylistId]);

  // Measure text overflow for marquee scroll distance
  // Uses double-RAF to ensure measurement happens after paint, avoiding layout thrashing
  useEffect(() => {
    if (!titleContainerRef.current || !marqueeTextRef.current) return;

    let rafId = null;
    let innerRafId = null;

    const measureOverflow = () => {
      if (!titleContainerRef.current || !marqueeTextRef.current) return;

      const containerWidth = titleContainerRef.current.offsetWidth;
      const textWidth = marqueeTextRef.current.scrollWidth;
      const overflow = textWidth - containerWidth;

      // Only scroll if text overflows (negative value = scroll left by this amount)
      setScrollDistance(overflow > 0 ? -overflow : 0);
    };

    // Double RAF ensures measurement happens after browser paint
    rafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(measureOverflow);
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (innerRafId) cancelAnimationFrame(innerRafId);
    };
  }, [currentTrack?.title, currentTrack?.label]);

  const currentTrackIdentity = useMemo(() => {
    if (!currentTrack) return null;
    return currentTrack.key
      || currentTrack.plex
      || currentTrack.assetId
      || currentTrack.ratingKey
      || currentTrack.id
      || null;
  }, [currentTrack]);

  const musicVolumeState = usePersistentVolume({
    grandparentId: 'fitness-music',
    parentId: selectedPlaylistId || 'global',
    trackId: currentTrackIdentity || 'music',
    playerRef: audioPlayerRef
  });

  // Memoize Player props to prevent unnecessary useEffect re-runs in useQueueController
  // Without this, inline objects like queue={{}} and play={{}} are new refs on every render
  const playerQueueProp = useMemo(() => ({
    plex: selectedPlaylistId,
    shuffle: true
  }), [selectedPlaylistId]);

  const playerPlayProp = useMemo(() => ({
    volume: musicVolumeState.volume
  }), [musicVolumeState.volume]);

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

  // Clear current track when playlist changes (including switching between playlists)
  const prevPlaylistIdRef = useRef(selectedPlaylistId);
  useEffect(() => {
    if (prevPlaylistIdRef.current !== selectedPlaylistId) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Playlist Change] Clearing artwork:', {
          from: prevPlaylistIdRef.current,
          to: selectedPlaylistId
        });
      }
      setCurrentTrack(null);
      prevPlaylistIdRef.current = selectedPlaylistId;
    }
  }, [selectedPlaylistId]);

  const handleProgress = (progressData) => {
    // Update current track from progress data (Player handles queue internally)
    if (progressData?.media) {
      const mediaData = progressData.media;
      const newKey = mediaData.key || mediaData.plex || mediaData.assetId;

      setCurrentTrack(prev => {
        const prevKey = prev?.key || prev?.plex || prev?.assetId;
        // Only update if track actually changed
        if (newKey && newKey !== prevKey) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[Track Change] Detected via progress callback:', {
              prevKey,
              newKey,
              prevTitle: prev?.title,
              newTitle: mediaData?.title,
              artist: mediaData?.artist
            });
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
      mediaKey: currentTrack?.key || currentTrack?.assetId || null,
      durationSeconds,
      volume: Math.round((musicVolumeState.volume || 0) * 100) / 100,
      musicEnabled: Boolean(musicEnabled)
    });
  }, [sessionInstance, currentTrackIdentity, currentTrack, selectedPlaylistId, musicVolumeState.volume, musicEnabled]);

  const handleNext = (e) => {
    // Interaction Isolation
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      interactionLockRef.current = e.nativeEvent?.timeStamp || performance.now();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }

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
        getLogger().warn('fitness.music.advance_not_available');
      }
    }
  };

  const handleTogglePlayPause = (e) => {
    // Interaction Isolation
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }

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

  const toggleControls = (e = null) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      // Removed setPointerCapture - not needed for simple toggle and can interfere with touch events
    }

    setControlsOpen(prev => {
      const opening = !prev;
      // Mark transition timestamp to guard newly revealed UI
      interactionLockRef.current = e?.nativeEvent?.timeStamp || performance.now();
      return opening;
    });
  };

  const handlePlaylistButtonClick = (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      // Removed setPointerCapture - not needed for button click
    }

    // Ignore events that triggered before a transition (not during - allow same timestamp)
    const eventTime = e?.nativeEvent?.timeStamp || performance.now();
    if (eventTime < interactionLockRef.current) {
      return;
    }

    setPlaylistModalOpen(true);
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

  const handleInfoTap = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setControlsOpen(prev => {
      // Mark transition timestamp to guard newly revealed UI from accidental taps
      interactionLockRef.current = e?.nativeEvent?.timeStamp || performance.now();
      return !prev;
    });
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

  return (
    <div className={`fitness-music-player-container${controlsOpen ? ' controls-open' : ''}`}>
      <div className="music-player-content">
        {/* Album Art */}
        <div
          className={`music-player-artwork ${!isPlaying ? 'paused' : ''}`}
          onPointerDown={handleTogglePlayPause}
          style={{ cursor: 'pointer' }}
        >
          {(() => {
            const trackKey = currentTrack?.key || currentTrack?.plex || currentTrack?.assetId;
            const artworkKey = trackKey ? `${selectedPlaylistId}-${trackKey}` : null;
            if (process.env.NODE_ENV === 'development' && trackKey) {
              console.log('[Artwork Render]', { selectedPlaylistId, trackKey, artworkKey });
            }
            return trackKey ? (
              <img
                key={artworkKey}
                src={DaylightMediaPath(`api/v1/display/plex/${trackKey}`)}
                alt="Album artwork"
                className="artwork-image"
              />
            ) : (
              <div className="artwork-placeholder">
                <span className="artwork-icon">🎵</span>
              </div>
            );
          })()}
          {/* Play/Pause Overlay - only shows play icon when paused */}
          <div className="playback-overlay">
            <span className="playback-icon">▶</span>
          </div>
        </div>

        {/* Track Info & Progress */}
        <div
          className="music-player-info"
          onPointerDown={handleInfoTap}
          onKeyDown={handleInfoKeyDown}
          role="button"
          tabIndex={0}
          aria-expanded={controlsOpen}
        >
          <div className="track-details">
            <div className="track-title" ref={titleContainerRef}>
              <span
                className="marquee-text"
                ref={marqueeTextRef}
                style={{
                  '--scroll-distance': `${scrollDistance}px`,
                  '--marquee-play-state': scrollDistance < 0 ? 'running' : 'paused'
                }}
              >
                {currentTrack?.title || currentTrack?.label || 'Loading...'}
              </span>
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
              onPointerDown={handleNext}
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
                    onPointerDown={handlePlaylistButtonClick}
                  >
                    <span className="playlist-icon">🎵</span>
                    <span className="playlist-name">
                      {playlists.find(p => p.id === selectedPlaylistId)?.name || 'Select Playlist'}
                    </span>
                    <span className="playlist-arrow">▼</span>
                  </button>

                  <FitnessPlaylistSelector
                    playlists={playlists}
                    selectedPlaylistId={selectedPlaylistId}
                    isOpen={playlistModalOpen}
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
                </>
              ) : (
                <div className="empty-state">No playlists configured.</div>
              )}
            </div>
          </div>
              )}

              {/* Hidden Player Component - Player handles queue fetching and flattening */}
      <div style={{ position: 'absolute', left: '-9999px' }}>
        <Player
          ref={audioPlayerRef}
          key={selectedPlaylistId}
          queue={playerQueueProp}
          play={playerPlayProp}
          onProgress={handleProgress}
          playerType="audio"
          plexClientSession={musicPlexSession}
        />
      </div>
    </div>
  );
});

FitnessMusicPlayer.displayName = 'FitnessMusicPlayer';

export default FitnessMusicPlayer;
