import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LoadingOverlay, Alert } from '@mantine/core';
import { DaylightAPI, DaylightMediaPath, ContentDisplayUrl, normalizeImageUrl } from '../../lib/api.mjs';
import './FitnessShow.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import moment from 'moment';

const formatWatchedDate = (dateString) => {
  try {
    const parsed = moment(dateString, 'YYYY-MM-DD hh:mm:ssa');
    const today = moment();
    const yesterday = moment().subtract(1, 'days');
    
    if (parsed.isSame(today, 'day')) return 'Today';
    if (parsed.isSame(yesterday, 'day')) return 'Yesterday';
    if (parsed.year() === today.year()) return parsed.format('ddd D MMM');
    return parsed.format('MMM D, YYYY');
  } catch (e) {
    return '';
  }
};

// Season Info Component - Shows detailed info for a season or episode
// showSummary: parent show (series) summary for fallback when season summary absent
const SeasonInfo = ({ item, type = 'episode', showSummary = null }) => {
  if (!item) return null;
  // Prefer item's own summary; if season and summary missing, fallback to showSummary
  const effectiveSummary = item.summary || (type === 'season' ? showSummary : null);
  
  return (
    <div className={`season-info ${type}-info`}>
      {item.image && (
        <div className="info-image-container">
          <img 
            src={type === 'season' && item.id ? ContentDisplayUrl(item.contentId || item.id) : normalizeImageUrl(item.image)}
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
        
        {effectiveSummary && (
          <div className="info-summary">
            <p>{effectiveSummary}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Episode Info Component - Rich layout for an episode with parent (season) context
const EpisodeInfo = ({ episode, showInfo, parentsMap, parentsList, onPlay }) => {
  if (!episode) return null;
  const parentId = episode.parentId;
  // Try map first, then list
  const parentFromMap = parentsMap && parentId ? parentsMap[parentId] : null;
  const parentFromList = !parentFromMap && parentsList ? parentsList.find(s => s.id === parentId) : null;
  const parent = parentFromMap || parentFromList || {};
  // Robust parent (season) name fallback priority
  const rawParentName = parent.title || parent.name;
  const numericParent = (() => {
    // prefer explicit numeric properties
    if (Number.isFinite(parent.index)) return parent.index;
    if (Number.isFinite(parent.number)) return parent.number;
    const parsed = parseInt(parent.id, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();
  const parentName = rawParentName && rawParentName.toString().trim().length
    ? rawParentName
    : (Number.isFinite(numericParent) ? `Season ${numericParent}` : 'Season');

  // Parent (season) description fallback chain: explicit summary/description -> show summary
  const parentDescription = [parent.summary, parent.description, showInfo?.summary]
    .find(v => typeof v === 'string' && v.trim().length) || '';

  const parentImage = normalizeImageUrl(parent.thumbnail || parent.image) || (parentId ? ContentDisplayUrl(parent.contentId || parentId) : normalizeImageUrl(showInfo?.image));
  // Use the same episode image source as grid: primary is episode.image; fallback to thumbId path
  const episodeImage = (episode.image && episode.image.trim())
    ? normalizeImageUrl(episode.image)
    : (episode.thumbId ? ContentDisplayUrl(episode.thumbId) : null);
  const durationText = episode.duration ? formatDuration(episode.duration) : null;
  const epTitle = episode.label || episode.title || `Episode ${episode.itemIndex || ''}`.trim();
  const epNumber = episode.itemIndex;
  const epDescription = episode.episodeDescription || episode.summary || '';

  return (
    <div className="episode-info">
      <div className="episode-season-header">
        {parentImage && (
          <div className="season-thumb-wrapper">
            <img src={parentImage} alt={parentName} className="season-thumb" />
          </div>
        )}
        <div className="season-meta">
          <h2 className="show-name">{showInfo?.title}</h2>
          {parentDescription && (
            <div className="season-description"><p>{parentName}—{parentDescription}</p></div>
          )}
        </div>
      </div>
      <div className="episode-media-section">
        {episodeImage && (
          <div className="episode-image-wrapper">
            <img src={episodeImage} alt={epTitle} className="episode-image" />
          </div>
        )}
        <div className="episode-meta-block">
          <div className="episode-heading-row">
            <h3 className="episode-heading">
              {epNumber != null && <span className="episode-number">E{epNumber}</span>} {epTitle}
            </h3>
            {durationText && <span className="duration-badge">{durationText}</span>}
          </div>
          {epDescription && <div className="episode-description"><p>{epDescription}</p></div>}
        </div>
      </div>
      <div className="episode-actions center">
  <button className="play-button" data-testid="play-episode-button" onPointerDown={(e) => onPlay && onPlay(episode, null, e)}>▶ Play</button>
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

const normalizeNumber = (value) => {
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Number.isFinite(value) ? value : null;
};

const deriveResumeMeta = (episode) => {
  const duration = normalizeNumber(episode?.duration);
  const normalizedProgress = normalizeNumber(episode?.watchProgress);
  const secondsCandidates = [episode?.watchSeconds, episode?.seconds, episode?.resumeSeconds];
  let resolvedSeconds = secondsCandidates
    .map(normalizeNumber)
    .find((value) => Number.isFinite(value) && value > 0) || 0;

  if (!resolvedSeconds && Number.isFinite(normalizedProgress) && Number.isFinite(duration) && duration > 0) {
    resolvedSeconds = (Math.max(0, Math.min(100, normalizedProgress)) / 100) * duration;
  }

  return {
    resolvedSeconds,
    normalizedProgress,
    normalizedDuration: duration
  };
};

const FitnessShow = ({ showId: rawShowId, onBack, viewportRef, setFitnessPlayQueue, onPlay }) => {
  // Parse showId - strip any prefix (e.g., "plex:662027" -> "662027")
  // The fitness API assumes plex source, so we only need the numeric ID
  const showId = rawShowId?.replace(/^[a-z]+:/i, '') || rawShowId;

  const [showData, setShowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [posterWidth, setPosterWidth] = useState(0);
  const posterRef = useRef(null);
  const prevQueueLengthRef = useRef(0);
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const seasonBarRef = useRef(null);
  const [seasonBarWidth, setSeasonBarWidth] = useState(0);
  const [selectedInfo, setSelectedInfo] = useState(null); // Selected episode or season for info panel
  const [infoType, setInfoType] = useState('episode'); // 'episode' or 'season'
  const [loadedEpisodeImages, setLoadedEpisodeImages] = useState({});
  const [loadedSeasonImages, setLoadedSeasonImages] = useState({});

  // Access the setFitnessPlayQueue from the parent component (FitnessApp)
  const fitnessContext = useFitness() || {};
  const {
    fitnessPlayQueue,
    setFitnessPlayQueue: contextSetPlayQueue,
    setMusicAutoEnabled,
    nomusicLabels = [],
    governedLabels,
    plexConfig,
    governedTypes,
    governedLabelSet: contextGovernedLabelSet,
    governedTypeSet: contextGovernedTypeSet,
    fitnessSessionInstance,
    addVoiceMemoToSession,
    openVoiceMemoCapture,
    setCurrentMedia
  } = fitnessContext;
  const nomusicLabelSet = useMemo(() => {
    const normalized = Array.isArray(nomusicLabels)
      ? nomusicLabels.filter((label) => typeof label === 'string').map((label) => label.trim().toLowerCase())
      : [];
    return new Set(normalized);
  }, [nomusicLabels]);

  const fetchShowData = useCallback(async () => {
    if (!showId) {
      setLoading(false);
      if (typeof setMusicAutoEnabled === 'function') {
        setMusicAutoEnabled(false);
      }
      return;
    }

    try {
      setLoading(true);
      // Fitness API assumes plex source - no need to specify it in URL
      const response = await DaylightAPI(`/api/v1/fitness/show/${showId}/playable`);
      setShowData(response);
      
      const rawLabels = [];
      if (Array.isArray(response?.info?.labels)) {
        rawLabels.push(...response.info.labels);
      }
      if (Array.isArray(response?.info?.Label)) {
        response.info.Label.forEach((entry) => {
          if (typeof entry === 'string') {
            rawLabels.push(entry);
          } else if (entry && typeof entry === 'object' && entry.tag) {
            rawLabels.push(entry.tag);
          }
        });
      }
      const normalizedLabels = rawLabels
        .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
        .filter(Boolean);
      const hasNoMusicLabel = normalizedLabels.some((label) => nomusicLabelSet.has(label));
      if (typeof setMusicAutoEnabled === 'function') {
        // Enable music auto-play when video has NoMusic label (video lacks its own soundtrack)
        setMusicAutoEnabled(hasNoMusicLabel);
      }
      
      // Auto-select first episode if available
      if (response.items && response.items.length > 0) {
        setSelectedEpisode(response.items[0]);
      }
    } catch (err) {
      console.error('🎬 ERROR: Error fetching show data:', err);
      setError(err.message);
      if (typeof setMusicAutoEnabled === 'function') {
        setMusicAutoEnabled(false);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setMusicAutoEnabled is stable
  }, [showId, nomusicLabelSet]);

  useEffect(() => {
    fetchShowData();
  }, [fetchShowData]);

  // Sync viewed show with global context for AI transcription context injection (BUG-07)
  useEffect(() => {
    if (showData?.show) {
      setCurrentMedia({
        showName: showData.show.title || showData.show.label || showData.show.name,
        showId: showData.show.id,
        isViewing: true
      });
    }
    return () => {
      // Handled by unmount effect
    };
  }, [showData, setCurrentMedia]);

  // Handle unmount - clear viewing media
  useEffect(() => {
    return () => {
      setCurrentMedia(null);
    };
  }, [setCurrentMedia]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRefresh = (event) => {
      const targetId = event?.detail?.showId || event?.detail?.id || null;
      if (targetId && String(targetId) !== String(showId)) return;
      fetchShowData();
    };
    window.addEventListener('fitness-show-refresh', handleRefresh);
    return () => window.removeEventListener('fitness-show-refresh', handleRefresh);
  }, [showId, fetchShowData]);

  // Re-fetch episode data when playback ends (queue transitions from non-empty to empty).
  // This ensures the latest watchSeconds from play.log POSTs (sent every ~10s during playback)
  // are reflected in episode data, preventing stale playhead regression on re-entry.
  useEffect(() => {
    const prevLen = prevQueueLengthRef.current;
    const curLen = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue.length : 0;
    prevQueueLengthRef.current = curLen;
    if (prevLen > 0 && curLen === 0) {
      fetchShowData();
    }
  }, [fitnessPlayQueue, fetchShowData]);

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

  // Scroll behavior utilities (touch-first): only activate action if element fully visible with margin
  const getScrollParent = (el, axis = 'y') => {
    if (!el) return null;
    let parent = el.parentElement;
    while (parent) {
      if (axis === 'y') {
        if (parent.scrollHeight > parent.clientHeight) return parent;
      } else if (axis === 'x') {
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
    
    // If fully visible and no axis-specific override needed, don't scroll
    if (fully && axis !== 'y') {
      return { didScroll: false, container };
    }
    
    const er = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    
    // Check if we should scroll for y-axis when element is already fully visible
    if (fully && axis === 'y') {
      // Find the episodes container to limit search scope to current show only
      const episodesContainer = el.closest('.episodes-container');
      if (episodesContainer) {
        // Only check episode cards within the same episodes container (current show)
        const episodeCards = episodesContainer.querySelectorAll('.episode-card');
        let hasOffscreenCards = false;
        
        if (episodeCards.length > 0) {
          // Check if any episode card is partially or fully below the visible area
          for (const card of episodeCards) {
            const cardRect = card.getBoundingClientRect();
            // Card is offscreen below if its top is below the container's visible bottom
            if (cardRect.top > cr.bottom - margin) {
              hasOffscreenCards = true;
              break;
            }
          }
        }
        
        // Only scroll if the element is at the bottom AND there are more cards to reveal
        const needsScroll = hasOffscreenCards && (er.bottom >= cr.bottom - margin);
        if (!needsScroll) return { didScroll: false, container };
      } else {
        // No episodes container found, element is fully visible, don't scroll
        return { didScroll: false, container };
      }
    }
    
    // Element is not fully visible or needs scrolling - proceed with scroll
    if (axis === 'y') {
      const containerHeight = container.clientHeight || cr.height;
      const topMarginPx = Math.max(8, Math.round(containerHeight * topAlignRatio));
      // Compute desired absolute scrollTop to place element top at topMarginPx
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
      // For horizontal containers (season bar), do minimal adjustment with a small margin
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

  const deriveEpisodeLabels = (episode) => {
    const fromEpisode = Array.isArray(episode?.labels)
      ? episode.labels
      : Array.isArray(episode?.Label)
        ? episode.Label.map((entry) => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object' && entry.tag) return entry.tag;
            return null;
          }).filter(Boolean)
        : [];
    const fromShow = Array.isArray(showData?.info?.labels) ? showData.info.labels : [];
    return Array.from(new Set([...(fromEpisode || []), ...(fromShow || [])]));
  };

  const isEpisodeWatched = useCallback((episode) => {
    // Trust backend-computed isWatched (SSOT)
    // See: FitnessProgressClassifier for threshold logic
    return episode?.isWatched ?? false;
  }, []);

  const handlePlayEpisode = async (episode, sourceEl = null, event = null) => {
  // play episode (debug removed)
    // If source element provided, require full visibility before play
    if (sourceEl) {
      const { didScroll } = scrollIntoViewIfNeeded(sourceEl, { axis: 'y', margin: 8 });
      if (didScroll) return; // wait for second tap
    }

    // Interaction Isolation: Prevent the gesture from leaking to the next view
    if (event) {
      try {
        if (typeof event.currentTarget?.setPointerCapture === 'function') {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      } catch (_) {}
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
    }
    
    try {
      // Extract plex ID from episode.plex, episode.play.plex, or from episode.id (format: "plex:662039")
      const extractPlexId = (ep) => {
        if (ep.plex) return String(ep.plex);
        if (ep.play?.plex) return String(ep.play.plex);
        if (typeof ep.id === 'string' && ep.id.startsWith('plex:')) {
          return ep.id.replace('plex:', '');
        }
        return null;
      };
      const plexId = extractPlexId(episode);

      // Get URL for the playable item if not present
      let episodeUrl = episode.url || episode.mediaUrl;
      if (!episodeUrl && plexId) {
        // Construct the URL using the new API proxy path
        episodeUrl = `/api/v1/proxy/plex/stream/${plexId}`;
      }

      const { resolvedSeconds, normalizedProgress } = deriveResumeMeta(episode);

      // Resolve season and show titles for logging
      const seasonObj = seasons && seasons.find(s => s.id === episode.parentId);
      const seasonTitle = seasonObj ? (seasonObj.title || seasonObj.name || seasonObj.rawName) : undefined;
      const showTitle = info?.title;

      // Create the queue item with all available information
      // Get season image from parentsMap (has proper season thumbnails) or fall back to episode parentId
      const parentData = parentsMap && episode.parentId ? parentsMap[episode.parentId] : null;
      const seasonImageUrl = parentData?.thumbnail
        ? normalizeImageUrl(parentData.thumbnail)
        : (episode.parentId ? ContentDisplayUrl(episode.parentId) : undefined);

      const queueItem = {
        id: plexId || episode.id || `episode-${Date.now()}`,
        plex: plexId, // Ensure plex ID is passed for downstream components
        show: showTitle,
        season: seasonTitle,
        title: episode.label,
        mediaUrl: episodeUrl,
        duration: episode.duration,
        thumbId: episode.thumbId, // Pass thumbId directly to FitnessPlayer
        image: episode.thumbId ? ContentDisplayUrl(episode.thumbId) : episode.image,
        parentId: episode.parentId,
        parentImage: seasonImageUrl,
        seasonImage: seasonImageUrl, // Alias for footer seek thumbnails
        labels: deriveEpisodeLabels(episode),
        type: episode.type || 'episode',
        showId,
        seconds: resolvedSeconds,
        watchSeconds: resolvedSeconds || undefined,
        watchProgress: Number.isFinite(normalizedProgress) ? normalizedProgress : undefined
      };

  // created queue item (debug removed)
      
      // Update the selected episode for the UI
      setSelectedEpisode(episode);
      
      // Clear any selected info to return to show mode
      setSelectedInfo(null);
      
      // Directly use the setter from props if available (from FitnessApp)
      if (setFitnessPlayQueue) {
  // using prop setter directly (debug removed)
        // Force a new array to ensure state change is detected
        setFitnessPlayQueue([queueItem]);
        // Notify parent to update URL
        if (typeof onPlay === 'function') onPlay(episode);
        return;
      }

      // Try the context setter as fallback
      if (contextSetPlayQueue) {
  // using context setter fallback (debug removed)
        // Force a new array to ensure state change is detected
        contextSetPlayQueue([queueItem]);
        // Notify parent to update URL
        if (typeof onPlay === 'function') onPlay(episode);
        return;
      }
      
      console.error('🎬 CRITICAL: No queue setter function available!');
      
      // Last resort: Try to access the window object and modify app state directly
      try {
        if (window && window.addToFitnessQueue) {
          // using window.addToFitnessQueue (debug removed)
          window.addToFitnessQueue(queueItem);
        }
      } catch (e) {
        console.error('🎬 Window method failed:', e);
      }
    } catch (error) {
      console.error('🎬 Error adding episode to play queue:', error);
    }
  };

  const { info, items = [], parents: parentsMap = null } = showData || {};

  const resumableLabels = useMemo(() => {
    const labels = plexConfig?.resumable_labels;
    return Array.isArray(labels) 
      ? new Set(labels.map(l => l.toLowerCase())) 
      : new Set();
  }, [plexConfig]);

  const isResumable = useMemo(() => {
    if (!info?.labels) return false;
    return info.labels.some(label => resumableLabels.has(label.toLowerCase()));
  }, [info, resumableLabels]);

  const sequentialLabels = useMemo(() => {
    const labels = plexConfig?.sequential_labels;
    return Array.isArray(labels)
      ? new Set(labels.map(l => l.toLowerCase()))
      : new Set();
  }, [plexConfig]);

  const isSequential = useMemo(() => {
    if (!info?.labels) return false;
    return info.labels.some(label => sequentialLabels.has(label.toLowerCase()));
  }, [info, sequentialLabels]);

  const governedLabelSet = useMemo(() => {
    if (contextGovernedLabelSet instanceof Set) return contextGovernedLabelSet;
    if (!Array.isArray(governedLabels) || !governedLabels.length) return new Set();
    return new Set(
      governedLabels
        .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [contextGovernedLabelSet, governedLabels]);

  const governedTypeSet = useMemo(() => {
    if (contextGovernedTypeSet instanceof Set) return contextGovernedTypeSet;
    if (!Array.isArray(governedTypes) || !governedTypes.length) return new Set();
    return new Set(
      governedTypes
        .map((type) => (typeof type === 'string' ? type.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [contextGovernedTypeSet, governedTypes]);

  const showLabelSet = useMemo(() => {
    const collected = [];
    const labelSources = [info?.labels, info?.Label];
    labelSources.forEach((source) => {
      if (!Array.isArray(source)) return;
      source.forEach((entry) => {
        if (typeof entry === 'string') {
          collected.push(entry);
        } else if (entry && typeof entry === 'object' && entry.tag) {
          collected.push(entry.tag);
        }
      });
    });
    return new Set(
      collected
        .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [info]);

  const showType = typeof info?.type === 'string'
    ? info.type.trim().toLowerCase()
    : (typeof info?.contentType === 'string' ? info.contentType.trim().toLowerCase() : '');

  const isGovernedShow = useMemo(() => {
    const typeGoverned = governedTypeSet.size > 0 && showType ? governedTypeSet.has(showType) : false;
    if (typeGoverned) return true;
    if (!governedLabelSet.size || !showLabelSet.size) return false;
    for (const label of showLabelSet) {
      if (governedLabelSet.has(label)) return true;
    }
    return false;
  }, [governedTypeSet, showType, governedLabelSet, showLabelSet]);

  // Derive seasons from parentsMap (backend groups object) with fallback to per-episode fields
  const seasons = useMemo(() => {
    // Preferred: parentsMap provided by API (canonical fields)
    if (parentsMap && typeof parentsMap === 'object' && Object.keys(parentsMap).length) {
      const arr = Object.entries(parentsMap).map(([id, g]) => {
        // Convert to string for comparison since Object.entries returns string keys
        // but episode.parentId may be a number from the API
        const count = items.filter(ep => String(ep.parentId) === id).length;
        // Use canonical field names: index, title, thumbnail
        const number = (g.index != null && !Number.isNaN(parseInt(g.index))) ? parseInt(g.index) : undefined;
        const nameRaw = g.title;
        const image = g.thumbnail || (items.find(ep => String(ep.parentId) === id)?.image);
        const description = g.summary || null;
        return {
          id,
          number,
          rawName: nameRaw,
          image,
          count,
          description,
          name: nameRaw || (Number.isFinite(number) ? `Season ${number}` : 'Season')
        };
      });
      arr.sort((a, b) => {
        const an = a.number, bn = b.number;
        const aHas = Number.isFinite(an), bHas = Number.isFinite(bn);

        // Special handling: season 0 (specials) goes to the end
        const aIsZero = aHas && an === 0;
        const bIsZero = bHas && bn === 0;
        if (aIsZero && !bIsZero) return 1;  // a (season 0) goes after b
        if (!aIsZero && bIsZero) return -1; // b (season 0) goes after a

        // Normal sorting for numbered seasons (excluding 0)
        if (aHas && bHas && an !== bn) return an - bn;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        const na = Number(a.id), nb = Number(b.id);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
      });
      return arr;
    }
    // Fallback: derive from episodes using canonical parentId
    const map = new Map();
    for (const ep of items) {
      if (!ep.parentId) continue;
      const number = undefined;
      const image = ep.image;
      if (!map.has(ep.parentId)) {
        map.set(ep.parentId, { id: ep.parentId, number, rawName: undefined, image, count: 1 });
      } else {
        const cur = map.get(ep.parentId);
        cur.count += 1;
        if (!cur.image && image) cur.image = image;
      }
    }
    const arr = Array.from(map.values()).map(s => ({
      ...s,
      name: (Number.isFinite(s.number) && s.number > 0) ? `Season ${s.number}` : (s.rawName || 'Season')
    }));
    return arr;
  }, [items, parentsMap]);

  // Compute set of locked episode IDs for sequential shows (linear across all seasons)
  const lockedEpisodeIds = useMemo(() => {
    if (!isSequential) return new Set();
    // Sort all items by season number then itemIndex to get global order
    const sorted = [...items].sort((a, b) => {
      const sa = seasons.find(s => String(s.id) === String(a.parentId));
      const sb = seasons.find(s => String(s.id) === String(b.parentId));
      const sn = (sa?.number ?? 0) - (sb?.number ?? 0);
      if (sn !== 0) return sn;
      const ai = Number.isFinite(a.itemIndex) ? a.itemIndex : Infinity;
      const bi = Number.isFinite(b.itemIndex) ? b.itemIndex : Infinity;
      return ai - bi;
    });
    const locked = new Set();
    let gateClosed = false;
    for (const ep of sorted) {
      if (gateClosed) {
        locked.add(ep.plex || ep.id);
      }
      if (!gateClosed && !(ep.isWatched ?? false)) {
        gateClosed = true;
      }
    }
    return locked;
  }, [isSequential, items, seasons]);

  // Initialize load tracking when items/seasons change
  useEffect(() => {
    // Build episode image map only if it actually changes size / keys
    const nextEpMap = {};
    for (const ep of items) {
      const key = ep.plex || ep.id;
      if (key !== undefined) nextEpMap[key] = loadedEpisodeImages[key] || false;
    }
    const epKeysChanged = Object.keys(nextEpMap).length !== Object.keys(loadedEpisodeImages).length ||
      Object.keys(nextEpMap).some(k => !(k in loadedEpisodeImages));
    if (epKeysChanged) setLoadedEpisodeImages(nextEpMap);

    const nextSeasonMap = {};
    for (const s of seasons) {
      const key = s.id;
      if (key !== undefined) nextSeasonMap[key] = loadedSeasonImages[key] || false;
    }
    const seasonKeysChanged = Object.keys(nextSeasonMap).length !== Object.keys(loadedSeasonImages).length ||
      Object.keys(nextSeasonMap).some(k => !(k in loadedSeasonImages));
    if (seasonKeysChanged) setLoadedSeasonImages(nextSeasonMap);
  }, [items, seasons]);

  // Initialize/adjust active season when items or seasons change
  useEffect(() => {
    if (!seasons.length) {
      if (activeSeasonId !== null) setActiveSeasonId(null);
      return;
    }

    const seasonById = (id) => seasons.find((s) => s.id === id);
    const seasonOne = seasons.find((s) => Number.isFinite(s.number) && s.number === 1);

    const isSeasonComplete = (season) => {
      if (!season) return false;
      const seasonEpisodes = items.filter((ep) => String(ep.parentId) === String(season.id));
      if (!seasonEpisodes.length) return false;
      return seasonEpisodes.every(isEpisodeWatched);
    };

    const findFirstIncompleteAfter = (startIndex = 0) => {
      const slice = seasons.slice(startIndex);
      return slice.find((season) => items.some((ep) => String(ep.parentId) === String(season.id) && !isEpisodeWatched(ep)));
    };

    const desiredSeasonId = (() => {
      if (seasonOne) {
        if (!isSeasonComplete(seasonOne)) return seasonOne.id; // prefer Season 1 even if specials exist
        const seasonOneIndex = seasons.findIndex((s) => s.id === seasonOne.id);
        const nextIncomplete = findFirstIncompleteAfter(seasonOneIndex + 1);
        if (nextIncomplete) return nextIncomplete.id;
        return seasonOne.id; // all complete -> default back to S01
      }
      const firstIncomplete = findFirstIncompleteAfter(0);
      return (firstIncomplete || seasons[0]).id;
    })();

    setActiveSeasonId((prev) => {
      const prevValid = prev && seasons.some((s) => s.id === prev);
      if (!prevValid) return desiredSeasonId ?? null;
      const prevSeason = seasonById(prev);
      const prevComplete = isSeasonComplete(prevSeason);
      const prevIsSpecials = prevSeason && Number.isFinite(prevSeason.number) && prevSeason.number === 0;
      if ((prevComplete || prevIsSpecials) && desiredSeasonId && desiredSeasonId !== prev) {
        return desiredSeasonId;
      }
      return prev;
    });
  }, [seasons, items, isEpisodeWatched]);

  // Keep selected episode in sync with filter
  useEffect(() => {
    const filtered = seasons.length > 1 && activeSeasonId
      ? items.filter(ep => String(ep.parentId) === String(activeSeasonId))
      : items;
    if (!filtered.length) return;
    if (!selectedEpisode || !filtered.some(ep => ep.plex === selectedEpisode.plex)) {
      setSelectedEpisode(filtered[0]);
    }
  }, [items, seasons, activeSeasonId]);

  const filteredItems = useMemo(() => {
    const list = (seasons.length > 1 && activeSeasonId)
      ? items.filter(ep => String(ep.parentId) === String(activeSeasonId))
      : items;
    // Sort by itemIndex ascending when available
    return [...list].sort((a, b) => {
      const an = Number.isFinite(a.itemIndex) ? a.itemIndex : (a.itemIndex != null ? parseInt(a.itemIndex) : NaN);
      const bn = Number.isFinite(b.itemIndex) ? b.itemIndex : (b.itemIndex != null ? parseInt(b.itemIndex) : NaN);
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
            <div className="episodes-grid zoom-150">
            {Array.from({ length: 8 }).map((_, i) => (
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
  const addToQueue = (episode, sourceEl = null) => {
    try {
      if (sourceEl) {
        const { didScroll } = scrollIntoViewIfNeeded(sourceEl, { axis: 'y', margin: 24 });
        if (didScroll) return;
      }
      // Extract plex ID from episode.plex, episode.play.plex, or from episode.id (format: "plex:662039")
      const extractPlexId = (ep) => {
        if (ep.plex) return String(ep.plex);
        if (ep.play?.plex) return String(ep.play.plex);
        if (typeof ep.id === 'string' && ep.id.startsWith('plex:')) {
          return ep.id.replace('plex:', '');
        }
        return null;
      };
      const plexId = extractPlexId(episode);

      // Get URL for the playable item if not present
      let episodeUrl = episode.url || episode.mediaUrl;
      if (!episodeUrl && plexId) {
        // Construct the URL using the new API proxy path
        episodeUrl = `/api/v1/proxy/plex/stream/${plexId}`;
      }

      if (episodeUrl) {
        const { resolvedSeconds, normalizedProgress } = deriveResumeMeta(episode);

        // Resolve season and show titles for logging
        const seasonObj = seasons && seasons.find(s => s.id === episode.parentId);
        const seasonTitle = seasonObj ? (seasonObj.title || seasonObj.name || seasonObj.rawName) : undefined;
        const showTitle = info?.title;

        const queueItem = {
          id: plexId || episode.id || `episode-${Date.now()}`,
          plex: plexId, // Ensure plex ID is passed for downstream components
          show: showTitle,
          season: seasonTitle,
          title: episode.label,
          mediaUrl: episodeUrl,
          duration: episode.duration,
          thumbId: episode.thumbId, // Pass thumbId directly to FitnessPlayer
          image: episode.thumbId ? ContentDisplayUrl(episode.thumbId) : episode.image,
          parentId: episode.parentId,
          parentImage: episode.parentId ? ContentDisplayUrl(episode.parentId) : undefined,
          labels: deriveEpisodeLabels(episode),
          type: episode.type || 'episode',
          showId,
          seconds: resolvedSeconds,
          watchSeconds: resolvedSeconds || undefined,
          watchProgress: Number.isFinite(normalizedProgress) ? normalizedProgress : undefined
        };

        // Use the appropriate setter
        if (setFitnessPlayQueue) {
          setFitnessPlayQueue(prevQueue => [...prevQueue, queueItem]);
        } else if (contextSetPlayQueue) {
          contextSetPlayQueue(prevQueue => [...prevQueue, queueItem]);
        }
  // added to queue (debug removed)
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
          {selectedInfo && infoType === 'season' && (
            <SeasonInfo item={selectedInfo} type="season" showSummary={info?.summary} />
          )}
          {selectedInfo && infoType === 'episode' && (
            <EpisodeInfo
              episode={selectedInfo}
              showInfo={info}
              parentsMap={parentsMap}
              parentsList={seasons}
              onPlay={handlePlayEpisode}
            />
          )}
          {!selectedInfo && info && (
            <>
              {/* Show Image - Top 50% */}
              <div className="show-poster" ref={posterRef}>
                {info.image && (
                  <img 
                    src={normalizeImageUrl(info.image)} 
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
                <div className="show-title-row">
                  <h1 className="show-title">{info.title}</h1>
                  {isGovernedShow && (
                    <span
                      className="governed-lock-icon"
                      title="Governed content"
                      aria-label="Governed content"
                      role="img"
                    >
                      🔒
                    </span>
                  )}
                  {fitnessSessionInstance?.isActive && (
                    <button
                      type="button"
                      className="show-voice-memo-btn"
                      onClick={() => openVoiceMemoCapture?.(null)}
                      aria-label="Record voice memo"
                      title="Record voice memo"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </button>
                  )}
                </div>
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
                  const seasonEpisodes = filteredItems.filter(ep => String(ep.parentId) === String(s.id));
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
                        {seasonEpisodes.map((episode, index) => {
                          const watchProgress = normalizeNumber(episode.watchProgress) ?? 0;
                          const watchedDate = episode.watchedDate;
                          // Trust backend-computed isWatched (SSOT)
                          const isWatched = episode.isWatched ?? false;
                          const hasProgress = watchProgress > 15;
                          const progressPercent = Math.max(0, Math.min(100, watchProgress));
                          const showProgressBar = isResumable && hasProgress && !isWatched;
                          const episodeNumber = Number.isFinite(episode?.itemIndex)
                            ? episode.itemIndex
                            : null;
                          const isLocked = lockedEpisodeIds.has(episode.plex || episode.id);

                          return (
                          <div
                            key={episode.plex || index}
                            className={`episode-card vertical ${selectedEpisode?.plex === episode.plex ? 'selected' : ''} ${isWatched ? 'watched' : ''} ${showProgressBar ? 'in-progress' : ''} ${isLocked ? 'locked' : ''}`}
                            title={episode.label}
                          >
                            {episode.image && (
                              <div
                                className="episode-thumbnail"
                                data-testid="episode-thumbnail"
                                data-plex-id={episode.plex || episode.id}
                                onPointerDown={isLocked ? undefined : (e) => handlePlayEpisode(episode, e.currentTarget.closest('.episode-card'), e)}
                                onClick={isLocked ? undefined : (e) => handlePlayEpisode(episode, e.currentTarget.closest('.episode-card'), e)}
                              >
                                <img
                                  src={normalizeImageUrl(episode.image)}
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
                                  {isWatched && watchedDate && (
                                    <div className="badge watched-date">
                                     ✔️ {formatWatchedDate(watchedDate)}
                                    </div>
                                  )}
                                    {showProgressBar && progressPercent > 0 && (
                                      <div className="badge progress-percent">
                                        {Math.round(progressPercent)}%
                                      </div>
                                    )}
                                </div>
                                {showProgressBar && (
                                <div className="thumbnail-progress">
                                  <div className="progress-bar" style={{ width: `${progressPercent}%` }} />
                                </div>
                                )}
                              </div>
                            )}
                            <div
                              className="episode-title"
                              aria-label={episode.label}
                              onPointerDown={isLocked ? undefined : (e) => {
                                const card = e.currentTarget.closest('.episode-card');
                                const { didScroll } = scrollIntoViewIfNeeded(card, { axis: 'y', margin: 24 });
                                if (didScroll) return; // require second tap when visible
                                setSelectedInfo({ ...episode, title: episode.label });
                                setInfoType('episode');
                                handleEpisodeSelect(episode);
                              }}
                            >
                              <div className="episode-title-flex">
                                {isLocked ? (
                                  <span className="episode-pill episode-pill-locked" aria-hidden="true">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 10h-1V7c0-2.76-2.24-5-5-5S7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2ZM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3-7H9V7c0-1.66 1.34-3 3-3s3 1.34 3 3v3Z"/></svg>
                                  </span>
                                ) : typeof episodeNumber === 'number' ? (
                                  <span className="episode-pill" aria-hidden="true">
                                    {episodeNumber}
                                  </span>
                                ) : null}
                                <span className="episode-title-text">{episode.label}</span>
                              </div>
                            </div>
                          </div>
                        );})}
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
                // Expose caption metrics to CSS for precise wrapper sizing
                ['--caption-rem']: '1.5rem',
                ['--caption-gap']: '0.35rem',
              }}
            >
              {seasons.map((s, idx) => (
                <button
                  key={s.id}
                  className={`season-item ${activeSeasonId === s.id ? 'active' : ''}`}
                  onPointerDown={(e) => {
                    const btn = e.currentTarget;
                    // Prefer horizontal visibility for the season bar; fall back to vertical if needed
                    scrollIntoViewIfNeeded(btn, { axis: 'x', margin: 24 });
                    const { didScroll } = scrollIntoViewIfNeeded(btn, { axis: 'y', margin: 24 });
                    if (didScroll) return;
                    setActiveSeasonId(s.id);
                    const episodeCount = items.filter(ep => String(ep.parentId) === String(s.id)).length;
                    const hasRealDescription = !!(s.description && s.description.trim());
                    setSelectedInfo({
                      ...s,
                      episodeCount,
                      title: s.name || s.rawName,
                      ...(hasRealDescription ? { summary: s.description } : {})
                    });
                    setInfoType('season');
                  }}
                >
                                <div className="season-image-wrapper" style={{backgroundImage: s.image ? `url(${normalizeImageUrl(s.image)})` : 'none'}}>
                                  {s.image ? (
                                    <img
                                      src={normalizeImageUrl(s.image)}
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
                                  {/* Episode count overlay top-right */}
                                  <div className="season-episode-count" aria-label={`${s.count || 0} episodes`}>
                      {s.count || 0}
                    </div>
                  </div>
                  <div className="season-caption" title={s.rawName || s.name}>
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