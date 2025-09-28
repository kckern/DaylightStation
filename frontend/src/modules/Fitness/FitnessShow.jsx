import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LoadingOverlay, Alert } from '@mantine/core';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import './FitnessShow.scss';
import { useFitness } from '../../context/FitnessContext.jsx';

// Season Info Component - Shows detailed info for a season or episode
const SeasonInfo = ({ item, type = 'episode' }) => {
  if (!item) return null;
  
  return (
    <div className={`season-info ${type}-info`}>
      {item.image && (
        <div className="info-image-container">
          <img 
            src={type === 'season' && item.id ? DaylightMediaPath(`media/plex/img/${item.id}`) : item.image} 
            alt={item.title || item.label || item.name} 
            className="info-image" 
          />
        </div>
      )}
      
      <div className="info-details">
        <h2 className="info-title">{item.title || item.label || item.name || 'Details'}</h2>
        
        {type === 'season' && (
          <div className="info-metadata">
            <div className="info-episodes-count">
              <span className="info-label">Episodes:</span> {item.episodeCount || 'Unknown'}
            </div>
            {item.year && (
              <div className="info-year">
                <span className="info-label">Year:</span> {item.year}
              </div>
            )}
          </div>
        )}
        
        {type === 'episode' && (
          <div className="info-metadata">
            {item.duration && (
              <div className="info-duration">
                <span className="info-label">Duration:</span> {formatDuration(item.duration)}
              </div>
            )}
            {item.index && (
              <div className="info-episode-number">
                <span className="info-label">Episode:</span> {item.index}
              </div>
            )}
          </div>
        )}
        
        {item.summary && (
          <div className="info-summary">
            <p>{item.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
};

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

const FitnessShow = ({ showId, onBack, viewportRef, setFitnessPlayQueue }) => {
  const [showData, setShowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterRef = useRef(null);
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const seasonBarRef = useRef(null);
  const [seasonBarWidth, setSeasonBarWidth] = useState(0);
  const [selectedInfo, setSelectedInfo] = useState(null); // Selected episode or season for info panel
  const [infoType, setInfoType] = useState('episode'); // 'episode' or 'season'
  const [loadedEpisodeImages, setLoadedEpisodeImages] = useState({});
  const [loadedSeasonImages, setLoadedSeasonImages] = useState({});
  
  // Access the setFitnessPlayQueue from the parent component (FitnessApp)
  const { fitnessPlayQueue, setFitnessPlayQueue: contextSetPlayQueue } = useFitness() || {};
  

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
  // Poster size effect: run on mount and when showId changes; guard against state churn
  useEffect(() => {
    let frame;
    const updatePosterSize = () => {
      if (!posterRef.current) return;
      const width = posterRef.current.offsetWidth;
      if (width && width !== posterWidth) {
        const height = width * 1.5;
        posterRef.current.style.height = `${height}px`;
        setPosterWidth(width);
      }
    };
    updatePosterSize();
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosterSize);
    });
    if (posterRef.current) resizeObserver.observe(posterRef.current);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [showId, posterWidth]);

  // Track season filter bar width to compute dynamic height that ensures all items fit
  useEffect(() => {
    const el = seasonBarRef.current;
    if (!el) return;
    let width = el.getBoundingClientRect().width;
    setSeasonBarWidth(prev => (prev !== width ? width : prev));
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        setSeasonBarWidth(prev => (prev !== newWidth ? newWidth : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showId]);

  // Derive viewport dimensions if provided, to avoid using window
  const viewportSize = useMemo(() => {
    const el = viewportRef?.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [showId]);

  const handleEpisodeSelect = (episode) => {
    setSelectedEpisode(episode);
  };

  const handlePlayEpisode = async (episode) => {
    console.log('🎬 Play episode:', episode);
    
    try {
      // Get URL for the playable item if not present
      let episodeUrl = episode.url;
      if (!episodeUrl && episode.plex) {
        // Construct the URL using the helper function
        episodeUrl = DaylightMediaPath(`media/plex/url/${episode.plex}`);
        console.log(`🎬 Constructed media URL: ${episodeUrl}`);
      }
      
      // Create the queue item with all available information
      const queueItem = {
        id: episode.plex || `episode-${Date.now()}`,
        title: episode.label,
        videoUrl: episodeUrl || 'https://example.com/fallback.mp4', // Add fallback for testing
        duration: episode.duration,
        thumb_id: episode.thumb_id, // Pass thumb_id directly to FitnessPlayer
        image: episode.thumb_id ? DaylightMediaPath(`media/plex/img/${episode.thumb_id}`) : episode.image,
        seasonId: episode.seasonId,
        seasonImage: (episode.seasonThumbUrl || (episode.seasonId ? DaylightMediaPath(`media/plex/img/${episode.seasonId}`) : undefined))
      };
      
      console.log('🎬 Created queue item:', queueItem);
      
      // Update the selected episode for the UI
      setSelectedEpisode(episode);
      
      // Clear any selected info to return to show mode
      setSelectedInfo(null);
      
      // Directly use the setter from props if available (from FitnessApp)
      if (setFitnessPlayQueue) {
        console.log('🎬 Using prop setter directly');
        // Force a new array to ensure state change is detected
        setFitnessPlayQueue([queueItem]);
        return;
      }
      
      // Try the context setter as fallback
      if (contextSetPlayQueue) {
        console.log('🎬 Using context setter as fallback');
        // Force a new array to ensure state change is detected
        contextSetPlayQueue([queueItem]);
        return;
      }
      
      console.error('🎬 CRITICAL: No queue setter function available!');
      
      // Last resort: Try to access the window object and modify app state directly
      try {
        if (window && window.addToFitnessQueue) {
          console.log('🎬 Using window.addToFitnessQueue as last resort');
          window.addToFitnessQueue(queueItem);
        }
      } catch (e) {
        console.error('🎬 Window method failed:', e);
      }
    } catch (error) {
      console.error('🎬 Error adding episode to play queue:', error);
    }
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

  // Initialize load tracking when items/seasons change
  useEffect(() => {
    const epMap = {};
    for (const ep of items) {
      const key = ep.plex || ep.id;
      if (key !== undefined) epMap[key] = false;
    }
    setLoadedEpisodeImages(epMap);

    const seasonMap = {};
    for (const s of seasons) {
      const key = s.id;
      if (key !== undefined) seasonMap[key] = false;
    }
    setLoadedSeasonImages(seasonMap);
  }, [items, seasons]);

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
          <div className="no-selection-icon">🏋️</div>
          <div className="no-selection-title">Select a Show</div>
          <div className="no-selection-text">Choose a fitness show from the menu to get started</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fitness-show loading">
        <div className="show-content">
          {/* Left skeleton poster & info */}
          <div className="show-info-panel">
            <div className="show-poster skeleton-block poster-skeleton" />
            <div className="show-description">
              <div className="skeleton-line line-lg" />
              <div className="skeleton-line line-md" />
              <div className="skeleton-line line-sm" />
              <div className="skeleton-tags">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton-tag" />
                ))}
              </div>
            </div>
          </div>
          {/* Right panel skeleton */}
          <div className="episodes-panel">
            <div className="episodes-section">
              <div className="episodes-container">
                <div className="season-group">
                  <div className="episodes-grid">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="episode-card vertical episode-skeleton">
                        <div className="episode-thumbnail skeleton-block" />
                        <div className="episode-title">
                          <div className="skeleton-line line-ep" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="season-filter-bar skeleton-season-bar">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="season-item season-skeleton">
                  <div className="season-image-wrapper">
                    <div className="season-image skeleton-block" />
                  </div>
                  <div className="season-caption">
                    <div className="skeleton-line line-caption" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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

  // Helper function to add an episode to the queue
  const addToQueue = (episode) => {
    try {
      // Get URL for the playable item if not present
      let episodeUrl = episode.url;
      if (!episodeUrl && episode.plex) {
        // Construct the URL using the helper function
        episodeUrl = DaylightMediaPath(`media/plex/url/${episode.plex}`);
        console.log(`🎬 Constructed media URL for queue: ${episodeUrl}`);
      }

      if (episodeUrl) {
        const queueItem = {
          id: episode.plex || `episode-${Date.now()}`,
          title: episode.label,
          videoUrl: episodeUrl,
          duration: episode.duration,
            thumb_id: episode.thumb_id, // Pass thumb_id directly to FitnessPlayer
          image: episode.thumb_id ? DaylightMediaPath(`media/plex/img/${episode.thumb_id}`) : episode.image,
          seasonId: episode.seasonId,
          seasonImage: (episode.seasonThumbUrl || (episode.seasonId ? DaylightMediaPath(`media/plex/img/${episode.seasonId}`) : undefined))
        };
        
        // Use the appropriate setter
        if (setFitnessPlayQueue) {
          setFitnessPlayQueue(prevQueue => [...prevQueue, queueItem]);
        } else if (contextSetPlayQueue) {
          contextSetPlayQueue(prevQueue => [...prevQueue, queueItem]);
        }
        console.log('🎬 Added to queue:', episode);
      }
    } catch (error) {
      console.error('🎬 Error adding to queue:', error);
    }
  };
  
  return (
    <div className="fitness-show">

      <div className="show-content">
        {/* Left Panel - Show Info */}
        <div className="show-info-panel">
          {selectedInfo ? (
            <SeasonInfo item={selectedInfo} type={infoType} />
          ) : info && (
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
                  {info.year && <span className="meta-item">{info.year}</span>}
                  {info.studio && <span className="meta-item">{info.studio}</span>}
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
                            title={episode.label}
                          >
                            {episode.image && (
                              <div 
                                className="episode-thumbnail"
                                onClick={() => handlePlayEpisode(episode)}
                              >
                                <img
                                  src={episode.image}
                                  alt={episode.label}
                                  className={`episode-img ${loadedEpisodeImages[episode.plex || episode.id] ? 'loaded' : ''}`}
                                  onLoad={() => {
                                    const key = episode.plex || episode.id;
                                    if (key !== undefined) {
                                      setLoadedEpisodeImages(prev => ({ ...prev, [key]: true }));
                                    }
                                  }}
                                />
                                <div className="thumbnail-badges">
                                  <div className="badge duration">
                                    {episode.duration && formatDurationBadge(episode.duration)}
                                  </div>
                                </div>
                                <div className="thumbnail-progress">
                                  <div className="progress-bar" style={{ width: '50%' }} />
                                </div>
                              </div>
                            )}
                            <div 
                              className="episode-title" 
                              aria-label={episode.label}
                              onClick={() => {
                                setSelectedInfo({
                                  ...episode,
                                  title: episode.label
                                });
                                setInfoType('episode');
                                handleEpisodeSelect(episode);
                              }}
                            >
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
                <div className="no-episodes-icon">🏋️</div>
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
                  const captionRem = 1.5; // space for number+name label under image
                  const captionGapRem = 0.35; // gap between image and caption
                  const verticalPaddingRem = 1; // 0.5rem top + 0.5rem bottom
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
                  const imageHeightPx = (widthPerItemPx * 3) / 2;
                  const heightRemFit = imageHeightPx / remPx + captionRem + captionGapRem + verticalPaddingRem;
                  const epsilonRemOut = 0.1; // shave a hair to avoid rounding overflow
                  const heightRem = Math.max(minRem, Math.min(maxRem, heightRemFit) - epsilonRemOut);
                  return `${heightRem}rem`;
                })(),
                // Expose caption metrics to CSS for precise wrapper sizing
                ['--caption-rem']: '1.5rem',
                ['--caption-gap']: '0.35rem',
              }}
            >
              {seasons.map((s, idx) => (
                <button
                  key={s.id}
                  className={`season-item ${activeSeasonId === s.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSeasonId(s.id);
                    // Get the episode count for this season
                    const episodeCount = items.filter(ep => ep.seasonId === s.id).length;
                    setSelectedInfo({
                      ...s,
                      episodeCount
                    });
                    setInfoType('season');
                  }}
                >
                  <div className="season-image-wrapper" style={{backgroundImage: s.image ? `url(${DaylightMediaPath(`media/plex/img/${s.id}`)})` : 'none'}}>
                    {s.image ? (
                      <img
                        src={DaylightMediaPath(`media/plex/img/${s.id}`)}
                        alt={s.rawName || s.name || 'Season'}
                        className={`season-image ${loadedSeasonImages[s.id] ? 'loaded' : ''}`}
                        onLoad={() => {
                          const key = s.id;
                          if (key !== undefined) {
                            setLoadedSeasonImages(prev => ({ ...prev, [key]: true }));
                          }
                        }}
                      />
                    ) : (
                      <div className="season-image placeholder">S</div>
                    )}
                  </div>
                  <div className="season-caption" title={s.rawName || s.name}>
                    <span className="season-num">{Number.isFinite(s.number) ? s.number : ''}</span>
                    <span className="season-title-text">{s.rawName || s.name || 'Season'}</span>
                  </div>
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