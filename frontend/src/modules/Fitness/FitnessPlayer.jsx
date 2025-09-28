import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import FitnessPlayerSidebar from './FitnessPlayerSidebar.jsx';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import FitnessUsers from './FitnessUsers.jsx';

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
  const videoShellRef = useRef(null);
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0, hideFooter: false });
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
  
  // Use props if provided, otherwise fall back to context
  const queue = playQueue || fitnessPlayQueue || [];
  const setQueue = setPlayQueue || setFitnessPlayQueue;
  
  console.log('🎬 FitnessPlayer: Queue state:', { 
    propsQueue: playQueue, 
    contextQueue: fitnessPlayQueue, 
    resolvedQueue: queue, 
    currentItem 
  });

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

  // Container-based sizing: baseline is .fitness-app-viewport
  useLayoutEffect(() => {
    if (!viewportRef?.current) return;

    const compute = (reason = 'resize') => {
      if (!viewportRef.current) return;
      // Throttle layout compute to animation frames & avoid back-to-back redundant runs
      const now = performance.now();
      if (stackEvalRef.current.pending) return; // a compute already queued
      stackEvalRef.current.pending = true;
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = requestAnimationFrame(() => {
        stackEvalRef.current.pending = false;
        stackEvalRef.current.lastComputeTs = now;

        const { width: totalW, height: totalH } = viewportRef.current.getBoundingClientRect();
        // Determine effective sidebar width based on mode
        let effectiveSidebar;
        if (playerMode === 'fullscreen') {
          effectiveSidebar = 0;
        } else if (playerMode === 'maximal') {
          effectiveSidebar = Math.round(totalW * 0.5);
        } else { // normal
          effectiveSidebar = sidebarWidth;
        }
        const footerEl = footerRef.current;
        let footerNatural = 0;
        if (footerEl) {
          // Temporarily allow auto height to get intrinsic
          const prevDisplay = footerEl.style.display;
            if (videoDims.hideFooter) footerEl.style.display = 'none'; else footerEl.style.display = '';
          footerNatural = footerEl.scrollHeight;
          footerEl.style.display = prevDisplay; // restore
        }
        const availableW = Math.max(0, totalW - effectiveSidebar);
        let videoW = availableW;
        let videoH = Math.round(videoW * 9 / 16);
        const maxVideoH = Math.max(0, totalH - footerNatural);
        if (videoH > maxVideoH) {
          videoH = maxVideoH;
          videoW = Math.round(videoH * 16 / 9);
        }
        videoW = Math.max(0, videoW);
        videoH = Math.max(0, videoH);
        let hideFooter = (playerMode === 'fullscreen');
        if (!hideFooter && effectiveSidebar === 0 && (videoH + footerNatural > totalH)) {
          const maxVideoHNoFooter = totalH;
          if (videoH > maxVideoHNoFooter) {
            videoH = maxVideoHNoFooter;
            videoW = Math.round(videoH * 16 / 9);
          }
          hideFooter = true;
        }
        setVideoDims(prev => (prev.width === videoW && prev.height === videoH && prev.hideFooter === hideFooter)
          ? prev
          : { width: videoW, height: videoH, hideFooter });

        // Evaluate stack mode from footer aspect ratio (width/height)
        if (playerMode === 'maximal') {
          // Force stack mode in maximal
          setStackMode(true);
        } else if (footerRef.current) {
          const fr = footerRef.current.getBoundingClientRect();
          if (fr.height > 0) {
            const footerAspect = fr.width / fr.height;
            stackEvalRef.current.lastFooterAspect = footerAspect;
            setStackMode(prev => {
              if (prev) {
                // Currently stacked, look to exit only if aspect grows sufficiently
                if (footerAspect > FOOTER_ASPECT_EXIT) return false;
                return prev;
              } else {
                // Currently normal; enter if aspect shrinks below ENTER threshold
                if (footerAspect < FOOTER_ASPECT_ENTER) return true;
                return prev;
              }
            });
          }
        }
      });
    };

    computeRef.current = compute; // expose

    const ro = new ResizeObserver(() => compute('resizeObserverViewport'));
    ro.observe(viewportRef.current);
    if (mainPlayerRef.current) ro.observe(mainPlayerRef.current);
    // Guarded footer observer: only react when width meaningfully changes
    let lastFooterWidth = 0;
    if (footerRef.current) {
      const footerRO = new ResizeObserver(entries => {
        const entry = entries[0];
        if (!entry) return;
        const w = entry.contentRect.width;
        if (Math.abs(w - lastFooterWidth) > 4) { // ignore tiny jitter
          lastFooterWidth = w;
          compute('resizeObserverFooter');
        }
      });
      footerRO.observe(footerRef.current);
      // Store disconnect function
      stackEvalRef.current.footerRO = footerRO;
    }
    compute('initial');
    return () => {
      ro.disconnect();
      if (stackEvalRef.current.footerRO) {
        stackEvalRef.current.footerRO.disconnect();
        delete stackEvalRef.current.footerRO;
      }
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
      setSidebarWidth(newWidth);
    };
    const stop = () => { resizingRef.current = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', stop);
    };
  }, [viewportRef]);

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
    console.warn(`Thumbnail failed to load for ${label}`, e.target.src);
    e.target.style.display = 'none';
    if (e.target.nextSibling) {
      e.target.nextSibling.style.display = 'flex';
    }
  };
  
  // Function to handle seeking to a specific point in the video
  const handleSeek = (seconds) => {
    console.log(`🎬 FitnessPlayer: Seeking to ${seconds} seconds`);
    // Access the media element directly
    const mediaElement = document.querySelector('.fitness-player-content video') || 
                          document.querySelector('.fitness-player-content dash-video') ||
                          document.querySelector('.fitness-player-content .video-element');
    
    if (mediaElement) {
      // Set the currentTime property to seek to the specified position
      mediaElement.currentTime = seconds;
      console.log(`🎬 FitnessPlayer: Seek executed to ${seconds} seconds`);
    } else {
      console.error('🎬 FitnessPlayer: Could not find video element to seek');
    }
  };

  const handleClose = () => {
    console.log('🎬 FitnessPlayer: Closing player');
    if (setQueue) {
      setQueue([]);
    }
    setCurrentItem(null);
  };

  const handleNext = () => {
    console.log('🎬 FitnessPlayer: Next item requested');
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex < queue.length - 1) {
      const nextItem = queue[currentIndex + 1];
      // Ensure the video URL is properly formatted
      if (nextItem && !nextItem.media_url && nextItem.videoUrl) {
        nextItem.media_url = nextItem.videoUrl;
      }
      console.log('🎬 FitnessPlayer: Moving to next item:', nextItem);
      setCurrentItem(nextItem);
    } else {
      // End of queue
      console.log('🎬 FitnessPlayer: End of queue reached');
      handleClose();
    }
  };

  const handlePrev = () => {
    console.log('🎬 FitnessPlayer: Previous item requested');
    const currentIndex = queue.findIndex(item => item.id === currentItem?.id);
    if (currentIndex > 0) {
      const prevItem = queue[currentIndex - 1];
      // Ensure the video URL is properly formatted
      if (prevItem && !prevItem.media_url && prevItem.videoUrl) {
        prevItem.media_url = prevItem.videoUrl;
      }
      console.log('🎬 FitnessPlayer: Moving to previous item:', prevItem);
      setCurrentItem(prevItem);
    } else {
      // Already at first item
      console.log('🎬 FitnessPlayer: Already at first item');
    }
  };

  // Create 10 seek buttons at different intervals with thumbnails
  const generateSeekButtons = () => {
    if (!currentItem) return null;
    // Use a default if no duration is available
    const totalDuration = currentItem.duration || currentItem.length || (currentItem.metadata && currentItem.metadata.duration) || 600;
    // Build positions identical to previous logic: start, 8 midpoints, near-end
    const positions = [0];
    for (let i = 1; i <= 8; i++) positions.push(Math.floor((i / 9) * totalDuration));
    const endPosition = Math.floor(totalDuration * 0.95);
    positions.push(endPosition);

    // Determine active index: largest position <= currentTime
    let activeIndex = 0;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] <= currentTime) activeIndex = i; else break;
    }

    // Plex / image source object (for thumbnails)
    const plexObj = {
      plex: currentItem.plex,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id, 10)) : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };

    return positions.map((pos, idx) => {
      const minutes = Math.floor(pos / 60);
      const seconds = pos % 60;
      const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const isOrigin = idx === 0;
      const isActive = idx === activeIndex;
      const isPast = idx < activeIndex;
      const classes = ["seek-button-container"]; if (isOrigin) classes.push('origin'); if (isPast) classes.push('past'); if (isActive) classes.push('active');

  // For origin (0s) use seasonImage first, then item image, otherwise generated frame
  const originSrc = isOrigin ? (currentItem.seasonImage || currentItem.image || generateThumbnailUrl(plexObj, pos)) : null;
      const imgSrc = isOrigin ? originSrc : generateThumbnailUrl(plexObj, pos);

      return (
        <div className={classes.join(' ')} key={`seek-${idx}`} onClick={() => handleSeek(pos)}>
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
  };

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
        case ' ': // Spacebar toggles play/pause unless focused on a button
          if (document.activeElement?.tagName !== 'BUTTON') {
            const videoElement = document.querySelector('.fitness-player-content video') || 
                                 document.querySelector('.fitness-player-content dash-video');
            if (videoElement) {
              if (videoElement.paused) videoElement.play(); else videoElement.pause();
              setIsPaused(videoElement.paused);
            }
          }
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [queue, currentItem, currentTime, duration]);

  // Sync video playback state (time, duration, play/pause) with footer controls.
  // Some custom video wrappers or dash.js elements may throttle 'timeupdate'; add an rAF fallback.
  useEffect(() => {
    const el = contentRef.current?.querySelector('video, dash-video, .video-element');
    if (!el) return; // Player not yet rendered
    let rafId;
    let lastT = -1;
    const update = () => {
      const ct = el.currentTime || 0;
      if (ct !== lastT) {
        lastT = ct;
        setCurrentTime(ct);
      }
      if (!isNaN(el.duration) && el.duration && el.duration !== duration) setDuration(el.duration);
    };
    const handlePlay = () => { setIsPaused(false); update(); };
    const handlePause = () => { setIsPaused(true); update(); };
    const handleTime = () => update();
    const tick = () => { update(); rafId = requestAnimationFrame(tick); };
    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('timeupdate', handleTime);
    el.addEventListener('durationchange', handleTime);
    // Initial snapshot
    setIsPaused(el.paused);
    update();
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('timeupdate', handleTime);
      el.removeEventListener('durationchange', handleTime);
    };
  }, [currentItem, duration]);
  
  // Preload thumbnails when player loads to make seek operations smoother
  useEffect(() => {
    if (!currentItem) return;
    
    const plexObj = {
      // Core identifiers
      plex: currentItem.plex,
      id: currentItem.id,
      // Make sure thumb_id is correctly extracted as a number if possible
      thumb_id: currentItem.thumb_id ? 
                (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id, 10)) :
                null,
      // Image source for direct URL
      image: currentItem.image,
      // Additional metadata
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };
    
    if (isValidPlexObj(plexObj)) {
      console.log('🎬 FitnessPlayer: Preloading thumbnails...');
      const totalDuration = currentItem.duration || currentItem.length || 600;
      
      // Create array of positions to preload
      const positions = [0]; // Start with 0
      for (let i = 1; i <= 8; i++) {
        positions.push(Math.floor((i / 9) * totalDuration));
      }
      positions.push(Math.floor(totalDuration * 0.95)); // End position
      
      // Preload images by creating them but not appending to DOM
      positions.forEach(position => {
        const img = new Image();
        img.src = generateThumbnailUrl(plexObj, position);
      });
    }
  }, [currentItem]);
  
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
  const enhancedCurrentItem = {
    ...currentItem,
    plex: currentItem.id || currentItem.plex,
    media_url: currentItem.media_url || currentItem.videoUrl,
    title: currentItem.title || currentItem.label,
    media_type: 'video',
    type: 'video',
    media_key: currentItem.id || `fitness-${Date.now()}`,
    // Make sure thumb_id is passed along
    thumb_id: currentItem.thumb_id,
    // Additional properties that might help the Player component
    show: currentItem.show || 'Fitness',
    season: currentItem.season || 'Workout',
    percent: 0, // Start from beginning
    seconds: 0, // Start from beginning
    continuous: false // Don't loop videos
  };
  
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
          onClick={toggleFullscreen}
          style={{
            width: videoDims.width ? videoDims.width + 'px' : '100%',
            height: videoDims.height ? videoDims.height + 'px' : 'auto',
            margin: videoDims.width && videoDims.width < (mainPlayerRef.current?.clientWidth || 0) ? '0 auto' : '0'
          }}
        >
          {/* Add an overlay just to block the top-right close button */}
          <div className="player-controls-blocker"></div>
          <Player 
            key={enhancedCurrentItem.media_key || enhancedCurrentItem.plex || Date.now()}
            play={{
              plex: enhancedCurrentItem.plex,
              media_url: enhancedCurrentItem.media_url,
              media_type: 'video',
              media_key: enhancedCurrentItem.media_key,
              title: enhancedCurrentItem.title,
              shader: 'regular',
              volume: currentItem.volume || 1.0,
              playbackRate: currentItem.playbackRate || 1.0,
              type: 'video',
              continuous: false
            }}
            clear={handleClose}
            advance={handleNext}
            playerType="fitness-video"
          />
        </div>
        
        {/* Footer with 3 panels */}
  <div className={`fitness-player-footer${stackMode ? ' stack-mode' : ''}`} ref={footerRef} style={videoDims.hideFooter ? { display: 'none' } : undefined}>
          {/* Panel 1: Previous and Play/Pause buttons */}
          <div className="footer-controls-left">
            <div className="control-buttons-container">
              <button
                onClick={() => {
                  const el = contentRef.current?.querySelector('video, dash-video, .video-element');
                  if (!el) return;
                  if (el.paused) { el.play(); } else { el.pause(); }
                  setIsPaused(el.paused);
                }}
                className="control-button play-pause-button"
              >
                <span className="icon">{isPaused ? "▶" : "⏸"}</span>
              </button>
              <button onClick={handlePrev} disabled={!hasPrev} className="control-button prev-button">
                <span className="icon">⏮</span>
              </button>
            </div>
            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(duration || (currentItem.duration || 600))}
            </div>
          </div>
          
          {/* Panel 2: Seek thumbnails */}
          <div className="footer-seek-thumbnails">
            <div className="progress-bar" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const percent = Math.min(1, Math.max(0, clickX / rect.width));
              const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem.duration || 600));
              const seekTime = percent * baseDuration;
              handleSeek(seekTime);
            }}>
              {(() => {
                const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem.duration || 600));
                const pct = baseDuration > 0 ? (currentTime / baseDuration) * 100 : 0;
                return <div className="progress" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}></div>;
              })()}
            </div>
            <div className="seek-thumbnails">
              {generateSeekButtons()}
            </div>
          </div>
          
          {/* Panel 3: Next and Close buttons */}
          <div className="footer-controls-right">
            <button onClick={handleNext} disabled={!hasNext} className="control-button next-button">
              <span className="icon">⏭</span>
            </button>
            <button onClick={handleClose} className="control-button close-button">
              <span className="icon">✖</span>
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FitnessPlayer;