import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import FitnessPlayerSidebar from './FitnessPlayerSidebar.jsx';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';
import usePlayerController from '../Player/usePlayerController.js';
import { DaylightMediaPath } from '../../lib/api.mjs';
import FitnessUsers from './FitnessUsers.jsx';
import FitnessPlayerFooter from './FitnessPlayerFooter.jsx';

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
    console.error('Error generating thumbnail URL:', error);
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

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 250;

const FitnessPlayer = ({ playQueue, setPlayQueue, viewportRef }) => {
  const mainPlayerRef = useRef(null);
  const contentRef = useRef(null);
  const footerRef = useRef(null);
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0, hideFooter: false, footerHeight: 0 });
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const [sidebarSide, setSidebarSide] = useState('right'); // 'left' | 'right'
  // Mode: fullscreen (no sidebar/ no footer), normal (standard layout), maximal (sidebar 50%, stacked footer)
  const [playerMode, setPlayerMode] = useState('normal'); // 'fullscreen' | 'normal' | 'maximal'
  const lastNonFullscreenRef = useRef('normal');
  const resizingRef = useRef(false);
  // Declare hooks
  const [currentItem, setCurrentItem] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
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
  const { fitnessPlayQueue, setFitnessPlayQueue } = useFitness() || {};
  const playerRef = useRef(null); // imperative Player API
  const { seek: seekTo, toggle: togglePlay, getCurrentTime: getPlayerTime, getDuration: getPlayerDuration } = usePlayerController(playerRef);
  const renderCountRef = useRef(0);
  // Simple render counter (environment gating removed per instruction)
  renderCountRef.current += 1;

  const TimeDisplay = useMemo(() => React.memo(({ ct, dur }) => (
    <>{formatTime(ct)} / {formatTime(dur)}</>
  )), []);
  
  // Use props if provided, otherwise fall back to context
  const queue = playQueue || fitnessPlayQueue || [];
  const setQueue = setPlayQueue || setFitnessPlayQueue;
  
  

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
      const now = performance.now();
      if (stackEvalRef.current.pending) return;
      stackEvalRef.current.pending = true;
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = requestAnimationFrame(() => {
    stackEvalRef.current.pending = false;

        const { width: totalW, height: totalH } = viewportRef.current.getBoundingClientRect();

        // Effective sidebar width per mode
        let effectiveSidebar = 0;
        if (playerMode === 'fullscreen') {
          effectiveSidebar = 0;
        } else if (playerMode === 'maximal') {
          effectiveSidebar = Math.round(totalW * 0.5);
        } else {
          effectiveSidebar = sidebarWidth;
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
          const fr = footerRef.current.getBoundingClientRect();
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
      });
    };

    computeRef.current = compute;

    const ro = new ResizeObserver(() => compute('viewport'));
    ro.observe(viewportRef.current);
    if (mainPlayerRef.current) ro.observe(mainPlayerRef.current);
    // Sidebar width changes already cause re-run via dep array
    compute('initial');
    return () => {
      ro.disconnect();
    };
  }, [viewportRef, sidebarWidth, playerMode]);

  // Recompute when stackMode flips (its className may change per-thumb width) to allow exiting when space increases
  useEffect(() => {
    if (!computeRef.current) return;
    const id = requestAnimationFrame(() => computeRef.current('stackModeChange'));
    return () => cancelAnimationFrame(id);
  }, [stackMode]);

  // Mouse drag handlers for sidebar resize
  useEffect(() => {
    let rafId = null;
    let pendingWidth = null;
    const commit = () => {
      if (pendingWidth != null) {
        setSidebarWidth(pendingWidth);
        pendingWidth = null;
      }
      rafId = null;
    };
    const handleMove = (e) => {
      if (!resizingRef.current || !viewportRef?.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      let newWidth;
      if (sidebarSide === 'right') {
        const distanceFromRight = rect.right - e.clientX;
        newWidth = distanceFromRight;
      } else {
        const distanceFromLeft = e.clientX - rect.left;
        newWidth = distanceFromLeft;
      }
      newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, newWidth));
      pendingWidth = newWidth;
      if (!rafId) rafId = requestAnimationFrame(commit);
    };
    const stop = () => { resizingRef.current = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; commit(); } };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', stop);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [viewportRef, sidebarSide]);

  const handleResizeMouseDown = (e) => {
    e.preventDefault();
    resizingRef.current = true;
  };

  const handleResizeKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSidebarWidth(DEFAULT_SIDEBAR);
      return;
    }
    const step = (e.shiftKey ? 40 : 10);
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSidebarWidth(w => Math.max(MIN_SIDEBAR, w - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSidebarWidth(w => Math.min(MAX_SIDEBAR, w + step));
    }
  };
  
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
    if (Number.isFinite(seconds)) seekTo(seconds);
  }, [seekTo]);

  const handleClose = () => {
    if (setQueue) {
      setQueue([]);
    }
    setCurrentItem(null);
  };

  const handleNext = () => {
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

  const enhancedCurrentItem = useMemo(() => currentItem ? ({
    ...currentItem,
    plex: currentItem.id || currentItem.plex,
    media_url: currentItem.media_url || currentItem.videoUrl,
    title: currentItem.title || currentItem.label,
    media_type: 'video',
    type: 'video',
    media_key: currentItem.id || currentItem.media_key || `fitness-${currentItem.id || ''}`,
    thumb_id: currentItem.thumb_id,
    show: currentItem.show || 'Fitness',
    season: currentItem.season || 'Workout',
    percent: 0,
    seconds: 0,
    continuous: false
  }) : null, [currentItem]);

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

  // Effect: initialize current item from queue & setup keyboard shortcuts
  useEffect(() => {
    if (queue.length > 0 && !currentItem) {
      // Normalize first item (ensure media_url exists)
      const first = { ...queue[0] };
      if (!first.media_url && first.videoUrl) first.media_url = first.videoUrl;
      setCurrentItem(first);
    }

    const handleKeyDown = (event) => {
      if (!currentItem) return; // nothing playing
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (event.key) {
        case 'ArrowRight': {
          if (event.shiftKey) {
            // Jump forward to next seek button time (approx 1/9 increments)
            const total = duration || currentItem.duration || 600;
            const interval = total / 9;
            const nextTarget = Math.ceil(currentTime / interval) * interval;
            handleSeek(Math.min(nextTarget, total - 1));
          } else {
            handleSeek(Math.min(currentTime + 30, (duration || currentItem.duration || 600) - 1));
          }
          break; }
        case 'ArrowLeft': {
          if (event.shiftKey) {
            const total = duration || currentItem.duration || 600;
            const interval = total / 9;
            const prevTarget = Math.floor((currentTime - 1) / interval) * interval;
            handleSeek(Math.max(prevTarget, 0));
          } else {
            handleSeek(Math.max(currentTime - 30, 0));
          }
          break; }
        case 'Escape':
          handleClose();
          break;
        case ' ': { // Spacebar toggles play/pause unless focus is on a button
          if (document.activeElement?.tagName !== 'BUTTON') {
            togglePlay();
            // Pause state will sync via onProgress; optimistic update for snappier UI
            setIsPaused(prev => !prev);
          }
          break; }
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [queue, currentItem, currentTime, duration]);

  const progressMetaRef = useRef({ lastSetTime: 0, lastDuration: 0 });

  const handlePlayerProgress = useCallback(({ currentTime: ct, duration: d, paused }) => {
    // Throttle currentTime updates to ~4Hz
    const now = performance.now();
    const last = progressMetaRef.current.lastSetTime;
    if (now - last > 250) {
      progressMetaRef.current.lastSetTime = now;
      setCurrentTime(ct);
    }
    if (d && d !== progressMetaRef.current.lastDuration) {
      progressMetaRef.current.lastDuration = d;
      setDuration(d);
    }
    setIsPaused(paused);
  }, []);

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

  // If we have no current item yet, render nothing (after stabilizing hook order)
  if (!currentItem) {
    return null;
  }

  // Check if there are previous/next items in the queue
  const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < queue.length - 1;

  // Prepare additional metadata that might be useful for the Player
  // const enhancedCurrentItem = { ... old implementation removed };
  
  // Sidebar width for render (mirrors compute logic; may lag first frame until measure)
  const viewportW = viewportRef?.current?.clientWidth || 0;
  let sidebarRenderWidth;
  if (playerMode === 'fullscreen') sidebarRenderWidth = 0; else if (playerMode === 'maximal') sidebarRenderWidth = Math.round(viewportW * 0.5) || Math.round((sidebarWidth || 250) * 1.6); else sidebarRenderWidth = sidebarWidth;

  const toggleFullscreen = () => {
    setPlayerMode(m => m === 'fullscreen' ? (lastNonFullscreenRef.current || 'normal') : 'fullscreen');
  };

  return (
    <div className={`fitness-player mode-${playerMode}`}>
      {/* Sidebar Component */}
      <FitnessPlayerSidebar
        currentItem={currentItem}
        queue={queue}
        duration={duration}
        formatTime={formatTime}
        sidebarWidth={sidebarRenderWidth}
        side={sidebarSide}
        mode={playerMode}
        onResizeMouseDown={handleResizeMouseDown}
        onResizeKeyDown={handleResizeKeyDown}
        onResetWidth={() => setSidebarWidth(DEFAULT_SIDEBAR)}
        toggleSide={() => setSidebarSide(s => s === 'right' ? 'left' : 'right')}
        setMode={setPlayerMode}
      />
      {/* Main Player Panel */}
      <div className="fitness-player-main" ref={mainPlayerRef} style={{ order: sidebarSide === 'right' ? 1 : 2 }}>
        {/* MainContent - 16:9 aspect ratio container */}
        <div
          className="fitness-player-content"
          ref={contentRef}
          onPointerDown={toggleFullscreen}
          style={{
            width: videoDims.width ? videoDims.width + 'px' : '100%',
            height: videoDims.height ? videoDims.height + 'px' : 'auto',
            margin: videoDims.width && videoDims.width < (mainPlayerRef.current?.clientWidth || 0) ? '0 auto' : '0'
          }}
        >
          {/* Add an overlay just to block the top-right close button */}
          <div className="player-controls-blocker"></div>
          <Player 
            key={enhancedCurrentItem.media_key || enhancedCurrentItem.plex || enhancedCurrentItem.id}
            play={{
              plex: enhancedCurrentItem.plex,
              media_url: enhancedCurrentItem.media_url,
              media_type: 'video',
              media_key: enhancedCurrentItem.media_key,
              title: enhancedCurrentItem.title,
              shader: 'minimal',
              volume: currentItem.volume || 1.0,
              playbackRate: currentItem.playbackRate || 1.0,
              type: 'video',
              continuous: false,
              forceH264: true
            }}
            clear={handleClose}
            advance={handleNext}
            playerType="fitness-video"
            onProgress={handlePlayerProgress}
            onMediaRef={() => {/* media element captured internally by Player; use playerRef API */}}
            ref={playerRef}
          />
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
          playerRef={playerRef}
          TimeDisplay={TimeDisplay}
          renderCount={renderCountRef.current}
          generateThumbnailUrl={generateThumbnailUrl}
        />
      </div>
    </div>
  );
};

export default FitnessPlayer;