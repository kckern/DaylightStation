import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LoadingOverlay, Alert } from '@mantine/core';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
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

const FitnessShow = ({ showId, onBack, viewportRef }) => {
  const [showData, setShowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterRef = useRef(null);
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const seasonBarRef = useRef(null);
  const [seasonBarWidth, setSeasonBarWidth] = useState(0);

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

  // Track season filter bar width to compute dynamic height that ensures all items fit
  useEffect(() => {
    if (!seasonBarRef.current) return;
    const el = seasonBarRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSeasonBarWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    // Initial measure
    setSeasonBarWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [seasonBarRef.current]);

  // Derive viewport dimensions if provided, to avoid using window
  const viewportSize = useMemo(() => {
    const el = viewportRef?.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [viewportRef?.current, seasonBarWidth]);

  const handleEpisodeSelect = (episode) => {
    setSelectedEpisode(episode);
  };

  const handlePlayEpisode = (episode) => {
    console.log('🎬 Play episode:', episode);
    // TODO: Implement play functionality
  };

  const { info, items = [] } = showData || {};

  // Derive seasons from items (episodes), track seasonNumber for sorting/labels
  const seasons = useMemo(() => {
    const map = new Map();
    for (const ep of items) {
      if (!ep.seasonId) continue;
      const number = Number.isFinite(ep.seasonNumber) ? ep.seasonNumber : (ep.seasonNumber != null ? parseInt(ep.seasonNumber) : undefined);
      const image = ep.seasonThumbUrl || ep.image;
      if (!map.has(ep.seasonId)) {
        map.set(ep.seasonId, {
          id: ep.seasonId,
          number: Number.isNaN(number) ? undefined : number,
          rawName: ep.seasonName,
          image,
          count: 1,
        });
      } else {
        const cur = map.get(ep.seasonId);
        cur.count += 1;
        if (!cur.image && image) cur.image = image;
        if (cur.number == null && number != null && !Number.isNaN(number)) cur.number = number;
        if (!cur.rawName && ep.seasonName) cur.rawName = ep.seasonName;
      }
    }
    // Build final array and names: prefer numeric label Season N
    const arr = Array.from(map.values()).map(s => ({
      ...s,
      name: (Number.isFinite(s.number) && s.number > 0)
        ? `Season ${s.number}`
        : (s.rawName || (Number.isFinite(s.number) ? `Season ${s.number}` : 'Season')),
    }));
    // Sort by seasonNumber when available, fallback to id then name
    arr.sort((a, b) => {
      const an = a.number, bn = b.number;
      const aHas = Number.isFinite(an), bHas = Number.isFinite(bn);
      if (aHas && bHas && an !== bn) return an - bn;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      const na = Number(a.id), nb = Number(b.id);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    return arr;
  }, [items]);

  // Initialize/adjust active season when items or seasons change
  useEffect(() => {
    if (seasons.length > 1) {
      // Prefer Season 1 if present; otherwise first sorted season
      const seasonOne = seasons.find(s => s.number === 1);
      const fallbackId = seasonOne ? seasonOne.id : seasons[0].id;
      setActiveSeasonId(prev => (prev && seasons.some(s => s.id === prev)) ? prev : fallbackId);
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
    const list = (seasons.length > 1 && activeSeasonId)
      ? items.filter(ep => ep.seasonId === activeSeasonId)
      : items;
    // Sort by episodeNumber ascending when available
    return [...list].sort((a, b) => {
      const an = Number.isFinite(a.episodeNumber) ? a.episodeNumber : (a.episodeNumber != null ? parseInt(a.episodeNumber) : NaN);
      const bn = Number.isFinite(b.episodeNumber) ? b.episodeNumber : (b.episodeNumber != null ? parseInt(b.episodeNumber) : NaN);
      const aHas = !Number.isNaN(an), bHas = !Number.isNaN(bn);
      if (aHas && bHas && an !== bn) return an - bn;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
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
                {/* Group episodes by season, render in sorted season order */}
                {seasons.map((s) => {
                  const seasonEpisodes = filteredItems.filter(ep => ep.seasonId === s.id);
                  if (!seasonEpisodes.length) return null;
                  const title = Number.isFinite(s.number) && s.number > 0 ? `Season ${s.number}` : (s.rawName || s.name || 'Season');
                  return (
                    <div key={s.id} className="season-group">
                      <h3 className="season-title">
                        <span className="season-icon">📁</span>
                        {title}
                        <span className="episode-count">({seasonEpisodes.length} episodes)</span>
                      </h3>
                      <div className={`episodes-grid ${(() => {
                        const n = seasonEpisodes.length;
                        if (n <= 1) return 'zoom-400';
                        if (n <= 3) return 'zoom-300';
                        if (n <= 4) return 'zoom-200';
                        if (n <= 9) return 'zoom-150';
                        return '';
                      })()}`}>
                        {seasonEpisodes.map((episode, index) => (
                          <div
                            key={episode.plex || index}
                            className={`episode-card vertical ${selectedEpisode?.plex === episode.plex ? 'selected' : ''}`}
                            onClick={() => handleEpisodeSelect(episode)}
                            onDoubleClick={() => handlePlayEpisode(episode)}
                            title={episode.label}
                          >
                            {episode.image && (
                              <div className="episode-thumbnail">
                                <img src={episode.image} alt={episode.label} />
                                <div className="thumbnail-badges">
                                  <div className="badge watched" />
                                  <div className="badge up-next" />
                                  <div className="badge custom-status" />
                                  <div className="badge duration">
                                    {episode.duration && formatDurationBadge(episode.duration)}
                                  </div>
                                </div>
                                <div className="thumbnail-progress">
                                  <div className="progress-bar" style={{ width: '50%' }} />
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
                            <div className="episode-title" aria-label={episode.label}>
                              <span className="episode-title-text">{episode.label}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
            <div
              className="season-filter-bar"
              ref={seasonBarRef}
              style={{
                /* Dynamic height based on container width and number of seasons to fit all images at 2:3 ratio */
                height: (() => {
                  const maxRem = 12;
                  const minRem = 4;
                  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
                  const n = seasons.length || 1;
                  const horizontalPaddingRem = 1; // 0.5rem left + 0.5rem right
                  // Use the actual season bar width; cap by viewport if provided
                  const baseWidthPx = Math.min(
                    seasonBarWidth || 0,
                    viewportSize?.width ?? Number.POSITIVE_INFINITY
                  );
                  // Subtract padding and a tiny epsilon to avoid rounding overflow
                  const epsilonPx = 2;
                  const availablePx = Math.max(0, baseWidthPx - horizontalPaddingRem * remPx - epsilonPx);
                  // To avoid fractional rounding overflow, quantize per-item width:
                  // widthPerItemPx = floor(availablePx / n)
                  // height = widthPerItemPx * 3 / 2 (to keep 2:3 ratio)
                  const widthPerItemPx = Math.max(0, Math.floor(availablePx / n));
                  const heightPxFit = (widthPerItemPx * 3) / 2;
                  const heightRemFit = heightPxFit / remPx;
                  const heightRem = Math.max(minRem, Math.min(maxRem, heightRemFit));
                  return `${heightRem}rem`;
                })(),
              }}
            >
              {seasons.map((s, idx) => (
                <button
                  key={s.id}
                  className={`season-item ${activeSeasonId === s.id ? 'active' : ''}`}
                  onClick={() => setActiveSeasonId(s.id)}
                >
                  <div className="season-image-wrapper">
                    {s.image ? (
                      <img src={DaylightMediaPath(`media/plex/img/${s.id}`)} alt={s.name} className="season-image" />
                    ) : (
                      <div className="season-image placeholder">S</div>
                    )}
                    <div className="season-index" title={s.name}>
                      <span className="season-num">{Number.isFinite(s.number) ? s.number : ''}</span>
                      <span className="season-title-text">{s.name || 'Season'}</span>
                    </div>
                  </div>
                  {/* Name moved into overlay next to number */}
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