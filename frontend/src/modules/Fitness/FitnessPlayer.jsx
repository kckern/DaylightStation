import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import FitnessSidebar from './FitnessSidebar.jsx';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';
import usePlayerController from '../Player/usePlayerController.js';
import { DaylightMediaPath, DaylightAPI } from '../../lib/api.mjs';
import FitnessPlayerFooter from './FitnessPlayerFooter.jsx';
import FitnessPlayerOverlay, { useGovernanceOverlay } from './FitnessPlayerOverlay.jsx';
import { playbackLog } from '../Player/lib/playbackLogger.js';
import { useFitnessVolumeControls } from './useFitnessVolumeControls.js';
import { resolveMediaIdentity, normalizeDuration } from '../Player/utils/mediaIdentity.js';
import { resolvePause, PAUSE_REASON } from '../Player/utils/pauseArbiter.js';
import FitnessChart from './FitnessSidebar/FitnessChart.jsx';
import { useMediaAmplifier } from './components/useMediaAmplifier.js';

const DEBUG_FITNESS_INTERACTIONS = false;

// Helper function to generate Plex thumbnail URLs for specific timestamps
const generateThumbnailUrl = (plexObj, timeInSeconds) => {
  
  if (!plexObj) {
    // Generate a fallback SVG with timestamp
    return generateFallbackThumbnail(timeInSeconds);
  }
  
  try {
    // Convert seconds to milliseconds (Plex uses milliseconds for timestamps)
    const timeInMillis = Math.floor(timeInSeconds * 1000);
    
    // Check for available properties to use in URL generation
    let thumbId = plexObj.thumb_id || null;
    let image = plexObj.image || null;
    let mediaId = typeof plexObj === 'object' ? plexObj.id || plexObj.plex : plexObj;
    
    // Basic logging
    
    // Option 1: Use thumb_id directly with library/parts pattern (best quality)
    if (thumbId) {
      // Ensure thumb_id is treated as a number not a string for consistency
      const numericThumbId = parseInt(thumbId, 10);
      return DaylightMediaPath(`/plex_proxy/photo/:/transcode?width=240&height=135&minSize=1&upscale=1&url=/library/parts/${numericThumbId}/indexes/sd/${timeInMillis}`);
    }
    
    // Option 2: If we have mediaId, use library/metadata pattern 
    if (mediaId) {
      return DaylightMediaPath(`/plex_proxy/photo/:/transcode?width=240&height=135&minSize=1&upscale=1&url=/library/metadata/${mediaId}/thumb/${timeInMillis}`);
    }
    
    // Option 3: If we have an image URL that already has a timestamp, replace the timestamp
    if (image && image.includes('/thumb/')) {
      // Replace the existing timestamp with our new one
      return image.replace(/\/thumb\/\d+/, `/thumb/${timeInMillis}`);
    }
    
    // Option 4: Last resort fallback
    return generateFallbackThumbnail(timeInSeconds);
  } catch (error) {
    playbackLog('fitness-thumbnail-error', {
      message: error?.message || 'thumbnail-generation-error',
      timeInSeconds,
      plexId: typeof plexObj === 'object' ? (plexObj?.id || plexObj?.plex || null) : plexObj || null
    }, { level: 'error' });
    return generateFallbackThumbnail(timeInSeconds);
  }
};

// Generate a fallback thumbnail with timestamp when Plex thumbnail is unavailable
const generateFallbackThumbnail = (timeInSeconds) => {
  // Create formatted time display (MM:SS)
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  // Calculate percentage position in video (assuming 10-minute default if we don't know)
  const defaultDuration = 600; // 10 minutes
  const percentage = Math.min(Math.floor((timeInSeconds / defaultDuration) * 100), 100);
  
  // Generate an SVG with the timestamp and a visual indicator
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="135" viewBox="0 0 240 135">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1f1f1f;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#282828;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="240" height="135" fill="url(#grad)" />
      <rect x="20" y="95" width="200" height="8" rx="4" ry="4" fill="#444" />
      <rect x="20" y="95" width="${percentage * 2}" height="8" rx="4" ry="4" fill="#0084ff" />
      <text x="120" y="67.5" font-family="Arial" font-size="24" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${formattedTime}</text>
      <text x="120" y="110" font-family="Arial" font-size="12" fill="#aaaaaa" text-anchor="middle" dominant-baseline="middle">${percentage}%</text>
      <path d="M120 35 L135 60 L105 60 Z" fill="#ffffff" />
    </svg>
  `)}`;
};

// Helper function to format time in MM:SS or HH:MM:SS format
const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const DEFAULT_SIDEBAR = 250;

const FITNESS_MAX_VIDEO_BITRATE = null;

const FitnessPlayer = ({ playQueue, setPlayQueue, viewportRef }) => {
  const mainPlayerRef = useRef(null);
  const contentRef = useRef(null);
  const footerRef = useRef(null);
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0, hideFooter: false, footerHeight: 0 });
  // Sidebar is no longer resizable; width is driven by context size mode
  const [sidebarSide, setSidebarSide] = useState('right'); // 'left' | 'right'
  // Mode: fullscreen (no sidebar/ no footer) or normal (standard layout)
  const [playerMode, setPlayerMode] = useState('normal'); // 'fullscreen' | 'normal'
  const lastNonFullscreenRef = useRef('normal');
  // Resizing removed per spec
  // Declare hooks
  const [currentItem, setCurrentItem] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [resilienceState, setResilienceState] = useState(null);
  const [playerElementKey] = useState(0);
  // Layout adaptation state
  const [stackMode, setStackMode] = useState(false); // layout adaptation flag
  // Footer aspect (width/height) hysteresis thresholds
  // When the footer becomes "too tall" relative to width (low aspect ratio) we enter stack mode.
  // Using width/height so a wider, shorter footer has a HIGHER aspect value.
  const FOOTER_ASPECT_ENTER = 4.0; // enter stack when ratio drops below this
  const FOOTER_ASPECT_EXIT  = 4.5; // exit stack when ratio rises above this (hysteresis ~12%)
  const stackEvalRef = useRef({ lastFooterAspect: null, lastComputeTs: 0, pending: false });
  const measureRafRef = useRef(null);
  const computeRef = useRef(null); // expose compute so other effects can trigger it safely
  const pendingCloseRef = useRef(false); // Track pending close for voice memo guard (4A fix)
  const {
    fitnessPlayQueue,
    setFitnessPlayQueue,
    sidebarSizeMode,
    videoPlayerPaused,
    setVideoPlayerPaused,
    governance,
    setGovernanceMedia,
    governedLabels,
    governedTypes,
    governedLabelSet: contextGovernedLabelSet,
    governedTypeSet: contextGovernedTypeSet,
    governanceState,
    plexConfig,
    fitnessSessionInstance,
    voiceMemoOverlayState, // 4A: Voice memo overlay state for exit guard
    voiceMemos, // 4B: Voice memos for 15-minute rule
    openVoiceMemoCapture, // 4B: Open voice memo prompt
    addVoiceMemoToSession,
    pauseMusicPlayer,
    resumeMusicPlayer,
    preferredMicrophoneId,
    participantRoster: contextParticipantRoster
  } = useFitness() || {};
  const playerRef = useRef(null); // imperative Player API

  const [mediaElement, setMediaElement] = useState(null);

  // Track media element replacements so boost can rebind after player remounts
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    const updateElement = () => {
      const next = playerRef?.current?.getMediaElement?.() || null;
      setMediaElement((prev) => (prev === next ? prev : next));
    };
    updateElement();
    const intervalId = window.setInterval(() => {
      if (!cancelled) updateElement();
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [playerRef]);

  // Pause video when videoPlayerPaused is set (e.g., voice memo overlay opens)
  useEffect(() => {
    if (videoPlayerPaused && mediaElement) {
      mediaElement.pause();
    }
  }, [videoPlayerPaused, mediaElement]);

  const { boostLevel, setBoost } = useMediaAmplifier(mediaElement, {
    showId: currentItem?.showId,
    seasonId: currentItem?.seasonId,
    trackId: currentItem?.id
  });
  const seekIntentRef = useRef(null); // Track seek/resume intent to override actual time
  const thumbnailsCommitRef = useRef(null); // will hold commit function from FitnessPlayerFooterSeekThumbnails
  const thumbnailsGetTimeRef = useRef(null); // will hold function to get current display time from thumbnails
  const renderCountRef = useRef(0);
  const loggedVideoMediaRef = useRef(null);
  const queue = useMemo(() => playQueue || fitnessPlayQueue || [], [playQueue, fitnessPlayQueue]);
  const queueSize = Array.isArray(queue) ? queue.length : 0;
  const setQueue = setPlayQueue || setFitnessPlayQueue;
  const {
    seek: seekTo,
    toggle: togglePlay,
    getCurrentTime: getPlayerTime,
    getDuration: getPlayerDuration,
    pause: pausePlayback,
    play: playPlayback
  } = usePlayerController(playerRef);
  const lastKnownTimeRef = useRef(0);
  const statusUpdateRef = useRef({ lastSent: 0, inflight: false, endSent: false });
  const [playIsGoverned, setPlayIsGoverned] = useState(false);
  const [showChart, setShowChart] = useState(true);

  // Use participantRoster from context, with session roster as fallback for immediate data
  // This eliminates brief "Waiting for participants" flash when roster exists but context hasn't updated
  const sessionRoster = fitnessSessionInstance?.roster;
  const participants = Array.isArray(contextParticipantRoster) && contextParticipantRoster.length > 0
    ? contextParticipantRoster
    : (Array.isArray(sessionRoster) ? sessionRoster : []);

  const governanceOverlay = useGovernanceOverlay(governanceState, participants);
  renderCountRef.current += 1;

  const playerContentClassName = useMemo(() => {
    const classes = ['fitness-player-content'];
    if (governanceOverlay.filterClass) {
      classes.push(governanceOverlay.filterClass);
    }
    if (governanceOverlay.status) {
      classes.push(`governance-status-${governanceOverlay.status}`);
    }
    return classes.join(' ');
  }, [governanceOverlay.filterClass, governanceOverlay.status]);

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

  const pauseDecision = useMemo(() => resolvePause({
    governance: { blocked: playIsGoverned || governanceState?.videoLocked },
    resilience: {
      stalled: resilienceState?.stalled,
      waiting: resilienceState?.waitingToPlay
    },
    user: { paused: isPaused }
  }), [playIsGoverned, governanceState?.videoLocked, resilienceState?.stalled, resilienceState?.waitingToPlay, isPaused]);

  const governancePaused = pauseDecision.reason === PAUSE_REASON.GOVERNANCE && pauseDecision.paused;

  useEffect(() => {
    lastKnownTimeRef.current = 0;
    statusUpdateRef.current = { lastSent: 0, inflight: false, endSent: false };
  }, [currentItem ? currentItem.id : null]);

  useEffect(() => {
    if (!setGovernanceMedia) return;
    if (!currentItem) {
      setGovernanceMedia(null);
      return;
    }
    const mediaId = currentItem.media_key || currentItem.id || currentItem.plex || currentItem.videoUrl || currentItem.media_url || currentItem.guid;
    setGovernanceMedia({
      id: mediaId || `unknown-${currentItem.title || 'fitness'}`,
      labels: Array.isArray(currentItem.labels) ? currentItem.labels : [],
      type: currentItem.type || currentItem.media_type || null
    });
  }, [currentItem, setGovernanceMedia]);

  useEffect(() => {
    const hasLabelGovernance = governedLabelSet.size > 0;
    const hasTypeGovernance = governedTypeSet.size > 0;
    if (!currentItem || (!hasLabelGovernance && !hasTypeGovernance)) {
      setPlayIsGoverned(false);
      return;
    }
    const rawLabels = Array.isArray(currentItem.labels) ? currentItem.labels : [];
    const normalizedLabels = rawLabels
      .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
      .filter(Boolean);
    const labelGoverned = hasLabelGovernance && normalizedLabels.some((label) => governedLabelSet.has(label));
    const normalizedType = typeof currentItem.type === 'string' ? currentItem.type.trim().toLowerCase() : '';
    const typeGoverned = hasTypeGovernance && normalizedType && governedTypeSet.has(normalizedType);
    const mediaGoverned = labelGoverned || typeGoverned;
    if (!mediaGoverned) {
      setPlayIsGoverned(false);
      return;
    }
    // Only allow playback when governance is unlocked or warning
    // pending and locked phases should lock playback
    const governanceVideoLocked = Boolean(governanceState?.videoLocked);
    const locked = governanceVideoLocked || (governance !== 'unlocked' && governance !== 'warning');
    setPlayIsGoverned(locked);
  }, [currentItem, governedLabelSet, governedTypeSet, governance, governanceState?.videoLocked]);

  // Simplified governance: just mute during lock, unmute and play on unlock
  const wasGovernancePausedRef = useRef(false);
  const governanceUnlockTimerRef = useRef(null);
  useEffect(() => {
    const api = playerRef?.current;
    const media = api?.getMediaElement?.();

    if (governancePaused) {
      wasGovernancePausedRef.current = true;
      if (media) media.muted = true;
      // Clear any pending unlock timers
      if (governanceUnlockTimerRef.current) {
        clearTimeout(governanceUnlockTimerRef.current);
        governanceUnlockTimerRef.current = null;
      }
    } else if (wasGovernancePausedRef.current) {
      // Governance just unlocked - unmute and ensure playback
      wasGovernancePausedRef.current = false;

      // Wait a moment for resilience grace period to take effect, then try to play
      // The resilience system has a 5s grace period after governance unlock
      const tryPlay = (attempt = 0) => {
        const currentMedia = playerRef?.current?.getMediaElement?.();
        if (!currentMedia) {
          // Media element not ready yet, retry later
          if (attempt < 10) {
            governanceUnlockTimerRef.current = setTimeout(() => tryPlay(attempt + 1), 500);
          }
          return;
        }

        currentMedia.muted = false;

        // Only call play() if video is actually ready (readyState >= 3)
        // This prevents AbortError from conflicting play() calls
        if (currentMedia.readyState >= 3 && currentMedia.paused) {
          currentMedia.play?.().catch(() => {});
        } else if (currentMedia.readyState < 3 && attempt < 10) {
          // Not ready yet, wait for Shaka to load
          governanceUnlockTimerRef.current = setTimeout(() => tryPlay(attempt + 1), 500);
        }
      };

      // Start after a brief delay to let state settle
      governanceUnlockTimerRef.current = setTimeout(() => tryPlay(0), 100);
    }

    return () => {
      if (governanceUnlockTimerRef.current) {
        clearTimeout(governanceUnlockTimerRef.current);
        governanceUnlockTimerRef.current = null;
      }
    };
  }, [governancePaused]);

  const TimeDisplay = useMemo(() => React.memo(({ ct, dur }) => (
    <>{formatTime(ct)} / {formatTime(dur)}</>
  )), []);

  const enhancedCurrentItem = useMemo(() => {
    if (!currentItem) return null;
    const totalDuration = currentItem.duration || currentItem.length || (currentItem.metadata && currentItem.metadata.duration) || 0;
    const resumableLabels = plexConfig?.resumable_labels || [];
    const itemLabels = Array.isArray(currentItem.labels) ? currentItem.labels : [];
    const normalizedResumableLabels = resumableLabels.map((l) => (typeof l === 'string' ? l.toLowerCase() : ''));
    const normalizedItemLabels = itemLabels.map((l) => (typeof l === 'string' ? l.toLowerCase() : ''));
    const isResumable = normalizedItemLabels.some((label) => normalizedResumableLabels.includes(label));

    let resumeSeconds = 0;
    if (isResumable) {
      const candidateSeconds = [
        currentItem.seconds,
        currentItem.watchSeconds,
        currentItem.resumeSeconds,
        currentItem.progressSeconds
      ].map((value) => {
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          return Number.isNaN(parsed) ? null : parsed;
        }
        return value;
      });
      const resolvedSeconds = candidateSeconds.find((value) => Number.isFinite(value) && value > 0);
      if (Number.isFinite(resolvedSeconds)) {
        resumeSeconds = resolvedSeconds;
      } else {
        const normalizedProgress = typeof currentItem.watchProgress === 'string'
          ? parseFloat(currentItem.watchProgress)
          : currentItem.watchProgress;
        if (Number.isFinite(normalizedProgress) && totalDuration > 0) {
          const pct = Math.max(0, Math.min(100, normalizedProgress));
          resumeSeconds = (pct / 100) * totalDuration;
        }
      }
    }

    if (resumeSeconds && totalDuration) {
      resumeSeconds = Math.min(resumeSeconds, totalDuration);
    }

    const enhanced = {
      ...currentItem,
      guid: currentItem.guid
        || currentItem.media_key
        || currentItem.id
        || currentItem.plex
        || currentItem.media_url
        || `fitness-${currentItem.id || ''}`,
      plex: currentItem.id || currentItem.plex,
      media_url: currentItem.media_url || currentItem.videoUrl,
      title: currentItem.title || currentItem.label,
      media_type: 'video',
      type: currentItem.type || currentItem.media_type || 'video',
      media_key: currentItem.id || currentItem.media_key || `fitness-${currentItem.id || ''}`,
      thumb_id: currentItem.thumb_id,
      show: currentItem.show || 'Fitness',
      season: currentItem.season || 'Workout',
      percent: (() => {
        const normalized = typeof currentItem.watchProgress === 'string'
          ? parseFloat(currentItem.watchProgress)
          : currentItem.watchProgress;
        return Number.isFinite(normalized) ? normalized : 0;
      })(),
      watchProgress: (() => {
        const normalized = typeof currentItem.watchProgress === 'string'
          ? parseFloat(currentItem.watchProgress)
          : currentItem.watchProgress;
        return Number.isFinite(normalized) ? normalized : undefined;
      })(),
      watchSeconds: (() => {
        const normalized = typeof currentItem.watchSeconds === 'string'
          ? parseFloat(currentItem.watchSeconds)
          : currentItem.watchSeconds;
        return Number.isFinite(normalized) ? normalized : undefined;
      })(),
      seconds: resumeSeconds,
      continuous: false
    };

    return enhanced;
  }, [currentItem, plexConfig]);

  const showId = useMemo(
    () => enhancedCurrentItem?.showId || currentItem?.showId || currentItem?.seriesId || currentItem?.plex || 'fitness',
    [enhancedCurrentItem?.showId, currentItem?.showId, currentItem?.seriesId, currentItem?.plex]
  );

  const seasonId = useMemo(
    () => enhancedCurrentItem?.seasonId || currentItem?.seasonId || 'unknown',
    [enhancedCurrentItem?.seasonId, currentItem?.seasonId]
  );

  const currentMediaIdentity = useMemo(
    () => resolveMediaIdentity(enhancedCurrentItem || currentItem),
    [enhancedCurrentItem, currentItem]
  );

  const fitnessLogContext = useMemo(() => ({
    mediaId: resolveMediaIdentity(currentItem),
    title: currentItem?.title,
    show: enhancedCurrentItem?.show,
    season: enhancedCurrentItem?.season,
    playerMode,
    isGoverned: playIsGoverned
  }), [currentItem, enhancedCurrentItem, playerMode, playIsGoverned]);

  const { videoVolume } = useFitnessVolumeControls({
    videoPlayerRef: playerRef,
    videoShowId: showId,
    videoSeasonId: seasonId,
    videoTrackId: currentMediaIdentity
  });

  // Apply persisted volume when media element becomes available
  // This fixes the race condition where useLayoutEffect runs before playerRef is set
  useEffect(() => {
    if (mediaElement && videoVolume?.applyToPlayer) {
      videoVolume.applyToPlayer();
    }
  }, [mediaElement, videoVolume]);

  const logFitnessEvent = useCallback((event, details = {}, options = {}) => {
    if (!DEBUG_FITNESS_INTERACTIONS) return;
    const { level: detailLevel, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    playbackLog('fitness-player', {
      event,
      ...restDetails
    }, {
      ...resolvedOptions,
      level: resolvedOptions.level || detailLevel || 'debug',
      context: {
        ...fitnessLogContext,
        ...(resolvedOptions.context || {})
      }
    });
  }, [fitnessLogContext]);

  // Memoize keyboard overrides to prevent recreation on every render
  const keyboardOverrides = useMemo(() => ({
    'Escape': () => handleClose(),
    'ArrowLeft': (event) => {
      if (governancePaused) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Use display time from thumbnails if available (includes pendingTime), otherwise fall back to player time
      const actualCurrentTime = thumbnailsGetTimeRef.current ? thumbnailsGetTimeRef.current() : getPlayerTime();
      const actualDuration = getPlayerDuration();
      const increment = actualDuration ? Math.max(5, Math.floor(actualDuration / 50)) : 10;
      const newTime = Math.max(actualCurrentTime - increment, 0);
      logFitnessEvent('keyboard-seek', {
        direction: 'left',
        currentTime: actualCurrentTime,
        newTime,
        increment,
        hasCommitRef: !!thumbnailsCommitRef.current
      });
      if (thumbnailsCommitRef.current) {
        thumbnailsCommitRef.current(newTime);
      } else {
        seekTo(newTime);
      }
    },
    'ArrowRight': (event) => {
      if (governancePaused) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Use display time from thumbnails if available (includes pendingTime), otherwise fall back to player time
      const actualCurrentTime = thumbnailsGetTimeRef.current ? thumbnailsGetTimeRef.current() : getPlayerTime();
      const actualDuration = getPlayerDuration();
      const increment = actualDuration ? Math.max(5, Math.floor(actualDuration / 50)) : 10;
      const newTime = Math.min(actualCurrentTime + increment, actualDuration || 0);
      logFitnessEvent('keyboard-seek', {
        direction: 'right',
        currentTime: actualCurrentTime,
        newTime,
        increment,
        hasCommitRef: !!thumbnailsCommitRef.current
      });
      if (thumbnailsCommitRef.current) {
        thumbnailsCommitRef.current(newTime);
      } else {
        seekTo(newTime);
      }
    }
  }), [getPlayerTime, getPlayerDuration, seekTo, playIsGoverned, logFitnessEvent]);

  

  // Helper function to check if a plex object is valid for thumbnail generation
  const isValidPlexObj = (plexObj) => {
    if (!plexObj) return false;
    
    // First check if there's a thumb_id available
    if (typeof plexObj === 'object' && plexObj.thumb_id) return true;
    
    // Fallback to checking if it's a numeric ID or a path that contains metadata
    const plexId = typeof plexObj === 'object' ? plexObj.id || plexObj.plex || plexObj.ratingKey : plexObj;
    return (
      /^\d+$/.test(String(plexId)) || 
      (typeof plexId === 'string' && plexId.includes('metadata')) ||
      (typeof plexId === 'object' && (plexId.id || plexId.ratingKey || plexId.metadata))
    );
  };

  // Container-based sizing with 16:9 invariant: we derive video FIRST then leftover height becomes footer.
  useLayoutEffect(() => {
    if (!viewportRef?.current) return;

    const compute = (reason = 'resize') => {
      if (!viewportRef.current) return;
      if (stackEvalRef.current.pending) return;
      stackEvalRef.current.pending = true;
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = requestAnimationFrame(() => {
        stackEvalRef.current.pending = false;

        const viewportEl = viewportRef.current;
        if (!viewportEl) return;
        const { width: totalW, height: totalH } = viewportEl.getBoundingClientRect();

        // Effective sidebar width based on sidebar size mode
        let effectiveSidebar = 0;
        if (playerMode === 'fullscreen') {
          effectiveSidebar = 0;
        } else {
          effectiveSidebar = sidebarSizeMode === 'large' ? Math.round(totalW * 0.45) : DEFAULT_SIDEBAR;
        }

        const availableW = Math.max(0, totalW - effectiveSidebar);
        // Start with width-driven sizing
        let videoW = availableW;
        let videoH = videoW * 9 / 16;
        // If too tall for viewport, clamp by height and recalc width
        if (videoH > totalH) {
          videoH = totalH;
          videoW = videoH * 16 / 9;
        }
        videoW = Math.max(0, Math.round(videoW));
        videoH = Math.max(0, Math.round(videoH));

        // Remaining space allocated to footer unless fullscreen
        let footerHeight = playerMode === 'fullscreen' ? 0 : Math.max(0, totalH - videoH);
        const footerRatio = totalH > 0 ? (footerHeight / totalH) : 0;

        // Snap to fullscreen if footer would be under 5% of viewport (per spec)
        if (playerMode !== 'fullscreen' && footerRatio < 0.05) {
          setPlayerMode('fullscreen');
          return; // another effect run will size again
        }

        const hideFooter = (playerMode === 'fullscreen');
        setVideoDims(prev => (prev.width === videoW && prev.height === videoH && prev.hideFooter === hideFooter && prev.footerHeight === footerHeight)
          ? prev
          : { width: videoW, height: videoH, hideFooter, footerHeight });

        // STACK MODE: evaluate based on thumbnail squish heuristic using footer *width/height* aspect
        if (!hideFooter && footerRef.current) {
          const footerEl = footerRef.current;
          if (footerEl && typeof footerEl.getBoundingClientRect === 'function') {
            const fr = footerEl.getBoundingClientRect();
            if (fr.width > 0) {
              const aspect = fr.width / Math.max(1, footerHeight || fr.height || 1);
              stackEvalRef.current.lastFooterAspect = aspect;
              setStackMode(prev => {
                if (prev) {
                  if (aspect > FOOTER_ASPECT_EXIT) return false;
                  return prev;
                } else {
                  if (aspect < FOOTER_ASPECT_ENTER) return true;
                  return prev;
                }
              });
            }
          }
        }
      });
    };

    computeRef.current = compute;

    const ro = new ResizeObserver(() => compute('viewport'));
    ro.observe(viewportRef.current);
    if (mainPlayerRef.current) ro.observe(mainPlayerRef.current);
    // Sidebar size mode changes already cause re-run via dep array
    compute('initial');
    return () => {
      ro.disconnect();
    };
  }, [viewportRef, sidebarSizeMode, playerMode]);

  // Recompute when stackMode flips (its className may change per-thumb width) to allow exiting when space increases
  useEffect(() => {
    if (!computeRef.current) return;
    const id = requestAnimationFrame(() => computeRef.current('stackModeChange'));
    return () => cancelAnimationFrame(id);
  }, [stackMode]);

  // Resizer removed: no mouse/keyboard resize handlers
  
  // Handle image loading errors for thumbnails
  const handleThumbnailError = (e, label) => {
    // thumbnail failed to load (warning suppressed)
    e.target.style.display = 'none';
    if (e.target.nextSibling) {
      e.target.nextSibling.style.display = 'flex';
    }
  };
  
  // Function to handle seeking to a specific point in the video
  const handleSeek = useCallback((seconds) => {
    if (governancePaused) return;
    if (Number.isFinite(seconds)) {
      seekTo(seconds);
      setCurrentTime(seconds);
      seekIntentRef.current = { time: seconds, timestamp: performance.now() };
    }
  }, [seekTo, governancePaused]);

  const computeEpisodeStatusPayload = useCallback(({ naturalEnd = false } = {}) => {
    if (!currentItem) return null;
    const durationSeconds = Math.max(0, Math.floor(Number.isFinite(duration) ? duration : (currentItem.duration || 0) || 0));
    const positionSeconds = Math.max(0, Math.floor(lastKnownTimeRef.current || currentTime || 0));
    const percent = durationSeconds > 0 ? Math.min(100, (positionSeconds / durationSeconds) * 100) : null;

    // Check if currently stalled (3C fix)
    const isStalled = Boolean(resilienceState?.stalled || resilienceState?.waitingToPlay);

    let status = 'none';
    if (durationSeconds < 30 && naturalEnd && !isStalled) {
      status = 'completed';
    } else if ((naturalEnd || (percent != null && percent >= 90)) && !isStalled) {
      // Only mark completed if not stalled (3C fix)
      status = 'completed';
    } else if (percent != null && percent >= 90 && isStalled) {
      // Near end but stalled - don't mark as completed (3C fix)
      status = 'stalled_near_end';
    } else if (percent != null && percent >= 10) {
      status = 'in_progress';
    }
    if (status === 'none') return null;

    const mediaKey = currentItem.media_key || currentItem.plex || currentItem.id || currentItem.guid || null;
    if (!mediaKey) return null;

    return {
      episodeId: mediaKey,
      media_key: mediaKey,
      status,
      percent: percent != null ? Math.round(percent) : null,
      positionSeconds,
      durationSeconds,
      naturalEnd: Boolean(naturalEnd),
      isStalled, // Include stall state in payload (3C fix)
      title: currentItem.title || currentItem.label || 'Episode',
      type: (currentItem.plex || /^\d+$/.test(String(mediaKey))) ? 'plex' : (currentItem.type || 'media'),
      showId: currentItem.showId || null
    };
  }, [currentItem, currentTime, duration, resilienceState]);

  const postEpisodeStatus = useCallback(async ({ naturalEnd = false, reason = 'unknown' } = {}) => {
    const payload = computeEpisodeStatusPayload({ naturalEnd });
    if (!payload) return;
    // Skip API call for stalled_near_end to avoid false completion logs (3C fix)
    if (payload.status === 'stalled_near_end') {
      console.log('[FitnessPlayer] Skipping status post - stalled near end', payload);
      return;
    }
    const now = Date.now();
    if (statusUpdateRef.current.inflight) return;
    if (now - statusUpdateRef.current.lastSent < 500) return;
    statusUpdateRef.current.inflight = true;
    try {
      await DaylightAPI('media/log', {
        title: payload.title,
        type: payload.type,
        media_key: payload.media_key,
        seconds: payload.positionSeconds,
        percent: payload.percent ?? undefined,
        status: payload.status,
        naturalEnd: payload.naturalEnd,
        duration: payload.durationSeconds,
        reason
      }, 'POST');
      statusUpdateRef.current.lastSent = now;
      if (payload.showId && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fitness-show-refresh', { detail: { showId: payload.showId } }));
      }
    } catch (err) {
      console.error('Failed to post episode status', err);
    } finally {
      statusUpdateRef.current.inflight = false;
    }
  }, [computeEpisodeStatusPayload]);

  // Fix 2 (bugbash 4B): Removed stale useMemo - now computed fresh in handleClose
  // The 15-minute check needs current time, not cached time from useMemo

  // 4A: Execute actual close (separated for voice memo guard)
  const executeClose = useCallback(() => {
    statusUpdateRef.current.endSent = true;
    postEpisodeStatus({ naturalEnd: false, reason: 'close' });
    if (setQueue) {
      setQueue([]);
    }
    // Trigger show refresh on manual exit
    if (currentItem?.showId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fitness-show-refresh', { detail: { showId: currentItem.showId } }));
    }
    setCurrentItem(null);
    pendingCloseRef.current = false;
  }, [postEpisodeStatus, setQueue, currentItem?.showId]);

  const handleClose = () => {
    // 4A: Guard - if voice memo overlay is open, pause video but don't unmount
    if (voiceMemoOverlayState?.open) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[FitnessPlayer] Close blocked - voice memo overlay open, pausing instead');
      }
      pausePlayback();
      pendingCloseRef.current = true;
      return;
    }

    // Fix 2 (bugbash 4B): Compute fresh elapsed time on each close attempt (not stale useMemo)
    const sessionStartTime = fitnessSessionInstance?.startTime;
    const threshold = plexConfig?.voice_memo_prompt_threshold_seconds ?? 480; // 8 minutes default
    const hasMemos = Array.isArray(voiceMemos) && voiceMemos.length > 0;
    const shouldPrompt = sessionStartTime 
      && ((Date.now() - sessionStartTime) / 1000 > threshold) 
      && !hasMemos;

    // 4B: Check 15-minute rule - prompt for voice memo if session is long and no memos
    if (shouldPrompt && openVoiceMemoCapture) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[FitnessPlayer] 15-minute voice memo prompt triggered');
      }
      pausePlayback();
      pendingCloseRef.current = true;
      // Pass autoAccept: true so the review will auto-accept after recording
      // Pass fromFitnessVideoEnd: true to show "How did it go?" prompt
      // Pass onComplete callback so close happens via callback (not just effect transition)
      openVoiceMemoCapture(null, { autoAccept: true, fromFitnessVideoEnd: true, onComplete: executeClose });
      return;
    }

    executeClose();
  };

  // 4A: Track previous overlay state to detect true→false transition
  const prevOverlayOpenRef = useRef(voiceMemoOverlayState?.open);
  
  // 4A: Effect to execute pending close when voice memo overlay closes (true→false transition only)
  useEffect(() => {
    const wasOpen = prevOverlayOpenRef.current;
    const isOpen = voiceMemoOverlayState?.open;
    prevOverlayOpenRef.current = isOpen;
    
    // Only trigger on true → false transition with pending close
    if (wasOpen && !isOpen && pendingCloseRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[FitnessPlayer] Voice memo overlay closed (transition detected), executing pending close');
      }
      executeClose();
    }
  }, [voiceMemoOverlayState?.open, executeClose]);

  const handleNext = () => {
    const naturalEnd = currentTime >= Math.max(1, (duration || 0) * 0.98);
    statusUpdateRef.current.endSent = statusUpdateRef.current.endSent || naturalEnd;
    postEpisodeStatus({ naturalEnd, reason: 'advance' });
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex < queue.length - 1) {
      const nextItem = queue[currentIndex + 1];
      // Ensure the video URL is properly formatted
      if (nextItem && !nextItem.media_url && nextItem.videoUrl) {
        nextItem.media_url = nextItem.videoUrl;
      }
      setCurrentItem(nextItem);
    } else {
      // End of queue
      handleClose();
    }
  };

  const handlePrev = () => {
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex > 0) {
      const prevItem = queue[currentIndex - 1];
      // Ensure the video URL is properly formatted
      if (prevItem && !prevItem.media_url && prevItem.videoUrl) {
        prevItem.media_url = prevItem.videoUrl;
      }
      setCurrentItem(prevItem);
    } else {
      // Already at first item
    }
  };


  // Effect: Set initial time from resume point (intent)
  useEffect(() => {
    const resumeSeconds = enhancedCurrentItem?.seconds || 0;
    setCurrentTime(resumeSeconds);
    if (resumeSeconds > 0) {
      seekIntentRef.current = { time: resumeSeconds, timestamp: performance.now() };
    } else {
      seekIntentRef.current = null;
    }
  }, [enhancedCurrentItem?.guid, enhancedCurrentItem?.seconds]);

  const playObject = useMemo(() => {
    if (!enhancedCurrentItem) return null;
    
    // Check if this media is governed
    const rawLabels = Array.isArray(currentItem?.labels) ? currentItem.labels : [];
    const normalizedLabels = rawLabels
      .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
      .filter(Boolean);
    const labelGoverned = governedLabelSet.size > 0 && normalizedLabels.some((label) => governedLabelSet.has(label));
    const normalizedType = typeof currentItem?.type === 'string'
      ? currentItem.type.trim().toLowerCase()
      : (typeof enhancedCurrentItem?.type === 'string' ? enhancedCurrentItem.type.trim().toLowerCase() : '');
    const typeGoverned = governedTypeSet.size > 0 && normalizedType ? governedTypeSet.has(normalizedType) : false;
    const mediaGoverned = labelGoverned || typeGoverned;
    
    // Only autoplay if:
    // 1. Media is not governed, OR
    // 2. Media is governed AND governance is unlocked or warning
    const canAutoplay = !mediaGoverned || (governance === 'unlocked' || governance === 'warning');
    const stableGuid = String(
      enhancedCurrentItem.guid
        || enhancedCurrentItem.media_key
        || enhancedCurrentItem.plex
        || enhancedCurrentItem.id
        || enhancedCurrentItem.media_url
        || `fitness-${enhancedCurrentItem.id || enhancedCurrentItem.media_key || 'entry'}`
    );
    
    return {
      guid: stableGuid,
      plex: enhancedCurrentItem.plex,
      media_url: enhancedCurrentItem.media_url,
      media_type: 'video',
      media_key: enhancedCurrentItem.media_key,
      title: enhancedCurrentItem.title,
      seconds: enhancedCurrentItem.seconds,
      shader: 'minimal',
      // Use volumeRef for synchronous access to avoid race condition (3B fix)
      volume: videoVolume.volumeRef?.current ?? videoVolume.volume,
      playbackRate: currentItem?.playbackRate || 1.0,
      type: 'video',
      continuous: false,
      autoplay: canAutoplay
    };
  }, [enhancedCurrentItem, videoVolume.volume, videoVolume.volumeRef, currentItem?.playbackRate, currentItem?.labels, currentItem?.type, governedLabelSet, governedTypeSet, governance]);

  const autoplayEnabled = Boolean(playObject?.autoplay);

  useEffect(() => {
    videoVolume.applyToPlayer();
  }, [videoVolume, currentMediaIdentity]);

  useEffect(() => {
    const session = fitnessSessionInstance;
    if (!session || typeof session.logEvent !== 'function') {
      return;
    }
    if (!currentMediaIdentity) {
      loggedVideoMediaRef.current = null;
      return;
    }
    if (loggedVideoMediaRef.current === currentMediaIdentity) {
      return;
    }
    const media = enhancedCurrentItem || currentItem;
    if (!media) {
      return;
    }
    loggedVideoMediaRef.current = currentMediaIdentity;
    const durationSeconds = normalizeDuration(
      media.duration,
      media.length,
      media.metadata?.duration
    );
    session.logEvent('media_start', {
      source: 'video_player',
      mediaId: currentMediaIdentity,
      title: media.title || media.label || null,
      show: media.show || null,
      season: media.season || null,
      plexId: media.plex || media.id || null,
      mediaKey: media.media_key || null,
      durationSeconds,
      resumeSeconds: Number.isFinite(media.seconds) ? Math.round(media.seconds) : null,
      autoplay: autoplayEnabled,
      governed: Boolean(playIsGoverned),
      labels: Array.isArray(media.labels) ? media.labels : [],
      type: media.type || media.media_type || 'video',
      queueSize
    });
  }, [fitnessSessionInstance, currentMediaIdentity, enhancedCurrentItem, currentItem, autoplayEnabled, playIsGoverned, queueSize]);

  const resilienceMediaIdentity = useMemo(
    () => resolveMediaIdentity(resilienceState?.meta),
    [resilienceState]
  );

  const stallStatus = useMemo(() => {
    if (!resilienceState) return null;
    if (currentMediaIdentity && resilienceMediaIdentity && currentMediaIdentity !== resilienceMediaIdentity) {
      return null;
    }

    const isResilienceStalled = Boolean(resilienceState.stalled || resilienceState.waitingToPlay);
    if (!isResilienceStalled) return null;

    return {
      isStalled: true,
      state: resilienceState
    };
  }, [resilienceState, currentMediaIdentity, resilienceMediaIdentity]);

  const seekPositions = useMemo(() => {
    if (!currentItem) return [];
    const totalDuration = currentItem.duration || currentItem.length || (currentItem.metadata && currentItem.metadata.duration) || 600;
    const positions = [0];
    for (let i = 1; i <= 8; i++) positions.push(Math.floor((i / 9) * totalDuration));
    positions.push(Math.floor(totalDuration * 0.95));
    return positions;
  }, [currentItem]);

  const seekButtons = useMemo(() => {
    if (!currentItem) return null;
    let activeIndex = 0;
    for (let i = 0; i < seekPositions.length; i++) {
      if (seekPositions[i] <= currentTime) activeIndex = i; else break;
    }
    const plexObj = {
      plex: currentItem.plex,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id, 10)) : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };
    return seekPositions.map((pos, idx) => {
      const minutes = Math.floor(pos / 60);
      const seconds = pos % 60;
      const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const isOrigin = idx === 0;
      const isActive = idx === activeIndex;
      const isPast = idx < activeIndex;
      const classes = ["seek-button-container"]; if (isOrigin) classes.push('origin'); if (isPast) classes.push('past'); if (isActive) classes.push('active');
      const originSrc = isOrigin ? (currentItem.seasonImage || currentItem.image || generateThumbnailUrl(plexObj, pos)) : null;
      const imgSrc = isOrigin ? originSrc : generateThumbnailUrl(plexObj, pos);
      return (
        <div className={classes.join(' ')} key={`seek-${idx}`} data-pos={pos}>
          <div className="thumbnail-wrapper">
            <img
              src={imgSrc}
              alt={`Thumbnail at ${label}`}
              className="seek-thumbnail"
              loading="lazy"
              onError={(e) => handleThumbnailError(e, `Position ${label}`)}
            />
            <span className="thumbnail-time">{label}</span>
            <div className="thumbnail-fallback">{label}</div>
          </div>
        </div>
      );
    });
  }, [currentItem, currentTime, seekPositions, handleSeek]);

  // Effect: initialize current item from queue
  useEffect(() => {
    if (queue.length > 0 && !currentItem) {
      // Normalize first item (ensure media_url exists)
      const first = { ...queue[0] };
      if (!first.media_url && first.videoUrl) first.media_url = first.videoUrl;
      setCurrentItem(first);
    }
  }, [queue, currentItem]);

  const progressMetaRef = useRef({ lastSetTime: 0, lastDuration: 0 });

  const handleResilienceState = useCallback((nextState, media) => {
    if (!nextState) {
      setResilienceState(null);
      return;
    }
    if (nextState.meta || !media) {
      setResilienceState(nextState);
    } else {
      setResilienceState({ ...nextState, meta: media });
    }
  }, []);

  const handlePlayerProgress = useCallback(({ currentTime: ct, duration: d, paused }) => {
    // Throttle currentTime updates to ~4Hz
    const now = performance.now();

    // Check intent to prevent jumping back
    if (seekIntentRef.current) {
      const { time: intentTime, timestamp: intentTs } = seekIntentRef.current;
      if (Math.abs(ct - intentTime) < 2) { // 2 seconds threshold
        seekIntentRef.current = null; // Caught up
      } else if (now - intentTs < 5000) { // 5 seconds timeout
        // Still waiting for seek to complete, ignore actual time for display
        // But update duration/paused
        if (d && d !== progressMetaRef.current.lastDuration) {
          progressMetaRef.current.lastDuration = d;
          setDuration(d);
        }
        setIsPaused(paused);
        if (governancePaused && !paused && pausePlayback) {
          pausePlayback();
        }
        if (setVideoPlayerPaused) {
          setVideoPlayerPaused(paused || governancePaused);
        }
        return;
      } else {
        seekIntentRef.current = null; // Timeout
      }
    }

    const last = progressMetaRef.current.lastSetTime;
    if (now - last > 250) {
      progressMetaRef.current.lastSetTime = now;
      // console.log('[FitnessPlayer] currentTime updated:', ct);
      setCurrentTime(ct);
    }
    lastKnownTimeRef.current = ct;
    if (d && d !== progressMetaRef.current.lastDuration) {
      progressMetaRef.current.lastDuration = d;
      setDuration(d);
    }
    // isPaused reflects actual video state - governance is handled separately via pauseDecision
    setIsPaused(paused);

    // Immediately pause if governed and locked
    if (governancePaused && !paused && pausePlayback) {
      pausePlayback();
    }

    // Update context so music player can sync (includes governance state)
    if (setVideoPlayerPaused) {
      setVideoPlayerPaused(paused || governancePaused);
    }
  }, [setVideoPlayerPaused, governancePaused, pausePlayback]);

  useEffect(() => {
    if (!currentItem) return;
    const total = Number.isFinite(duration) ? duration : (currentItem.duration || 0);
    if (!total || total <= 0) return;
    if (statusUpdateRef.current.endSent) return;
    const pos = Math.max(lastKnownTimeRef.current || 0, currentTime || 0);
    if (pos >= Math.max(1, total * 0.98)) {
      statusUpdateRef.current.endSent = true;
      postEpisodeStatus({ naturalEnd: true, reason: 'auto-end' });
    }
  }, [currentItem, currentTime, duration, postEpisodeStatus]);

  const handleReloadEpisode = useCallback(() => {
    const api = playerRef.current;
    if (!api) {
      return;
    }

    const seekSeconds = Math.max(0, lastKnownTimeRef.current || 0);
    const seekToIntentMs = Number.isFinite(seekSeconds) ? Math.round(seekSeconds * 1000) : null;

    if (api.forceMediaReload) {
      api.forceMediaReload({
        reason: 'fitness-manual-recovery',
        source: 'fitness-sidebar',
        seekToIntentMs
      });
      return;
    }

    if (api.resetMediaResilience) {
      api.resetMediaResilience();
    }
  }, []);

  const handlePlayerControllerUpdate = useCallback(() => {}, []);

  const handlePlayerReady = useCallback(({ duration: d }) => {
    if (d && !duration) setDuration(d);
  }, [duration]);

  // Removed manual JS aspect ratio enforcement in favor of pure CSS layout.

  // Track last non-fullscreen mode whenever mode changes (must be before any conditional return to keep hook order stable)
  useEffect(() => {
    if (playerMode !== 'fullscreen') {
      lastNonFullscreenRef.current = playerMode;
    }
  }, [playerMode]);

  // Check if there are previous/next items in the queue
  const currentIndex = currentItem ? queue.findIndex(item => item.id === currentItem?.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < queue.length - 1;

  // Prepare additional metadata that might be useful for the Player
  // const enhancedCurrentItem = { ... old implementation removed };
  
  // Sidebar width for render (mirrors compute logic; may lag first frame until measure)
  const viewportW = viewportRef?.current?.clientWidth || 0;
  let sidebarRenderWidth;
  if (playerMode === 'fullscreen') sidebarRenderWidth = 0; else sidebarRenderWidth = (sidebarSizeMode === 'large' ? Math.round(viewportW * 0.45) : DEFAULT_SIDEBAR);

  const toggleFullscreen = useCallback(() => {
    setPlayerMode(m => m === 'fullscreen' ? (lastNonFullscreenRef.current || 'normal') : 'fullscreen');
  }, []);

  const shouldBlockFullscreenToggle = useCallback((eventTarget) => {
    if (typeof Element === 'undefined') {
      return false;
    }
    if (!eventTarget || !(eventTarget instanceof Element)) {
      return false;
    }
    const interactive = eventTarget.closest('button, a, input, textarea, [role="button"]');
    if (interactive) {
      return true;
    }
    const guardMatch = eventTarget.closest('[data-no-fullscreen]');
    if (!guardMatch) {
      return false;
    }
    const loadingOverlay = guardMatch.closest('.loading-overlay.loading');
    return !loadingOverlay;
  }, []);

  const handleVideoContainerPointerDown = useCallback((event) => {
    if (typeof event.button === 'number' && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (shouldBlockFullscreenToggle(target)) {
      return;
    }
    logFitnessEvent('fullscreen-pointerdown', {
      button: event.button,
      pointerType: event.pointerType,
      targetTag: event.target?.tagName || null,
      composedPath: typeof event.composedPath === 'function'
        ? event.composedPath().map((node) => node?.tagName || node?.className || node?.id).slice(0, 6)
        : null
    });
    logFitnessEvent('fullscreen-toggle-request', {
      source: 'video-container',
      pointerType: event.pointerType,
      button: event.button
    });
    toggleFullscreen();
  }, [toggleFullscreen, logFitnessEvent, shouldBlockFullscreenToggle]);

  const handleVideoContainerClickCapture = useCallback((event) => {
    logFitnessEvent('fullscreen-click-capture', {
      button: event.button,
      targetTag: event.target?.tagName || null
    });
  }, [logFitnessEvent]);

  const handleRootPointerDownCapture = useCallback((event) => {
    if (typeof event.button === 'number' && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const contentEl = contentRef.current;
    if (!contentEl || !contentEl.contains(target)) return;
    if (shouldBlockFullscreenToggle(target)) {
      return;
    }

    logFitnessEvent('root-pointerdown', {
      targetTag: event.target?.tagName || null,
      button: event.button,
      pointerType: event.pointerType
    });

    logFitnessEvent('fullscreen-toggle-request', {
      source: 'root-capture',
      pointerType: event.pointerType,
      button: event.button
    });
    toggleFullscreen();
  }, [toggleFullscreen, logFitnessEvent, shouldBlockFullscreenToggle]);

  const allowLoadingOverlayFullscreen = Boolean(resilienceState?.waitingToPlay || resilienceState?.stalled);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    if (!allowLoadingOverlayFullscreen) {
      return undefined;
    }
    const handleGlobalPointerDown = (event) => {
      if (!contentRef.current) {
        return;
      }
      if (typeof event.button === 'number' && event.button !== 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      const loadingOverlay = target.closest('.loading-overlay.loading');
      if (!loadingOverlay) {
        return;
      }
      if (shouldBlockFullscreenToggle(target)) {
        return;
      }
      const rect = contentRef.current.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const { clientX, clientY } = event;
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return;
      }
      const withinBounds = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!withinBounds) {
        return;
      }
      logFitnessEvent('fullscreen-toggle-request', {
        source: 'loading-overlay',
        pointerType: event.pointerType,
        button: event.button
      });
      toggleFullscreen();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [allowLoadingOverlayFullscreen, toggleFullscreen, shouldBlockFullscreenToggle, logFitnessEvent]);

  const reloadTargetSeconds = Math.max(0, lastKnownTimeRef.current || currentTime || 0);
  const playerRootClasses = useMemo(() => {
    return [`fitness-player`, `mode-${playerMode}`].join(' ');
  }, [playerMode]);

  const hasActiveItem = Boolean(currentItem && enhancedCurrentItem && playObject);
  const playerKey = hasActiveItem
    ? `${enhancedCurrentItem.media_key || enhancedCurrentItem.plex || enhancedCurrentItem.id}:${currentItem?.seconds ?? 0}`
    : 'fitness-player-empty';

  const videoShell = (
    <div className="fitness-video-shell">
      <div className="player-controls-blocker"></div>
      <FitnessPlayerOverlay 
        overlay={governanceOverlay} 
        playerRef={playerRef}
        showFullscreenVitals={playerMode === 'fullscreen'}
      />
      {hasActiveItem ? (
        <Player
          key={playerKey}
          play={playObject}
          maxVideoBitrate={FITNESS_MAX_VIDEO_BITRATE}
          onResilienceState={handleResilienceState}
          keyboardOverrides={keyboardOverrides}
          clear={handleClose}
          advance={handleNext}
          playerType="fitness-video"
          onProgress={handlePlayerProgress}
          onController={handlePlayerControllerUpdate}
          onMediaRef={() => {/* media element captured internally by Player; use playerRef API */}}
          pauseDecision={pauseDecision}
          ref={playerRef}
        />
      ) : null}
      {showChart && (
        <div className="fitness-chart-overlay">
          <FitnessChart />
        </div>
      )}
      {playerMode === 'fullscreen' && fitnessSessionInstance?.isActive && (
        <button
          type="button"
          className="fitness-player__voice-memo-fab"
          onClick={() => openVoiceMemoCapture?.(null)}
          aria-label="Record voice memo"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <div className={playerRootClasses} onPointerDownCapture={handleRootPointerDownCapture}>
      {/* Sidebar Component */}
      <div
        className={`fitness-player-sidebar ${sidebarSide === 'left' ? 'sidebar-left' : 'sidebar-right'}${playerMode === 'fullscreen' ? ' minimized' : ''}`}
        style={{ width: playerMode === 'fullscreen' ? 0 : sidebarRenderWidth, flex: `0 0 ${playerMode === 'fullscreen' ? 0 : sidebarRenderWidth}px`, order: sidebarSide === 'right' ? 2 : 0 }}
      >
        {hasActiveItem && (
          <div
            className={`sidebar-content${playerMode === 'fullscreen' ? ' sidebar-content-hidden' : ''}`}
            aria-hidden={playerMode === 'fullscreen'}
            style={{
              pointerEvents: playerMode === 'fullscreen' ? 'none' : 'auto',
              opacity: playerMode === 'fullscreen' ? 0 : 1,
              visibility: playerMode === 'fullscreen' ? 'hidden' : 'visible'
            }}
          >
            {/* Keep sidebar mounted in fullscreen so auxiliary players (music) continue running */}
            <FitnessSidebar
              playerRef={playerRef}
              videoVolume={videoVolume}
              onReloadVideo={handleReloadEpisode}
              reloadTargetSeconds={reloadTargetSeconds}
              onToggleChart={() => setShowChart(prev => !prev)}
              showChart={showChart}
              boostLevel={boostLevel}
              setBoost={setBoost}
            />
          </div>
        )}
        {/* Footer controls removed (maximal/resizer deprecated) */}
      </div>
      {/* Main Player Panel */}
      <div className="fitness-player-main" ref={mainPlayerRef} style={{ order: sidebarSide === 'right' ? 1 : 2 }}>
        {/* MainContent - 16:9 aspect ratio container */}
        <div
          className={playerContentClassName}
          ref={contentRef}
          onPointerDownCapture={handleVideoContainerPointerDown}
          onMouseDownCapture={handleVideoContainerPointerDown}
          onClickCapture={handleVideoContainerClickCapture}
          style={{
            width: videoDims.width ? videoDims.width + 'px' : '100%',
            height: videoDims.height ? videoDims.height + 'px' : 'auto',
            margin: videoDims.width && videoDims.width < (mainPlayerRef.current?.clientWidth || 0) ? '0 auto' : '0',
            position: 'relative'
          }}
        >
          <div className="fitness-player-video-host">
            {hasActiveItem ? videoShell : null}
          </div>
        </div>
        
        <FitnessPlayerFooter
          ref={footerRef}
          hidden={videoDims.hideFooter}
          height={videoDims.footerHeight}
          stackMode={stackMode}
          currentTime={currentTime}
          duration={duration}
          currentItem={currentItem}
          seekButtons={seekButtons}
          onSeek={handleSeek}
          onPrev={handlePrev}
          onNext={handleNext}
          onClose={handleClose}
          hasPrev={hasPrev}
          hasNext={hasNext}
          isPaused={isPaused}
          stallInfo={stallStatus}
          playerRef={playerRef}
          TimeDisplay={TimeDisplay}
          renderCount={renderCountRef.current}
          generateThumbnailUrl={generateThumbnailUrl}
          thumbnailsCommitRef={thumbnailsCommitRef}
          thumbnailsGetTimeRef={thumbnailsGetTimeRef}
          playIsGoverned={playIsGoverned}
          mediaElementKey={playerElementKey}
        />
      </div>
    </div>
  );
};

export default FitnessPlayer;