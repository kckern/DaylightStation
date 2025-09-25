import React, { useState, useEffect, useRef } from 'react';
import { LoadingOverlay, Alert } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import './FitnessShow.scss';

// Utility function to format duration from seconds to mm:ss
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const FitnessShow = ({ showId, onBack }) => {
  const [showData, setShowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterRef = useRef(null);

  useEffect(() => {
    const fetchShowData = async () => {
      if (!showId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log(`🎬 DEBUG: Fetching show data for ID: ${showId}`);
        const response = await DaylightAPI(`/media/plex/list/${showId}/playable`);
        console.log('🎬 DEBUG: Show response:', JSON.stringify(response, null, 2));
        setShowData(response);
        
        // Auto-select first episode if available
        if (response.items && response.items.length > 0) {
          setSelectedEpisode(response.items[0]);
        }
      } catch (err) {
        console.error('🎬 ERROR: Error fetching show data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchShowData();
  }, [showId]);

  // Handle poster aspect ratio with JavaScript
  useEffect(() => {
    const updatePosterSize = () => {
      if (posterRef.current) {
        const width = posterRef.current.offsetWidth;
        const height = width * 1.5; // 2:1 aspect ratio (height = 2 * width)
        posterRef.current.style.height = `${height}px`;
        setPosterWidth(width); // Update state to trigger re-render
      }
    };

    // Initial size
    updatePosterSize();

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      updatePosterSize();
    });

    if (posterRef.current) {
      resizeObserver.observe(posterRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [showData]); // Re-run when showData changes

  const handleEpisodeSelect = (episode) => {
    setSelectedEpisode(episode);
  };

  const handlePlayEpisode = (episode) => {
    console.log('🎬 Play episode:', episode);
    // TODO: Implement play functionality
  };

  if (!showId) {
    return (
      <div className="fitness-show no-selection">
        <div className="no-selection-content">
          <div className="no-selection-icon">📺</div>
          <div className="no-selection-title">Select a Show</div>
          <div className="no-selection-text">Choose a fitness show from the menu to get started</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fitness-show loading">
        <LoadingOverlay visible={true} />
        <div className="loading-text">Loading show details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fitness-show error">
        <Alert color="red">
          Error loading show: {error}
        </Alert>
      </div>
    );
  }

  const { info, items = [] } = showData || {};

  return (
    <div className="fitness-show">


      <div className="show-content">
        {/* Left Panel - Show Info */}
        <div className="show-info-panel">
          {info && (
            <>
              {/* Show Image - Top 50% */}
              <div className="show-poster" ref={posterRef}>
                {info.image && (
                  <img 
                    src={info.image} 
                    alt={info.title} 
                    className="poster-image"
                    style={{
                      width: posterRef.current ? posterRef.current.offsetWidth : '100%',
                      height: posterRef.current ? `${posterRef.current.offsetWidth * 1.5}px` : 'auto'
                    }}
                  />
                )}
                <div className="poster-overlay">
                  <button 
                    className="play-button"
                    onClick={() => handlePlayEpisode(selectedEpisode)}
                    disabled={!selectedEpisode}
                  >
                    <span className="play-icon">▶️</span>
                    Play
                  </button>
                </div>
              </div>
              
              {/* Show Description - Bottom 50% */}
              <div className="show-description">
                <h1 className="show-title">{info.title}</h1>
                {info.tagline && <div className="show-tagline">{info.tagline}</div>}
                {info.summary && (
                  <p className="show-summary">{info.summary}</p>
                )}
                <div className="show-meta">
                  {info.year && <span className="meta-item">📅 {info.year}</span>}
                  {info.studio && <span className="meta-item">🏢 {info.studio}</span>}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Panel - Episodes List */}
        <div className="episodes-panel">
          <div className="episodes-section">
            {items.length > 0 ? (
              <div className="episodes-container">
                {/* Group episodes by season */}
                {Object.entries(
                  items.reduce((seasons, episode) => {
                    const seasonKey = episode.seasonName || 'Unknown Season';
                    if (!seasons[seasonKey]) seasons[seasonKey] = [];
                    seasons[seasonKey].push(episode);
                    return seasons;
                  }, {})
                ).map(([seasonName, seasonEpisodes]) => (
                  <div key={seasonName} className="season-group">
                    <h3 className="season-title">
                      <span className="season-icon">📁</span>
                      {seasonName}
                      <span className="episode-count">({seasonEpisodes.length} episodes)</span>
                    </h3>
                    <div className="episodes-grid">
                      {seasonEpisodes.map((episode, index) => (
                        <div 
                          key={episode.plex || index}
                          className={`episode-card ${selectedEpisode?.plex === episode.plex ? 'selected' : ''}`}
                          onClick={() => handleEpisodeSelect(episode)}
                          onDoubleClick={() => handlePlayEpisode(episode)}
                          title={episode.episodeDescription}
                        >
                    {episode.image && (
                      <div className="episode-thumbnail">
                        <img src={episode.image} alt={episode.label} />
                        <div className="thumbnail-overlay">
                          <button 
                            className="episode-play-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayEpisode(episode);
                            }}
                          >
                            ▶️
                          </button>
                        </div>
                      </div>
                    )}
                    
                    <div className="episode-info">
                      <h3 className="episode-title">{episode.label}</h3>
                      {episode.episodeDescription && (
                        <p className="episode-description">{episode.episodeDescription}</p>
                      )}
                      <div className="episode-meta">
                        {episode.seasonName && (
                          <span className="episode-season">
                            📁 {episode.seasonName}
                            {episode.episodeNumber && ` • E${episode.episodeNumber}`}
                          </span>
                        )}
                        {episode.duration && (
                          <span className="episode-duration">
                            ⏱️ {formatDuration(episode.duration)}
                          </span>
                        )}
                        <span className="episode-type">{episode.type}</span>
                      </div>
                    </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-episodes">
                <div className="no-episodes-icon">📺</div>
                <div className="no-episodes-title">No Episodes Found</div>
                <div className="no-episodes-text">This show doesn't have any available episodes</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FitnessShow;