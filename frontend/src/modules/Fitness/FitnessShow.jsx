import React, { useState, useEffect, useRef, useMemo } from 'react';
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

// Utility function to format duration for badges (rounded minutes)
const formatDurationBadge = (seconds) => {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
};

const FitnessShow = ({ showId, onBack }) => {
  const [showData, setShowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterRef = useRef(null);
  const [activeSeasonId, setActiveSeasonId] = useState(null);

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

  const { info, items = [] } = showData || {};

  // Derive seasons from items (episodes)
  const seasons = useMemo(() => {
    const map = new Map();
    for (const ep of items) {
      if (!ep.seasonId) continue;
      if (!map.has(ep.seasonId)) {
        map.set(ep.seasonId, {
          id: ep.seasonId,
          name: ep.seasonName || `Season ${ep.seasonNumber ?? ''}`.trim(),
          // Use first episode's image as season image (best available without extra calls)
          image: ep.image,
          count: 1,
        });
      } else {
        const cur = map.get(ep.seasonId);
        cur.count += 1;
        // Prefer first available image; keep existing
      }
    }
    // Sort by numeric seasonId if possible
    return Array.from(map.values()).sort((a, b) => {
      const na = Number(a.id), nb = Number(b.id);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [items]);

  // Initialize/adjust active season when items or seasons change
  useEffect(() => {
    if (seasons.length > 1) {
      // Default to first season (sorted)
      setActiveSeasonId((prev) => (prev && seasons.find(s => s.id === prev) ? prev : seasons[0].id));
    } else {
      setActiveSeasonId(null);
    }
  }, [seasons]);

  // Keep selected episode in sync with filter
  useEffect(() => {
    const filtered = seasons.length > 1 && activeSeasonId
      ? items.filter(ep => ep.seasonId === activeSeasonId)
      : items;
    if (filtered.length && (!selectedEpisode || !filtered.some(ep => ep.plex === selectedEpisode.plex))) {
      setSelectedEpisode(filtered[0]);
    }
  }, [items, seasons, activeSeasonId]);

  const filteredItems = useMemo(() => {
    if (seasons.length > 1 && activeSeasonId) {
      return items.filter(ep => ep.seasonId === activeSeasonId);
    }
    return items;
  }, [items, seasons, activeSeasonId]);

  // Early return UI states (after all hooks above to keep hook order stable)
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
            {filteredItems.length > 0 ? (
              <div className="episodes-container">
                {/* Group episodes by season */}
                {Object.entries(
                  filteredItems.reduce((seasonsMap, episode) => {
                    const seasonKey = episode.seasonName || 'Unknown Season';
                    if (!seasonsMap[seasonKey]) seasonsMap[seasonKey] = [];
                    seasonsMap[seasonKey].push(episode);
                    return seasonsMap;
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
                        
                        {/* Corner Badges */}
                        <div className="thumbnail-badges">
                          {/* Top Left - Watched Status (placeholder) */}
                          <div className="badge watched">
                            {/* Future: watched indicator */}
                          </div>
                          
                          {/* Top Right - Up Next Status (placeholder) */}
                          <div className="badge up-next">
                            {/* Future: up next indicator */}
                          </div>
                          
                          {/* Bottom Left - Custom Status (placeholder) */}
                          <div className="badge custom-status">
                            {/* Future: custom status */}
                          </div>
                          
                          {/* Bottom Right - Duration */}
                          <div className="badge duration">
                            {episode.duration && formatDurationBadge(episode.duration)}
                          </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="thumbnail-progress">
                          {/* Future: dynamic progress based on watch status */}
                          <div className="progress-bar" style={{ width: '50%' }}></div>
                        </div>
                        
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
                      {episode.label && (
                        <p className="episode-description">
                          <b>{episode.label}</b><span>{episode.episodeDescription && <>{"—"}<i>{episode.episodeDescription}</i></>}</span>
                        </p>
                      )}
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
          {/* Season filter bar (shows only when more than one season) */}
          {seasons.length > 1 && (
            <div className="season-filter-bar">
              {seasons.map((s, idx) => (
                <button
                  key={s.id}
                  className={`season-item ${activeSeasonId === s.id ? 'active' : ''}`}
                  onClick={() => setActiveSeasonId(s.id)}
                >
                  <div className="season-image-wrapper">
                    {s.image ? (
                      <img src={s.image} alt={s.name} className="season-image" />
                    ) : (
                      <div className="season-image placeholder">S</div>
                    )}
                    <div className="season-index">{idx + 1}</div>
                  </div>
                  <div className="season-name" title={s.name}>{s.name || 'Season'}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FitnessShow;