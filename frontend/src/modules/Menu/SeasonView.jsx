import React, { useCallback, useEffect, useContext, useRef } from 'react';
import { useFetchPlexData, formatDuration, formatProgress } from './hooks/useFetchPlexData';
import MenuNavigationContext from '../../context/MenuNavigationContext';
import './PlexViews.scss';

/**
 * SeasonView: Netflix-style episode grid for a TV season
 * Shows episode thumbnails in a grid, with expanded description for selected episode
 */
export function SeasonView({ seasonId, depth, onSelect, onEscape }) {
  const { data, loading, error } = useFetchPlexData(seasonId);
  const navContext = useContext(MenuNavigationContext);
  const gridRef = useRef(null);
  
  // Get selection from context
  const selection = navContext?.getSelection(depth) || { index: 0, key: null };
  const selectedIndex = selection.index;

  const setSelectedIndex = useCallback((index, key = null) => {
    if (navContext) {
      navContext.setSelectionAtDepth(depth, index, key);
    }
  }, [navContext, depth]);

  const episodes = data?.items || [];
  const seasonInfo = data?.info || {};
  const seasonTitle = data?.title || seasonInfo.title || 'Season';
  const showTitle = seasonInfo.parentTitle || '';
  const seasonPoster = seasonInfo.image || seasonInfo.parentThumb || '';

  // Get episode key for selection persistence
  const getEpisodeKey = useCallback((episode) => {
    return episode?.plex || episode?.label || null;
  }, []);

  // Handle episode selection
  const handleSelect = useCallback((episode) => {
    if (!episode) return;
    onSelect?.({ 
      play: { plex: episode.plex }, 
      type: 'episode',
      label: episode.label 
    });
  }, [onSelect]);

  // Handle back/escape
  const handleClose = useCallback(() => {
    if (navContext) {
      navContext.pop();
    } else {
      onEscape?.();
    }
  }, [navContext, onEscape]);

  // Auto-scroll selected episode into view
  useEffect(() => {
    if (!gridRef.current || !episodes.length) return;
    const selectedCard = gridRef.current.querySelector('.episode-grid-card--active');
    if (selectedCard) {
      selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedIndex, episodes.length]);

  // Keyboard navigation (grid: up/down/left/right)
  const handleKeyDown = useCallback((e) => {
    if (!episodes.length) return;

    // Calculate grid columns (4 per row based on design)
    const cols = 4;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        handleSelect(episodes[selectedIndex]);
        break;

      case 'ArrowUp':
        e.preventDefault();
        {
          const next = selectedIndex - cols;
          if (next >= 0) {
            setSelectedIndex(next, getEpisodeKey(episodes[next]));
          }
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        {
          const next = selectedIndex + cols;
          if (next < episodes.length) {
            setSelectedIndex(next, getEpisodeKey(episodes[next]));
          }
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        {
          const next = selectedIndex - 1;
          if (next >= 0) {
            setSelectedIndex(next, getEpisodeKey(episodes[next]));
          }
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        {
          const next = selectedIndex + 1;
          if (next < episodes.length) {
            setSelectedIndex(next, getEpisodeKey(episodes[next]));
          }
        }
        break;

      case 'Escape':
        e.preventDefault();
        handleClose();
        break;

      default:
        break;
    }
  }, [episodes, selectedIndex, handleSelect, handleClose, setSelectedIndex, getEpisodeKey]);

  // Attach keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Clamp selection when episodes change
  useEffect(() => {
    if (!episodes.length) return;
    if (selectedIndex >= episodes.length) {
      setSelectedIndex(Math.max(0, episodes.length - 1));
    }
  }, [episodes, selectedIndex, setSelectedIndex]);

  if (loading) {
    return (
      <div className="season-view season-view--grid season-view--skeleton">
        <aside className="season-view__sidebar">
          <div className="season-view__poster skeleton-pulse" />
          <div className="season-view__selected-info">
            <div className="skeleton-text skeleton-text--sm skeleton-pulse" />
            <div className="skeleton-text skeleton-text--lg skeleton-pulse" />
            <div className="skeleton-text skeleton-text--md skeleton-pulse" />
          </div>
        </aside>
        <main className="season-view__main">
          <header className="season-view__header">
            <div className="season-view__breadcrumb">
              <div className="skeleton-text skeleton-text--lg skeleton-pulse" style={{ width: '200px' }} />
            </div>
          </header>
          <div className="season-view__grid">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="episode-grid-card episode-grid-card--skeleton">
                <div className="episode-grid-card__thumbnail skeleton-pulse" />
                <div className="episode-grid-card__info">
                  <div className="skeleton-text skeleton-text--sm skeleton-pulse" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="season-view season-view--error">
        <p>Failed to load season: {error.message}</p>
      </div>
    );
  }

  const selectedEpisode = episodes[selectedIndex];

  return (
    <div className="season-view season-view--grid">
      {/* Left: Season Poster */}
      <aside className="season-view__sidebar">
        {seasonPoster && (
          <div className="season-view__poster">
            <img src={seasonPoster} alt={seasonTitle} />
          </div>
        )}
        
        {/* Selected Episode Details */}
        {selectedEpisode && (
          <div className="season-view__selected-info">
            <div className="season-view__selected-number">
              Episode {selectedEpisode.episodeNumber !== undefined ? selectedEpisode.episodeNumber : selectedIndex + 1}
            </div>
            <h3 className="season-view__selected-title">
              {selectedEpisode.label || selectedEpisode.title}
            </h3>
            {selectedEpisode.duration && (
              <span className="season-view__selected-duration">
                {formatDuration(selectedEpisode.duration)}
              </span>
            )}
            {selectedEpisode.watchProgress > 0 && selectedEpisode.watchProgress < 1 && (
              <span className="season-view__selected-progress">
                {formatProgress(selectedEpisode.watchProgress)} watched
              </span>
            )}
            {selectedEpisode.episodeDescription && (
              <p className="season-view__selected-desc">
                {selectedEpisode.episodeDescription}
              </p>
            )}
          </div>
        )}
      </aside>

      {/* Right: Header + Episode Grid */}
      <main className="season-view__main">
        {/* Season Header with Breadcrumb */}
        <header className="season-view__header">
          <div className="season-view__breadcrumb">
            {showTitle && (
              <>
                <span className="season-view__show-title">{showTitle}</span>
                <span className="season-view__breadcrumb-sep">›</span>
              </>
            )}
            <span className="season-view__season-title">{seasonTitle}</span>
            <span className="season-view__count">({episodes.length} episode{episodes.length !== 1 ? 's' : ''})</span>
          </div>
        </header>

        {/* Episodes Grid */}
        <div className="season-view__grid" ref={gridRef}>
          {episodes.map((episode, index) => {
            const isActive = index === selectedIndex;
            const hasProgress = episode.watchProgress && episode.watchProgress > 0 && episode.watchProgress < 1;
            const isWatched = episode.watchProgress >= 0.9;
            
            return (
              <div
                key={episode.plex || index}
                className={`episode-grid-card ${isActive ? 'episode-grid-card--active' : ''} ${isWatched ? 'episode-grid-card--watched' : ''}`}
                onClick={() => {
                  setSelectedIndex(index, getEpisodeKey(episode));
                  handleSelect(episode);
                }}
              >
                {/* Episode Thumbnail */}
                <div className="episode-grid-card__thumbnail">
                  <img 
                    src={episode.image} 
                    alt={episode.label}
                    loading="lazy"
                  />
                  {/* Progress bar overlay */}
                  {hasProgress && (
                    <div className="episode-grid-card__progress-bar">
                      <div 
                        className="episode-grid-card__progress-fill" 
                        style={{ width: `${episode.watchProgress * 100}%` }}
                      />
                    </div>
                  )}
                  {/* Play icon on hover/active */}
                  <div className="episode-grid-card__play-overlay">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                  {/* Duration badge */}
                  {episode.duration && (
                    <span className="episode-grid-card__duration">
                      {formatDuration(episode.duration)}
                    </span>
                  )}
                </div>

                {/* Episode Info */}
                <div className="episode-grid-card__info">
                  <span className="episode-grid-card__number">
                    {episode.episodeNumber !== undefined ? episode.episodeNumber : index + 1}.
                  </span>
                  <span className="episode-grid-card__title">
                    {episode.label || episode.title}
                  </span>
                </div>
                
                {/* Truncated description (1 line) */}
                {episode.episodeDescription && (
                  <p className="episode-grid-card__desc">
                    {episode.episodeDescription}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default SeasonView;
