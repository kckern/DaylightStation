import React, { useState, useEffect, useMemo } from 'react';
import { LoadingOverlay, Alert, Text } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import './FitnessMenu.scss';

const FitnessMenu = ({ activeCollection, onContentSelect, setFitnessPlayQueue }) => {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true); // initial config loading
  const [showsLoading, setShowsLoading] = useState(true); // loading shows list
  const [error, setError] = useState(null);
  const [fitnessConfig, setFitnessConfig] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [loadedImages, setLoadedImages] = useState({});

  const collectionsFromConfig = useMemo(() => {
    if (!fitnessConfig) return [];
    const col = fitnessConfig.plex?.collections;
    return Array.isArray(col) ? col : [];
  }, [fitnessConfig]);

  // Scroll helpers: find nearest scrollable container and ensure element is fully visible
  const getScrollParent = (el, axis = 'y') => {
    if (!el) return null;
    let parent = el.parentElement;
    while (parent) {
      if (axis === 'y') {
        if (parent.scrollHeight > parent.clientHeight) return parent;
      } else {
        if (parent.scrollWidth > parent.clientWidth) return parent;
      }
      parent = parent.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const isFullyInView = (el, container, margin = 24, axis = 'y') => {
    if (!el || !container) return true;
    const er = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    if (axis === 'y') {
      return er.top >= cr.top + margin && er.bottom <= cr.bottom - margin;
    }
    return er.left >= cr.left + margin && er.right <= cr.right - margin;
  };

  const scrollIntoViewIfNeeded = (
    el,
    { axis = 'y', margin = 24, behavior = 'smooth', topAlignRatio = 0.10 } = {}
  ) => {
    const container = getScrollParent(el, axis);
    if (!container) return { didScroll: false };
    const fully = isFullyInView(el, container, margin, axis);
    if (fully) return { didScroll: false, container };
    const er = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();

    if (axis === 'y') {
      // Align element so its top sits below a margin (10% of container height by default)
      const containerHeight = container.clientHeight || (cr.height);
      const topMarginPx = Math.max(8, Math.round(containerHeight * topAlignRatio));
      // Element top position inside scroll context
      const elementTopInScroll = container.scrollTop + (er.top - cr.top);
      let targetScrollTop = elementTopInScroll - topMarginPx;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (targetScrollTop < 0) targetScrollTop = 0;
      if (targetScrollTop > maxScroll) targetScrollTop = maxScroll;
      if (Math.abs(targetScrollTop - container.scrollTop) > 1) {
        container.scrollTo({ top: targetScrollTop, behavior });
        return { didScroll: true, container };
      }
    } else {
      // Horizontal minimal adjustment (no top alignment concept)
      const leftDelta = er.left - (cr.left + margin);
      const rightDelta = er.right - (cr.right - margin);
      let delta = 0;
      if (leftDelta < 0) delta = leftDelta; else if (rightDelta > 0) delta = rightDelta;
      if (delta !== 0) {
        container.scrollTo({ left: container.scrollLeft + delta, behavior });
        return { didScroll: true, container };
      }
    }
    return { didScroll: false, container };
  };

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
  // fetch start (debug removed)
        
        // First get the fitness config to get the collections
        const configResponse = await DaylightAPI('/api/fitness');
  // config response (debug removed)
        setFitnessConfig(configResponse.fitness || configResponse);
        // Defer show loading to the effect below
      } catch (err) {
        console.error('🎬 ERROR: Error fetching fitness menu data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFitnessData();
  }, []);

  // Fetch shows when collection selection or config changes
  useEffect(() => {
    const loadShows = async () => {
      try {
        if (!collectionsFromConfig.length) return;

        const collectionToUse = activeCollection
          ? collectionsFromConfig.find(c => String(c.id) === String(activeCollection)) || collectionsFromConfig[0]
          : collectionsFromConfig[0];

        if (!collectionToUse) return;
        setSelectedCollection(collectionToUse);

        const collectionId = collectionToUse.id;
  // API call (debug removed)
        setShowsLoading(true);
        const showsResponse = await DaylightAPI(`/media/plex/list/${collectionId}`);
  // shows response (debug removed)
        const newItems = showsResponse.items || [];
        setShows(newItems);
        // reset loaded images tracking for new set
        const reset = {};
        newItems.forEach(item => {
          const id = item.plex || item.id;
          if (id !== undefined) reset[id] = false;
        });
        setLoadedImages(reset);
      } catch (err) {
        console.error('🎬 ERROR: Error loading shows:', err);
        setError(err.message);
      } finally {
        setShowsLoading(false);
      }
    };

    loadShows();
  }, [activeCollection, collectionsFromConfig]);

  if (loading) {
    return (
      <div style={{ position: 'relative', height:"100%", width:"100%" }}>
        <LoadingOverlay visible={true} />
      </div>
    );
  }

  if (error) {
    return (
      <Alert color="red">
        <Text c="white">Error loading fitness shows: {error}</Text>
      </Alert>
    );
  }

  const collectionName = selectedCollection?.name || 'Fitness Shows';

  const handleShowClick = (e, show) => {
  // show selected (debug removed)
    // If card isn't fully visible, scroll it into view first and require a second tap
    const card = e.currentTarget;
    const { didScroll } = scrollIntoViewIfNeeded(card, { axis: 'y', margin: 24 });
    if (didScroll) return;
    if (onContentSelect) {
      onContentSelect('show', show);
    }
  };
  
  const handleAddToQueue = (event, show) => {
    event.stopPropagation(); // Prevent triggering the show click
  // adding to queue (debug removed)
    // Ensure the whole card is visible before acting
    const card = event.currentTarget.closest('.show-card') || event.currentTarget;
    const { didScroll } = scrollIntoViewIfNeeded(card, { axis: 'y', margin: 24 });
    if (didScroll) return;
    if (setFitnessPlayQueue) {
      setFitnessPlayQueue(prevQueue => [...prevQueue, {
        id: show.plex || show.id,
        title: show.label,
        videoUrl: show.url || show.videoUrl
      }]);
    }
  };

  return (
    <div className="fitness-menu">
      <div className="fitness-grid">
        {showsLoading && (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="show-card skeleton-card">
              <div className="skeleton-shimmer" />
            </div>
          ))
        )}
        {!showsLoading && shows.length > 0 && (
          shows
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .map((show, index) => (
              <div
                key={show.plex || index}
                className="show-card"
                onPointerDown={(e) => handleShowClick(e, show)}
              >
                {show.image && (
                  <img
                    src={show.image}
                    alt={show.label}
                    className={`show-image ${loadedImages[show.plex || show.id] ? 'loaded' : ''}`}
                    onLoad={() => {
                      const key = show.plex || show.id;
                      if (key !== undefined) {
                        setLoadedImages(prev => ({ ...prev, [key]: true }));
                      }
                    }}
                  />
                )}
                {setFitnessPlayQueue && (
                  <button
                    className="add-to-queue-btn"
                    onPointerDown={(e) => handleAddToQueue(e, show)}
                    title="Add to play queue"
                  >
                    +
                  </button>
                )}
              </div>
            ))
        )}
      </div>
      {!showsLoading && shows.length === 0 && (
        <div className="no-shows">
          <div className="no-shows-title">No shows found</div>
          {collectionName && (
            <div className="no-shows-text">
              No shows available in the {collectionName} collection
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FitnessMenu;
