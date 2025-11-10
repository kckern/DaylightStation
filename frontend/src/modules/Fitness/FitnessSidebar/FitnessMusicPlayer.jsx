import React, { useState, useEffect, useMemo } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../lib/api.mjs';
import Player from '../../Player/Player.jsx';
import '../FitnessUsers.scss';

const FitnessMusicPlayer = ({ selectedPlaylistId }) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playQueueData, setPlayQueueData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);

  const playConfig = useMemo(() => ({ volume: 0.1, paused: !isPlaying }), [isPlaying]);

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
        
        if (response && response.items) {
          console.log('[Playlist] Loaded new playlist:', {
            itemCount: response.items.length,
            firstTrack: response.items[0]?.title
          });
          setPlayQueueData(response.items);
          // Set first track as current
          if (response.items.length > 0) {
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

    // Update current track from the media metadata first
    if (progressData?.media) {
      const mediaData = progressData.media;
      const newKey = mediaData.key || mediaData.plex || mediaData.media_key;
      
      setCurrentTrack(prev => {
        const prevKey = prev?.key || prev?.plex || prev?.media_key;
        // Only update if actually changed
        if (newKey !== prevKey) {
          console.log('[Track Change] Detected:', {
            prevKey,
            newKey,
            prevTitle: prev?.title,
            newTitle: mediaData?.title
          });
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
    setIsPlaying(prev => !prev);
  };

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
          <div className="empty-text">Select a playlist from the menu</div>
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
    <div className="fitness-music-player-container">
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
        <div className="music-player-info">
          <div className="track-details">
            <div className="track-title">
              {currentTrack?.title || currentTrack?.label || 'No track playing'}
            </div>
            <div className="track-artist">
              {currentTrack?.artist || currentTrack?.albumArtist || currentTrack?.grandparentTitle || currentTrack?.parentTitle || ''}
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

      {/* Hidden Player Component */}
      {playQueueData && playQueueData.length > 0 ? (
        <div style={{ position: 'absolute', left: '-9999px' }}>
          <Player
            key={selectedPlaylistId} // Remount only when playlist ID changes
            queue={playQueueData}
            play={playConfig}
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
