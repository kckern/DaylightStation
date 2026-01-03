import React, { useCallback, useEffect, useContext, useRef } from 'react';
import { useFetchPlexData } from './hooks/useFetchPlexData';
import MenuNavigationContext from '../../context/MenuNavigationContext';
import './PlexViews.scss';

/**
 * ShowView: Netflix-style show page with hero banner and season selector
 * Designed to fit in 16:9 viewport without vertical scrolling
 */
export function ShowView({ showId, depth, onSelect, onEscape }) {
  const { data, loading, error } = useFetchPlexData(showId);
  const navContext = useContext(MenuNavigationContext);
  const seasonsRef = useRef(null);
  
  // Get selection from context
  const selection = navContext?.getSelection(depth) || { index: 0, key: null };
  const selectedIndex = selection.index;

  const setSelectedIndex = useCallback((index, key = null) => {
    if (navContext) {
      navContext.setSelectionAtDepth(depth, index, key);
    }
  }, [navContext, depth]);

  const seasons = data?.items || [];
  const showInfo = data?.info || {};
  const showTitle = data?.title || showInfo.title || 'Show';

  // Get season key for selection persistence
  const getSeasonKey = useCallback((season) => {
    return season?.plex || season?.label || null;
  }, []);

  // Handle season selection
  const handleSelect = useCallback((season) => {
    if (!season) return;
    onSelect?.({ 
      list: { plex: season.plex }, 
      type: 'season',
      label: season.label 
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

  // Scroll selected season into view
  useEffect(() => {
    if (!seasonsRef.current || !seasons.length) return;
    const container = seasonsRef.current;
    const selectedCard = container.children[selectedIndex];
    if (selectedCard) {
      selectedCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedIndex, seasons.length]);

  // Keyboard navigation (horizontal for seasons)
  const handleKeyDown = useCallback((e) => {
    if (!seasons.length) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        handleSelect(seasons[selectedIndex]);
        break;

      case 'ArrowLeft':
        e.preventDefault();
        {
          const next = (selectedIndex - 1 + seasons.length) % seasons.length;
          setSelectedIndex(next, getSeasonKey(seasons[next]));
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        {
          const next = (selectedIndex + 1) % seasons.length;
          setSelectedIndex(next, getSeasonKey(seasons[next]));
        }
        break;

      case 'Escape':
        e.preventDefault();
        handleClose();
        break;

      default:
        break;
    }
  }, [seasons, selectedIndex, handleSelect, handleClose, setSelectedIndex, getSeasonKey]);

  // Attach keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Clamp selection when seasons change
  useEffect(() => {
    if (!seasons.length) return;
    if (selectedIndex >= seasons.length) {
      setSelectedIndex(Math.max(0, seasons.length - 1));
    }
  }, [seasons, selectedIndex, setSelectedIndex]);

  if (loading) {
    return (
      <div className="show-view show-view--skeleton">
        <div className="show-view__backdrop skeleton-pulse" />
        <div className="show-view__backdrop-gradient" />
        <div className="show-view__content">
          <div className="show-view__top">
            <div className="show-view__poster skeleton-pulse" />
            <div className="show-view__info">
              <div className="skeleton-text skeleton-text--lg skeleton-pulse" style={{ width: '60%', height: '2rem', marginBottom: '1rem' }} />
              <div className="skeleton-text skeleton-text--md skeleton-pulse" style={{ width: '40%', marginBottom: '0.75rem' }} />
              <div className="skeleton-text skeleton-pulse" style={{ width: '90%', marginBottom: '0.5rem' }} />
              <div className="skeleton-text skeleton-pulse" style={{ width: '85%', marginBottom: '0.5rem' }} />
              <div className="skeleton-text skeleton-pulse" style={{ width: '70%' }} />
            </div>
          </div>
          <div className="show-view__bottom">
            <div className="show-view__seasons-scroll">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="season-card season-card--skeleton">
                  <div className="season-card__thumbnail skeleton-pulse" />
                  <div className="skeleton-text skeleton-text--sm skeleton-pulse" style={{ marginTop: '0.5rem' }} />
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
      <div className="show-view show-view--error">
        <p>Failed to load show: {error.message}</p>
      </div>
    );
  }

  // Build metadata line (year, studio, collections)
  const metaParts = [];
  if (showInfo.year) metaParts.push(showInfo.year);
  if (showInfo.studio) metaParts.push(showInfo.studio);
  if (seasons.length) metaParts.push(`${seasons.length} Season${seasons.length !== 1 ? 's' : ''}`);
  const metaLine = metaParts.join(' • ');

  // Collections/tags
  const collections = showInfo.collections || [];

  return (
    <div className="show-view">
      {/* Background Image */}
      <div 
        className="show-view__backdrop"
        style={{ backgroundImage: `url(${data?.image || showInfo.image})` }}
      />
      <div className="show-view__backdrop-gradient" />
      
      {/* Main Content - Flexbox layout */}
      <div className="show-view__content">
        {/* Top Section: Poster + Info */}
        <div className="show-view__top">
          {/* Show Poster */}
          <div className="show-view__poster">
            <img 
              src={data?.image || showInfo.image} 
              alt={showTitle}
            />
          </div>

          {/* Show Info */}
          <div className="show-view__info">
            <h1 className="show-view__title">{showTitle}</h1>
            
            {metaLine && (
              <p className="show-view__meta">{metaLine}</p>
            )}

            {collections.length > 0 && (
              <div className="show-view__tags">
                {collections.map((tag, i) => (
                  <span key={i} className="show-view__tag">{tag}</span>
                ))}
              </div>
            )}

            {showInfo.summary && (
              <p className="show-view__summary">{showInfo.summary}</p>
            )}
          </div>
        </div>

        {/* Bottom Section: Seasons */}
        <div className="show-view__bottom">
          
          <div className="show-view__seasons-scroll" ref={seasonsRef}>
            {seasons.map((season, index) => {
              const isActive = index === selectedIndex;
              
              return (
                <div
                  key={season.plex || index}
                  className={`season-card ${isActive ? 'season-card--active' : ''}`}
                  onClick={() => {
                    setSelectedIndex(index, getSeasonKey(season));
                    handleSelect(season);
                  }}
                >
                  {/* Season Thumbnail */}
                  <div className="season-card__thumbnail">
                    <img 
                      src={season.image} 
                      alt={season.label}
                      loading="lazy"
                    />
                    {/* Play icon on hover/active */}
                    <div className="season-card__play-overlay">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                  </div>

                  {/* Season Label */}
                  <h3 className="season-card__title">{season.label || season.title}</h3>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShowView;
