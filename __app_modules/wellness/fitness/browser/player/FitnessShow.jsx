import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Alert } from '@mantine/core';
import { DaylightAPI, ContentDisplayUrl, normalizeImageUrl } from '@/lib/api.mjs';
import "./FitnessShow.scss";
import { useFitness } from "../context/FitnessContext.jsx";
import moment from 'moment';
import { buildVirtualSeasons } from "../lib/playlistVirtualSeasons.js";
import { formatFitnessDate } from "../lib/dateFormatter.js";
import { useIdentity } from "../identity/useIdentity.js";
import UnlockPrompt from "./overlays/UnlockPrompt.jsx";
import PresenceGateNotice from "./overlays/PresenceGateNotice.jsx";
import usePresenceGate from "../hooks/usePresenceGate.js";
import usePresenceGatePrompt from "./usePresenceGatePrompt.js";
import LockIcon from "./overlays/LockIcon.jsx";
import { isKioskEnv } from '@/lib/kioskEnv.js';
import { useGamepadKeys } from "../lib/useGamepadKeys.js";
import getLogger from '@/lib/logging/Logger.js';
import { isGovernedContainer } from "../hooks/fitness/governedContent.js";
import { gridBadge } from "../lib/episodeHistory.js";
import { RiderStack } from "./EpisodeHistory.jsx";
import EpisodePanel from "./EpisodePanel.jsx";

// Accepts the media server's "YYYY-MM-DD hh:mm:ssa" string or a session's epoch ms.
const formatWatchedDate = (dateInput) => {
  try {
    if (dateInput == null || dateInput === '') return '';
    const parsed = typeof dateInput === 'number' || dateInput instanceof Date
      ? moment(dateInput)
      : moment(dateInput, 'YYYY-MM-DD hh:mm:ssa');
    const today = moment();
    const yesterday = moment().subtract(1, 'days');
    if (parsed.isSame(today, 'day')) return 'Today';
    if (parsed.isSame(yesterday, 'day')) return 'Yesterday';
    // For episodes viewed over 12 months ago, include the YYYY year so the
    // year is disambiguated (the default short format omits it).
    if (parsed.isBefore(moment().subtract(12, 'months'))) {
      return formatFitnessDate(parsed.toDate(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    return formatFitnessDate(parsed.toDate());
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
  // For virtual seasons, item.image is already a resolved URL; for real seasons use ContentDisplayUrl
  const isVirtual = item.id && String(item.id).startsWith('virtual-');
  const seasonImageSrc = type === 'season'
    ? (isVirtual && item.image ? normalizeImageUrl(item.image) : (item.id ? ContentDisplayUrl(item.contentId || item.id) : normalizeImageUrl(item.image)))
    : normalizeImageUrl(item.image);

  return (
    <div className={`season-info ${type}-info`}>
      {(item.image || seasonImageSrc) && (
        <div className="info-image-container">
          <img
            src={seasonImageSrc}
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

/**
 * An episode's identity. Playable items may carry only `id` ("plex:600747")
 * with no `plex` field — comparing `.plex` alone matches every such episode.
 */
const episodeKey = (ep) => (ep ? String(ep.plex || ep.id || '') || null : null);

/** A season's display name: its title, else "Season N", else "Season". */
const seasonNameOf = (parent = {}) => {
  const raw = parent.title || parent.name;
  if (raw && String(raw).trim()) return String(raw);
  const n = Number.isFinite(parent.index) ? parent.index : (Number.isFinite(parent.number) ? parent.number : parseInt(parent.id, 10));
  return Number.isFinite(n) ? `Season ${n}` : 'Season';
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

// The presence-gate prompt waits longer than a casual unlock: it is the only way in.
const PRESENCE_PROMPT_TIMEOUT_MS = 30000;

const FitnessShow = ({ showId: rawShowId, episodeId: preSelectEpisodeId, onBack: _onBack, viewportRef, setFitnessPlayQueue, onPlay }) => {
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
  // Automatic progression may choose an initial/next season, but a season the
  // user explicitly selected is authoritative until they leave this show.
  const explicitSeasonSelectionRef = useRef({ showId: null, seasonId: null });
  const seasonBarRef = useRef(null);
  const [, setSeasonBarWidth] = useState(0);
  const [selectedInfo, setSelectedInfo] = useState(null); // Selected episode or season for info panel
  const [infoType, setInfoType] = useState('episode'); // 'episode' or 'season'
  const [loadedEpisodeImages, setLoadedEpisodeImages] = useState({});
  // Bumped with every show refresh (an episode just ended) so the per-rider
  // history refetches too — the episode ids alone don't change.
  const [historyRefresh, setHistoryRefresh] = useState(0);
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
    openVoiceMemoCapture,
    setCurrentMedia
  } = fitnessContext;
  const nomusicLabelSet = useMemo(() => {
    const normalized = Array.isArray(nomusicLabels)
      ? nomusicLabels.filter((label) => typeof label === 'string').map((label) => label.trim().toLowerCase())
      : [];
    return new Set(normalized);
  }, [nomusicLabels]);

  // Config-driven locks map (e.g. { governance_bypass: ['user_1'], skip_content: [...] }).
  // A lock is ACTIVE iff its value is a non-empty array of authorized usernames.
  // Surfaced via the unified fitness config (root + nested fitness block) — mirrors
  // FitnessModuleMenu (Task 4.1). Absent/empty lock ⇒ today's behavior unchanged.
  const locks = useMemo(() => {
    const cfg = fitnessContext.fitnessConfiguration || {};
    return cfg.locks || cfg.fitness?.locks || {};
  }, [fitnessContext.fitnessConfiguration]);
  // Kiosk-bound: locks only apply on the garage kiosk (unlocked in dev/test).
  const isLockActive = useCallback(
    (lockName) => isKioskEnv() && Array.isArray(locks?.[lockName]) && locks[lockName].length > 0,
    [locks]
  );

  // One unlock instance owned by FitnessShow. `pendingUnlock` describes the action
  // to perform when a fingerprint matches; null means no prompt is open. Mirrors the
  // hook+prompt+pendingLaunch wiring from FitnessModuleMenu (Task 4.1).
  const { registerUnlock, unlockState, unlockedUser, clearUnlock } = useIdentity();
  const [pendingUnlock, setPendingUnlock] = useState(null); // { lock, label, episode? }

  // Once a governance_bypass fingerprint matches, episodes launched from this show
  // are marked to skip governance. (See handlePlayEpisode + the T4.3 seam below.)
  const [governanceBypassed, setGovernanceBypassed] = useState(false);

  const closeUnlock = useCallback(() => {
    setPendingUnlock(null);
    clearUnlock();
  }, [clearUnlock]);

  // FitnessShow is rendered WITHOUT a key (FitnessApp), so navigating between
  // shows reuses this same instance instead of remounting. Reset all unlock state
  // when the show changes, otherwise a governance bypass granted on show A (or an
  // open prompt) would leak into show B — a real authorization bypass once the
  // per-item nogovern seam is wired (T4.3). `showIdRef` lets in-flight scans that
  // resolve after a show change bail out instead of acting on the wrong show.
  const showIdRef = useRef(showId);
  useEffect(() => {
    showIdRef.current = showId;
    explicitSeasonSelectionRef.current = { showId: null, seasonId: null };
    setGovernanceBypassed(false);
    setPendingUnlock(null);
    clearUnlock();
  }, [showId, clearUnlock]);

  // Presence gate (fitness config `presence_gate`): while the supervising adult
  // is away, opening a show needs an admin fingerprint. Declared AFTER the reset
  // effect above so its clearUnlock() on a show change never cancels this prompt.
  const presenceGate = usePresenceGate('show');
  const presencePrompt = usePresenceGatePrompt(presenceGate, showId ? String(showId) : null, {
    kind: 'show',
    onDismiss: _onBack,
  });

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
      // If this is a playlist, create virtual seasons for pagination and
      // sort episodes by rating DESC so the top-starred ones appear first.
      if (response.info?.type === 'playlist') {
        const pageSize = plexConfig?.playlist_episodes_per_season || 20;
        const { parents, items: taggedItems } = buildVirtualSeasons(response.items || [], pageSize, {
          resolveShowImage: (gpId) => ContentDisplayUrl(gpId),
          sortByRating: true
        });
        response.parents = parents;
        response.items = taggedItems;
        // Use playlist image for show display
        if (!response.image && response.info?.image) {
          response.image = response.info.image;
        }
      }
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
      
      // Auto-select pre-specified episode or fall back to first
      if (response.items && response.items.length > 0) {
        const preSelectLocalId = preSelectEpisodeId?.replace(/^[a-z]+:/i, '');
        const preSelected = preSelectLocalId
          ? response.items.find(ep => ep.localId === preSelectLocalId || ep.id === preSelectEpisodeId)
          : null;
        setSelectedEpisode(preSelected || response.items[0]);
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
  }, [showId, preSelectEpisodeId, nomusicLabelSet, plexConfig]);

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
      if (targetId && String(targetId).replace(/^[a-z]+:/i, '') !== String(showId)) return;
      fetchShowData();
      setHistoryRefresh((n) => n + 1);
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
  useMemo(() => {
    const el = viewportRef?.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, [viewportRef]);

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
    // Judged by the library's rule: watch_completion in household media config
    return episode?.isWatched ?? false;
  }, []);

  const handlePlayEpisode = async (episode, sourceEl = null, event = null) => {
    // Play vs. Scroll mutual exclusion (FRD Q2 item 4.2).
    // If a tap would cause the episode list to scroll (item partially off-screen),
    // suppress playback on THIS tap — only scroll. A second tap, now with the
    // episode fully visible, runs the play. `scrollIntoViewIfNeeded` returns
    // didScroll:true only when it triggered a scroll > 1px (see line 504), so
    // already-visible items always pass through.
    if (sourceEl) {
      const { didScroll } = scrollIntoViewIfNeeded(sourceEl, { axis: 'y', margin: 8 });
      if (didScroll) return;
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

      const candidateId = plexId || episode.id || `episode-${Date.now()}`;
      const queueItem = {
        id: candidateId,
        contentId: plexId
          ? `plex:${plexId}`
          : (typeof candidateId === 'string' && /^[a-z]+:/i.test(candidateId) ? candidateId : null),
        plex: plexId, // Ensure plex ID is passed for downstream components
        source: plexId ? 'plex' : (episode.source || null),
        show: showTitle,
        season: seasonTitle,
        title: episode.label,
        grandparentTitle: String(episode.grandparentTitle || showTitle || ''),
        grandparentId: episode.grandparentId || showId,
        summary: episode.summary || null,
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
        watchProgress: Number.isFinite(normalizedProgress) ? normalizedProgress : undefined,
        // After a matched governance_bypass unlock, mark the queue item so the player
        // skips governance for this launch. FitnessPlayer honors this per-item flag via
        // `currentItem.nogovern` → shouldBypassGovernance (alongside the sticky ?nogovern
        // prop and the in-player runtime bypass). Wired in T4.3.
        nogovern: governanceBypassed || undefined
      };

      // Ground-truth the governance-bypass seam: record whether this launch carries
      // the per-item nogovern flag (set by a granted governance_bypass unlock). If a
      // re-entry after "unlock the whole show" still shows governance, this tells us
      // whether the flag was lost before the queue item was built.
      getLogger().child({ component: 'FitnessShow' }).info('fitness.show.launch_episode', {
        episode: candidateId,
        governanceBypassed,
        nogovern: Boolean(queueItem.nogovern)
      });

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

  // Governed-show "Unlock" affordance: request a governance_bypass fingerprint.
  // On match, flip the local `governanceBypassed` flag so subsequent plays mark
  // their queue item to skip governance (see handlePlayEpisode seam). Denied/cancel/
  // timeout leaves the prompt up (or closes via closeUnlock) and does NOT bypass.
  const handleGovernanceUnlockTap = () => {
    if (pendingUnlock) return; // ignore taps while a prompt is open
    const reqShowId = showId; // guard: ignore a scan that resolves after a show change
    const logger = getLogger().child({ component: 'FitnessShow' });
    logger.info('fitness.show.unlock_tap', { lock: 'governance_bypass', show: info?.title });
    setPendingUnlock({ lock: 'governance_bypass', label: info?.title || 'Governed content' });
    registerUnlock('governance_bypass').then((result) => {
      if (showIdRef.current !== reqShowId) return; // show changed mid-scan — abort
      if (result?.matched) {
        logger.info('fitness.show.governance_bypassed', { show: info?.title, userId: result.userId });
        setGovernanceBypassed(true);
        closeUnlock();
      }
      // matched:false / denied — leave the prompt showing the denied state; the user
      // dismisses via cancel/close which calls closeUnlock().
    });
  };

  // Sequential locked-episode affordance: request a skip_content fingerprint.
  // On match, play that episode via the normal launch path. Denied/cancel/timeout
  // does NOT play.
  const handleLockedEpisodeUnlockTap = (episode, sourceEl = null) => {
    // Scroll vs. Unlock mutual exclusion: in the scrollable episode list, scroll
    // wins. If this tap would scroll the item into view (it was partially off-
    // screen), suppress the unlock on THIS tap — only scroll. A second tap, now
    // with the episode fully visible, opens the prompt. Mirrors handlePlayEpisode.
    if (sourceEl) {
      const { didScroll } = scrollIntoViewIfNeeded(sourceEl, { axis: 'y', margin: 8 });
      if (didScroll) return;
    }
    if (pendingUnlock) return; // ignore taps while a prompt is open
    const reqShowId = showId; // guard: ignore a scan that resolves after a show change
    const logger = getLogger().child({ component: 'FitnessShow' });
    logger.info('fitness.show.unlock_tap', { lock: 'skip_content', episode: episode?.plex || episode?.id });
    setPendingUnlock({ lock: 'skip_content', label: episode?.label || 'Locked episode', episode });
    registerUnlock('skip_content').then((result) => {
      if (showIdRef.current !== reqShowId) return; // show changed mid-scan — abort
      if (result?.matched) {
        logger.info('fitness.show.skip_content_granted', { episode: episode?.plex || episode?.id, userId: result.userId });
        closeUnlock();
        handlePlayEpisode(episode);
      }
      // matched:false / denied — leave the prompt up; user dismisses via closeUnlock().
    });
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

  // Lock icon (rendered at show-title-row) is driven by this flag. A show is
  // governed iff it carries a governed scope-label (e.g. KidsFun), constrained to
  // `governed_types` as a SCOPE (a show's type is "show", always in the default
  // [show, movie]). Type alone NEVER locks — that would lock every show. This is
  // the same rule as the backend's getItemsByLabel(governedLabels, { types }) and
  // the runtime engine's label trigger. See governedContent.js.
  const isGovernedShow = useMemo(
    () => isGovernedContainer({ type: showType, labels: showLabelSet }, governedLabelSet, governedTypeSet),
    [governedTypeSet, showType, governedLabelSet, showLabelSet]
  );

  // Diagnostic: log each show-lock evaluation so an unexpected-lock report can be
  // root-caused from the session log (look for fitness.show-lock-eval events).
  useEffect(() => {
    if (!info?.title) return;
    const logger = getLogger().child({ component: 'FitnessShow' });
    logger.debug('fitness.show-lock-eval', {
      title: info.title,
      showType,
      governedTypes: Array.from(governedTypeSet),
      showLabels: Array.from(showLabelSet),
      governedLabels: Array.from(governedLabelSet),
      result: isGovernedShow
    });
  }, [info?.title, showType, governedTypeSet, showLabelSet, governedLabelSet, isGovernedShow]);

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
  }, [items, loadedEpisodeImages, loadedSeasonImages, seasons]);

  // Initialize/auto-advance the active season when progress data changes.
  // An explicit selection always wins, including when a later data refresh
  // would otherwise advance away from a completed season.
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

    const explicitSeasonId = explicitSeasonSelectionRef.current.showId === showId
      ? explicitSeasonSelectionRef.current.seasonId
      : null;
    const explicitSeasonValid = explicitSeasonId != null
      && seasons.some((season) => season.id === explicitSeasonId);

    if (explicitSeasonId != null && !explicitSeasonValid) {
      explicitSeasonSelectionRef.current = { showId: null, seasonId: null };
    }

    // Progress-driven defaults must never override a valid explicit choice.
    if (explicitSeasonValid) {
      if (activeSeasonId !== explicitSeasonId) {
        getLogger().child({ component: 'FitnessShow' }).info('fitness.show.season_explicit_restored', {
          showId,
          fromSeasonId: activeSeasonId,
          toSeasonId: explicitSeasonId
        });
        setActiveSeasonId(explicitSeasonId);
      }
      return;
    }

    const activeSeason = seasonById(activeSeasonId);
    const activeSeasonValid = Boolean(activeSeason);
    const activeSeasonComplete = isSeasonComplete(activeSeason);
    const activeSeasonIsSpecials = activeSeason
      && Number.isFinite(activeSeason.number)
      && activeSeason.number === 0;

    let nextSeasonId = activeSeasonId;
    let reason = null;
    if (!activeSeasonValid) {
      nextSeasonId = desiredSeasonId ?? null;
      reason = activeSeasonId == null ? 'initialize' : 'selection_invalid';
    } else if ((activeSeasonComplete || activeSeasonIsSpecials)
      && desiredSeasonId
      && desiredSeasonId !== activeSeasonId) {
      nextSeasonId = desiredSeasonId;
      reason = activeSeasonComplete ? 'season_complete' : 'specials_default';
    }

    if (nextSeasonId !== activeSeasonId) {
      const nextSeason = seasonById(nextSeasonId);
      getLogger().child({ component: 'FitnessShow' }).info('fitness.show.season_auto_selected', {
        showId,
        fromSeasonId: activeSeasonId,
        toSeasonId: nextSeasonId,
        fromSeasonNumber: activeSeason?.number ?? null,
        toSeasonNumber: nextSeason?.number ?? null,
        reason
      });
      setActiveSeasonId(nextSeasonId);
    }
  }, [seasons, items, isEpisodeWatched, activeSeasonId, showId]);

  // Keep selected episode in sync with filter
  useEffect(() => {
    const filtered = seasons.length > 1 && activeSeasonId
      ? items.filter(ep => String(ep.parentId) === String(activeSeasonId))
      : items;
    if (!filtered.length) return;
    if (!selectedEpisode || !filtered.some(ep => episodeKey(ep) === episodeKey(selectedEpisode))) {
      setSelectedEpisode(filtered[0]);
    }
  }, [items, seasons, activeSeasonId, selectedEpisode]);

  // Per-rider history for this show's episodes, from the session log. The
  // media server's watched date stays the fallback when this is empty or fails.
  const [episodeHistory, setEpisodeHistory] = useState({});
  const historyEpisodeIds = useMemo(() => {
    const ids = (showData?.items || []).map((ep) => ep?.id || ep?.plex).filter(Boolean);
    return [...new Set(ids.map(String))].join(',');
  }, [showData]);
  useEffect(() => {
    if (!historyEpisodeIds) { setEpisodeHistory({}); return undefined; }
    let cancelled = false;
    const log = getLogger().child({ component: 'FitnessShow' });
    DaylightAPI(`/api/v1/fitness/sessions/episode-history?episodes=${encodeURIComponent(historyEpisodeIds)}`)
      .then((response) => {
        if (cancelled) return;
        const episodes = response?.episodes && typeof response.episodes === 'object' ? response.episodes : {};
        setEpisodeHistory(episodes);
        log.debug('fitness.show.episode_history_loaded', { showId: showIdRef.current, episodes: Object.keys(episodes).length, refresh: historyRefresh });
      })
      .catch((err) => {
        if (!cancelled) log.warn('fitness.show.episode_history_failed', { showId: showIdRef.current, error: err?.message });
      });
    return () => { cancelled = true; };
    // Keyed on the loaded show's ids (not showId, which changes before its data
    // arrives and would scan once with the previous show's ids) and on refreshes.
  }, [historyEpisodeIds, historyRefresh]);
  const historyFor = useCallback((episode) => episodeHistory[episode?.id] || episodeHistory[`plex:${episode?.plex}`] || null, [episodeHistory]);

  // The panel always describes the focused episode: the next-up one on load,
  // then whatever was tapped (title strip, mosaic) or reached with the pad.
  const panelEpisode = (infoType === 'episode' && selectedInfo) || selectedEpisode || null;
  const focusEpisode = useCallback((episode) => {
    if (!episode) return;
    setSelectedInfo(null);
    setInfoType('episode');
    setSelectedEpisode(episode);
    getLogger().child({ component: 'FitnessShow' }).debug('fitness.show.episode_focus', { showId: showIdRef.current, episode: episode.plex || episode.id });
  }, []);
  // Household riders (never guests) for "who's done it" and season coverage.
  const household = useMemo(() => {
    const primary = fitnessContext.usersConfig?.primary;
    return (Array.isArray(primary) ? primary : [])
      .filter((u) => u && u.id)
      .map((u) => ({ id: u.id, displayName: u.name || u.id }));
  }, [fitnessContext.usersConfig]);
  const activeRiderIds = (fitnessSessionInstance?.roster || []).map((e) => e?.id || e?.profileId).filter(Boolean);

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

  // The mosaic shows the focused episode's season as the grid has it (a
  // playlist's current page of 20 included).
  const panelSeasonEpisodes = useMemo(() => {
    if (!panelEpisode) return [];
    const same = filteredItems.filter((ep) => String(ep.parentId) === String(panelEpisode.parentId));
    return same.length ? same : filteredItems;
  }, [filteredItems, panelEpisode]);
  const playFromPanel = (episode, mode) => {
    getLogger().child({ component: 'FitnessShow' }).info('fitness.show.panel_play', { showId: showIdRef.current, episode: episode.plex || episode.id, mode });
    const target = mode === 'start-over'
      ? { ...episode, watchSeconds: 0, watchProgress: 0, seconds: 0, resumeSeconds: 0 }
      : episode;
    handlePlayEpisode(target);
  };

  // Gamepad / arrow keys: the D-pad walks the grid and focus selects (the panel
  // follows); A / Enter plays the focused episode. Focus alone never launches,
  // and a locked episode is left to its tap-to-unlock path. Keys belong to the
  // sidebar menu while it is open, and to the player while something plays.
  const [padFocused, setPadFocused] = useState(false);
  const handleShowKey = (key) => {
    if (typeof document !== 'undefined' && document.querySelector('.fitness-sidebar-menu')) return false;
    if (fitnessPlayQueue?.length > 0 || pendingUnlock) return false;
    const list = filteredItems;
    if (!list.length) return false;
    const current = Math.max(0, list.findIndex((ep) => episodeKey(ep) === episodeKey(panelEpisode)));
    if (key === 'Enter') {
      const ep = list[current];
      if (lockedEpisodeIds.has(ep.plex || ep.id)) {
        getLogger().child({ component: 'FitnessShow' }).info('fitness.show.pad_play_locked', { episode: ep.plex || ep.id });
        return true;
      }
      const resumable = isResumable && !ep.isWatched && deriveResumeMeta(ep).resolvedSeconds > 0;
      playFromPanel(ep, resumable ? 'resume' : 'play');
      return true;
    }
    const grid = typeof document !== 'undefined' ? document.querySelector('.fitness-show .episodes-grid') : null;
    const columns = (() => {
      const tpl = grid ? getComputedStyle(grid).gridTemplateColumns : '';
      const n = tpl ? tpl.split(' ').filter(Boolean).length : 0;
      return n > 0 ? n : 3;
    })();
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key];
    if (step == null) return false;
    const next = list[Math.min(list.length - 1, Math.max(0, current + step))];
    setPadFocused(true);
    focusEpisode(next);
    const card = document.querySelector(`.fitness-show [data-plex-id="${next.plex || next.id}"]`)?.closest('.episode-card');
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    return true;
  };
  const showKeyRef = useRef(handleShowKey);
  showKeyRef.current = handleShowKey;
  useGamepadKeys(true, (key) => showKeyRef.current(key));
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (showKeyRef.current(event.key)) event.preventDefault();
    };
    // A touch anywhere drops the pad focus ring; the next D-pad press brings it back.
    const onPointerDown = () => setPadFocused(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

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

  // Gated: the show's contents never render, so nothing can be browsed or played.
  if (presencePrompt.blocked) {
    return (
      <div className="fitness-show presence-gated" style={{ position: 'relative', minHeight: '100%' }}>
        {!presencePrompt.open && presenceGate.settled && (
          <PresenceGateNotice onUnlock={presencePrompt.retry} onBack={_onBack} />
        )}
        <UnlockPrompt
          open={presencePrompt.open}
          state={presencePrompt.state}
          lockLabel="Grown-up needed"
          unlockedUser={presencePrompt.unlockedUser}
          onCancel={presencePrompt.cancel}
          timeoutMs={PRESENCE_PROMPT_TIMEOUT_MS}
        />
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
    
  // The governed-show lock and the voice-memo button ride beside the show title,
  // wherever the panel puts it.
  const titleBadges = (
    <>
      {isGovernedShow && (
        governanceBypassed ? (
          <span
            className="governed-lock-icon governed-lock-icon--unlocked"
            title="Governance unlocked"
            aria-label="Governance unlocked"
            role="img"
          >
            🔓
          </span>
        ) : isLockActive('governance_bypass') ? (
          <button
            type="button"
            className="governed-lock-icon governed-lock-icon--button"
            title="Unlock governed content"
            aria-label="Unlock governed content"
            onPointerDown={handleGovernanceUnlockTap}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleGovernanceUnlockTap();
              }
            }}
          >
            <LockIcon />
          </button>
        ) : (
          <span
            className="governed-lock-icon"
            title="Governed content"
            aria-label="Governed content"
            role="img"
          >
            <LockIcon />
          </span>
        )
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
    </>
  );

  return (
    <div className="fitness-show">

      <div className="show-content">
        {/* Left Panel - Show Info */}
        <div className="show-info-panel">
          {selectedInfo && infoType === 'season' && (
            <SeasonInfo item={selectedInfo} type="season" showSummary={info?.summary} />
          )}
          {!(selectedInfo && infoType === 'season') && panelEpisode && (
            <EpisodePanel
              episode={panelEpisode}
              showTitle={panelEpisode.grandparentTitle && String(panelEpisode.parentId || '').startsWith('virtual-')
                ? panelEpisode.grandparentTitle
                : info?.title}
              seasonName={seasonNameOf((parentsMap && parentsMap[panelEpisode.parentId]) || seasons.find((x) => x.id === panelEpisode.parentId) || {})}
              seasonEpisodes={panelSeasonEpisodes}
              historyFor={historyFor}
              household={household}
              activeIds={activeRiderIds}
              resumeSeconds={isResumable && !panelEpisode.isWatched ? deriveResumeMeta(panelEpisode).resolvedSeconds : 0}
              formatDate={formatWatchedDate}
              onFocus={focusEpisode}
              onPlay={playFromPanel}
              headerExtras={titleBadges}
            />
          )}
          {!(selectedInfo && infoType === 'season') && !panelEpisode && info && (
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
                  {titleBadges}
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
                  Number.isFinite(s.number) && s.number > 0 ? `Season ${s.number}` : (s.rawName || s.name || 'Season');
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
                          const progressPercent = Math.max(0, Math.min(100, watchProgress));
                          const showProgressBar = isResumable && watchProgress > 0 && !isWatched;
                          const episodeNumber = Number.isFinite(episode?.itemIndex)
                            ? episode.itemIndex
                            : null;
                          const isLocked = lockedEpisodeIds.has(episode.plex || episode.id);
                          const riderBadge = showProgressBar ? null : gridBadge(historyFor(episode), episode.duration);

                          return (
                          <div
                            key={episode.plex || index}
                            className={`episode-card vertical ${episodeKey(selectedEpisode) === episodeKey(episode) ? 'selected' : ''} ${padFocused && episodeKey(panelEpisode) === episodeKey(episode) ? 'pad-focused' : ''} ${isWatched ? 'watched' : ''} ${showProgressBar ? 'in-progress' : ''} ${isLocked ? 'locked' : ''}`}
                            title={episode.label}
                          >
                            {episode.image && (
                              <div
                                className="episode-thumbnail"
                                data-testid="episode-thumbnail"
                                data-plex-id={episode.plex || episode.id}
                                onPointerDown={isLocked
                                  ? (isLockActive('skip_content') ? (e) => handleLockedEpisodeUnlockTap(episode, e.currentTarget.closest('.episode-card')) : undefined)
                                  : (e) => handlePlayEpisode(episode, e.currentTarget.closest('.episode-card'), e)}
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
                                  {riderBadge ? (
                                    <div className="badge watched-date watched-date--riders" data-testid="episode-rider-badge">
                                      <RiderStack riders={riderBadge.riders} overflow={riderBadge.overflow} />
                                      {formatWatchedDate(riderBadge.latestStartTime)}
                                    </div>
                                  ) : isWatched && watchedDate && (
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
                              onPointerDown={isLocked
                                ? (isLockActive('skip_content') ? (e) => handleLockedEpisodeUnlockTap(episode, e.currentTarget.closest('.episode-card')) : undefined)
                                : (e) => {
                                const card = e.currentTarget.closest('.episode-card');
                                const { didScroll } = scrollIntoViewIfNeeded(card, { axis: 'y', margin: 24 });
                                if (didScroll) return; // require second tap when visible
                                focusEpisode(episode);
                              }}
                            >
                              <div className="episode-title-flex">
                                {isLocked ? (
                                  isLockActive('skip_content') ? (
                                    <button
                                      type="button"
                                      className="episode-pill episode-pill-locked episode-pill-locked--button"
                                      aria-label="Unlock episode"
                                      title="Unlock episode"
                                      onPointerDown={(e) => {
                                        e.stopPropagation();
                                        handleLockedEpisodeUnlockTap(episode, e.currentTarget.closest('.episode-card'));
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          handleLockedEpisodeUnlockTap(episode);
                                        }
                                      }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 10h-1V7c0-2.76-2.24-5-5-5S7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2ZM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3-7H9V7c0-1.66 1.34-3 3-3s3 1.34 3 3v3Z"/></svg>
                                    </button>
                                  ) : (
                                    <span className="episode-pill episode-pill-locked" aria-hidden="true">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 10h-1V7c0-2.76-2.24-5-5-5S7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2ZM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3-7H9V7c0-1.66 1.34-3 3-3s3 1.34 3 3v3Z"/></svg>
                                    </span>
                                  )
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
                <div className="no-episodes-text">This show doesn&apos;t have any available episodes</div>
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
              {seasons.map((s, _idx) => (
                <button
                  key={s.id}
                  className={`season-item ${activeSeasonId === s.id ? 'active' : ''}`}
                  onPointerDown={(e) => {
                    const btn = e.currentTarget;
                    // Prefer horizontal visibility for the season bar; fall back to vertical if needed
                    scrollIntoViewIfNeeded(btn, { axis: 'x', margin: 24 });
                    const { didScroll } = scrollIntoViewIfNeeded(btn, { axis: 'y', margin: 24 });
                    if (didScroll) return;
                    explicitSeasonSelectionRef.current = { showId, seasonId: s.id };
                    getLogger().child({ component: 'FitnessShow' }).info('fitness.show.season_selected', {
                      showId,
                      fromSeasonId: activeSeasonId,
                      toSeasonId: s.id,
                      seasonNumber: s.number ?? null,
                      seasonTitle: s.rawName || s.name || null
                    });
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

      <UnlockPrompt
        open={!!pendingUnlock}
        state={unlockState}
        lockLabel={pendingUnlock?.label}
        unlockedUser={unlockedUser}
        onCancel={closeUnlock}
      />
    </div>
  );
};

export default FitnessShow;
