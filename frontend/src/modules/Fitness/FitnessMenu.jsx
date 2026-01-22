import React, { useState, useEffect, useMemo } from 'react';
import { LoadingOverlay, Alert, Text } from '@mantine/core';
import { DaylightAPI, normalizeImageUrl } from '../../lib/api.mjs';
import FitnessPluginMenu from './FitnessPlugins/FitnessPluginMenu.jsx';
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
    const navItems = fitnessConfig.plex?.nav_items || [];
    
    // Convert nav_items back to collection-like objects for internal use
    return navItems
      .filter(item => ['plex_collection', 'plex_collection_group', 'plugin_menu'].includes(item.type))
      .map(item => {
        if (item.type === 'plex_collection') {
          return { id: item.target.collection_id, name: item.name, icon: item.icon };
        } else if (item.type === 'plex_collection_group') {
          return { id: item.target.collection_ids, name: item.name, icon: item.icon };
        } else if (item.type === 'plugin_menu') {
          return { id: item.target.menu_id, name: item.name, icon: item.icon };
        }
        return null;
      })
      .filter(Boolean);
  }, [fitnessConfig]);

  const activeAppMenu = useMemo(() => {
    if (!fitnessConfig?.plex?.app_menus) return null;
    return fitnessConfig.plex.app_menus.find(m => String(m.id) === String(activeCollection));
  }, [fitnessConfig, activeCollection]);

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
    // Detect "flush bottom" situation: item fully visible but its bottom is near the container's bottom
    // and there is still more content below to reveal.
    let flushBottom = false;
    if (axis === 'y' && fully) {
      const er = el.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const moreBelow = (container.scrollTop + container.clientHeight) < (container.scrollHeight - 1);
      flushBottom = moreBelow && (er.bottom >= cr.bottom - margin);
      if (!flushBottom) return { didScroll: false, container }; // normal fully-visible case
    } else if (fully) {
      return { didScroll: false, container };
    }
    const er = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();

    if (axis === 'y') {
      // Align element so its top sits below a margin (10% of container height by default)
      const containerHeight = container.clientHeight || (cr.height);
      const topMarginPx = Math.max(8, Math.round(containerHeight * topAlignRatio));
      // Element top position inside scroll context
      const elementTopInScroll = container.scrollTop + (er.top - cr.top);
      let targetScrollTop = elementTopInScroll - topMarginPx;
      // If flushBottom, nudge downward by one third of container height to reveal more below while keeping element in view
      if (flushBottom) {
        targetScrollTop = Math.min(targetScrollTop + Math.round(containerHeight * 0.33), container.scrollHeight - container.clientHeight);
      }
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
        const configResponse = await DaylightAPI('/api/v1/fitness');
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
        if (activeAppMenu) {
          setShows([]);
          setShowsLoading(false);
          return;
        }

        if (!collectionsFromConfig.length) return;

        let normalizedSelection = collectionsFromConfig[0];
        if (activeCollection != null) {
          normalizedSelection = collectionsFromConfig.find(c => {
            const cid = c.id;
            if (Array.isArray(activeCollection)) {
              if (Array.isArray(cid)) {
                return cid.some(colId => activeCollection.some(selId => String(selId) === String(colId)));
              }
              return activeCollection.some(selId => String(selId) === String(cid));
            }
            if (Array.isArray(cid)) {
              return cid.some(colId => String(colId) === String(activeCollection));
            }
            return String(cid) === String(activeCollection);
          }) || collectionsFromConfig[0];
        }

        if (!normalizedSelection) return;
        setSelectedCollection(normalizedSelection);

        const idsToFetch = Array.isArray(normalizedSelection.id)
          ? normalizedSelection.id
          : Array.isArray(activeCollection)
            ? activeCollection
            : [normalizedSelection.id];

        setShowsLoading(true);

        const listResponses = await Promise.all(idsToFetch.map(async (collectionId) => {
          try {
            const response = await DaylightAPI(`/api/v1/list/plex/${collectionId}`);
            return Array.isArray(response?.items) ? response.items : [];
          } catch (apiErr) {
            console.error(`🎬 ERROR: Error loading shows for collection ${collectionId}:`, apiErr);
            return [];
          }
        }));

        const mergedItemsMap = new Map();
        listResponses.flat().forEach((item) => {
          if (!item) return;
          const key = item.plex || item.id;
          if (key == null) return;
          if (!mergedItemsMap.has(key)) {
            mergedItemsMap.set(key, item);
          }
        });

        const mergedItems = Array.from(mergedItemsMap.values());

        setShows(mergedItems);
        const reset = {};
        mergedItems.forEach(item => {
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

  if (activeAppMenu) {
    return (
      <FitnessPluginMenu 
        activePluginMenuId={activeAppMenu.id} 
        onPluginSelect={(pluginId, manifest) => onContentSelect && onContentSelect('plugin', { id: pluginId, ...manifest })}
        onBack={() => {}} 
      />
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
      onContentSelect(show.type || 'show', show);
    }
  };
  
  const normalizeResumeMeta = (media) => {
    const normalizeNumber = (value) => {
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return Number.isFinite(value) ? value : null;
    };
    const secondsCandidates = [media.watchSeconds, media.seconds, media.resumeSeconds];
    let resolvedSeconds = secondsCandidates.map(normalizeNumber).find((value) => Number.isFinite(value) && value > 0) || 0;
    const normalizedProgress = normalizeNumber(media.watchProgress);
    const normalizedDuration = normalizeNumber(media.duration);
    if (!resolvedSeconds && Number.isFinite(normalizedProgress) && Number.isFinite(normalizedDuration) && normalizedDuration > 0) {
      resolvedSeconds = (Math.max(0, Math.min(100, normalizedProgress)) / 100) * normalizedDuration;
    }
    return {
      seconds: resolvedSeconds,
      watchSeconds: resolvedSeconds || undefined,
      watchProgress: Number.isFinite(normalizedProgress) ? normalizedProgress : undefined
    };
  };

  const handleAddToQueue = (event, show) => {
    event.stopPropagation(); // Prevent triggering the show click
  // adding to queue (debug removed)
    // Ensure the whole card is visible before acting
    const card = event.currentTarget.closest('.show-card') || event.currentTarget;
    const { didScroll } = scrollIntoViewIfNeeded(card, { axis: 'y', margin: 24 });
    if (didScroll) return;
    if (setFitnessPlayQueue) {
      const resumeMeta = normalizeResumeMeta(show);
      setFitnessPlayQueue(prevQueue => [...prevQueue, {
        id: show.plex || show.id,
        title: show.label,
        videoUrl: show.url || show.videoUrl,
        duration: show.duration,
        thumb_id: show.thumb_id,
        image: show.image,
        labels: show.labels,
        type: show.type || null,
        ...resumeMeta
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
                className="show-card show-tile media-card"
                data-testid="show-card"
                data-show-id={show.plex || show.id}
                data-show-title={show.label}
                onPointerDown={(e) => handleShowClick(e, show)}
              >
                {show.image && (
                  <img
                    src={normalizeImageUrl(show.image)}
                    alt={show.label}
                    className={`show-image ${loadedImages[show.plex || show.id] ? 'loaded' : ''}`}
                    data-testid="show-poster"
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
