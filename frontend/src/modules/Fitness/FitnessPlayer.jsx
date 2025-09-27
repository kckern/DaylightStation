import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import './FitnessPlayer.scss';
import { useFitness } from '../../context/FitnessContext.jsx';
import Player from '../Player/Player.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';

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
  const resizingRef = useRef(false);
  // Declare hooks
  const [currentItem, setCurrentItem] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
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

    const compute = () => {
      if (!viewportRef.current) return;
      const { width: totalW, height: totalH } = viewportRef.current.getBoundingClientRect();
      const effectiveSidebar = sidebarWidth; // always reserve current sidebar width
      const footerEl = footerRef.current;
      const footerNatural = footerEl ? footerEl.scrollHeight : 0;
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
      let hideFooter = false;
      // Only allow footer collapse if sidebar width is zero and still overflowing
      if (sidebarWidth === 0 && (videoH + footerNatural > totalH)) {
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
    };

    const ro = new ResizeObserver(() => window.requestAnimationFrame(compute));
    ro.observe(viewportRef.current);
    if (mainPlayerRef.current) ro.observe(mainPlayerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    compute();
    return () => ro.disconnect();
  }, [viewportRef, sidebarWidth]);

  // Mouse drag handlers for sidebar resize
  useEffect(() => {
    const handleMove = (e) => {
      if (!resizingRef.current || !viewportRef?.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left; // position inside viewport
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, x));
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
    
    const buttons = [];
    // Use a default of 10 minutes if no duration is available
    // Try to get duration from various possible sources
    const totalDuration = currentItem.duration || 
                          currentItem.length || 
                          (currentItem.metadata && currentItem.metadata.duration) || 
                          600;
    
    // Get the plexObj from the current item - create an object that includes ALL possible ID properties
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
    
    // Create a button to go back to the beginning - always use black thumbnail
    buttons.push(
      <div className="seek-button-container" key="seek-start" onClick={() => handleSeek(0)}>
        <div className="thumbnail-wrapper">
          <div className="black-thumbnail seek-thumbnail">
            <span className="thumbnail-time">0:00</span>
          </div>
        </div>
      </div>
    );
    
    // Create 8 evenly spaced seek buttons
    for (let i = 1; i <= 8; i++) {
      // Calculate position as a percentage of the total duration
      const position = Math.floor((i / 9) * totalDuration);
      const minutes = Math.floor(position / 60);
      const seconds = position % 60;
      const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      buttons.push(
        <div className="seek-button-container" key={`seek-${i}`} onClick={() => handleSeek(position)}>
          <div className="thumbnail-wrapper">
            <img 
              src={generateThumbnailUrl(plexObj, position)} 
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
    }
    
    // Create a button to jump to near the end
    const endPosition = Math.floor(totalDuration * 0.95);
    const endMinutes = Math.floor(endPosition / 60);
    const endSeconds = endPosition % 60;
    const endLabel = `${endMinutes}:${endSeconds.toString().padStart(2, '0')}`;
    
    buttons.push(
      <div className="seek-button-container" key="seek-end" onClick={() => handleSeek(endPosition)}>
        <div className="thumbnail-wrapper">
          <img 
            src={generateThumbnailUrl(plexObj, endPosition)} 
            alt={`Thumbnail at ${endLabel}`}
            className="seek-thumbnail"
            loading="lazy"
            onError={(e) => handleThumbnailError(e, `End position ${endLabel}`)}
          />
          <span className="thumbnail-time">{endLabel}</span>
          <div className="thumbnail-fallback">End</div>
        </div>
      </div>
    );
    
    return buttons;
  };

  // Effect to track queue changes and set current item
  useEffect(() => {
    console.log('🎬 FitnessPlayer useEffect: Queue length:', queue.length, 'Current item:', currentItem);
    // Queue initialization logic
    if (queue.length > 0 && !currentItem) {
      console.log('🎬 FitnessPlayer: Setting current item to first in queue:', queue[0]);
      // Prepare the media item with proper URL structure
      const firstItem = queue[0];
      // Ensure the video URL is properly formatted
      if (firstItem && !firstItem.media_url && firstItem.videoUrl) {
        firstItem.media_url = firstItem.videoUrl;
      }
      setCurrentItem(firstItem);
    }
    
    // No need to track progress if there's no current item
    if (!currentItem) return;
    
    // Progress tracking logic
    const updateVideoProgress = () => {
      const mediaElement = document.querySelector('.fitness-player-content video') || 
                          document.querySelector('.fitness-player-content dash-video') ||
                          document.querySelector('.fitness-player-content .video-element');
      
      if (mediaElement) {
        setCurrentTime(mediaElement.currentTime || 0);
        if (mediaElement.duration && !isNaN(mediaElement.duration)) {
          setDuration(mediaElement.duration || 0);
        }
      }
    };
    
    // Update every second
    const interval = setInterval(updateVideoProgress, 1000);
    
    // Call once immediately to initialize
    updateVideoProgress();
    
    // Clean up the interval when the component unmounts or currentItem changes
    return () => clearInterval(interval);
  }, [queue, currentItem]);
  
  // Add keyboard navigation support for the player
  useEffect(() => {
    // Skip keyboard handling if no current item
    if (!currentItem) {
      return;
    }
    
    const handleKeyDown = (event) => {
      // Calculate jump points based on duration for navigation
      const totalDuration = duration || currentItem.duration || 600;
      const jumpPoints = [0]; // Start with 0
      
      // Add 8 evenly spaced points
      for (let i = 1; i <= 8; i++) {
        jumpPoints.push(Math.floor((i / 9) * totalDuration));
      }
      
      // Add the end point (95%)
      jumpPoints.push(Math.floor(totalDuration * 0.95));
      
      switch (event.key) {
        case 'ArrowRight':
          // If shift is pressed, jump to next section instead of 30 seconds
          if (event.shiftKey) {
            // Find the next jump point
            const nextPoint = jumpPoints.find(point => point > currentTime + 5);
            if (nextPoint) {
              handleSeek(nextPoint);
            } else {
              handleSeek(Math.min(currentTime + 30, totalDuration));
            }
          } else {
            // Standard 30 second jump
            handleSeek(Math.min(currentTime + 30, totalDuration));
          }
          break;
        case 'ArrowLeft':
          // If shift is pressed, jump to previous section instead of 30 seconds
          if (event.shiftKey) {
            // Find the previous jump point
            const reversedPoints = [...jumpPoints].reverse();
            const prevPoint = reversedPoints.find(point => point < currentTime - 5);
            if (prevPoint) {
              handleSeek(prevPoint);
            } else {
              handleSeek(Math.max(currentTime - 30, 0));
            }
          } else {
            // Standard 30 second jump back
            handleSeek(Math.max(currentTime - 30, 0));
          }
          break;
        case 'Escape':
          handleClose();
          break;
        case ' ': // Spacebar
          if (document.activeElement.tagName !== 'BUTTON') {
            // Toggle play/pause if a player control is available
            const videoElement = document.querySelector('.fitness-player-content video') || 
                                document.querySelector('.fitness-player-content dash-video');
            if (videoElement) {
              if (videoElement.paused) {
                videoElement.play();
              } else {
                videoElement.pause();
              }
            }
          }
          break;
        default:
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentTime, duration, currentItem]);
  
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

  if (!currentItem) return null;

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
  
  return (
    <div className="fitness-player">
      {/* SideBar Panel */}
      <div
        className="fitness-player-sidebar"
        style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}
      >
        {currentItem ? (
          <div className="sidebar-content">
            <h3>{currentItem.title || 'Fitness Video'}</h3>
            
            <div className="workout-info">
              <h4>Workout Details</h4>
            </div>
            
            {currentItem.description && (
              <div className="workout-description">
                <h5>Description</h5>
                <p>{currentItem.description}</p>
              </div>
            )}
            
            <div className="workout-details">
              <h5>Information</h5>
              <ul>
                <li><span>Type:</span> {currentItem.type || currentItem.show || 'Workout'}</li>
                <li><span>Duration:</span> {formatTime(currentItem.duration || duration || 600)}</li>
                <li><span>Instructor:</span> {currentItem.instructor || currentItem.author || 'Unknown'}</li>
                <li><span>Difficulty:</span> {currentItem.difficulty || 'Intermediate'}</li>
                <li><span>Equipment:</span> {currentItem.equipment || 'Basic'}</li>
              </ul>
            </div>
            
            <div className="queue-info">
              <h5>Queue</h5>
              <p>{queue.length} item{queue.length !== 1 ? 's' : ''} in queue</p>
              <p>Currently playing {queue.findIndex(item => item.id === currentItem?.id) + 1} of {queue.length}</p>
            </div>
            
            <div className="keyboard-shortcuts">
              <h5>Keyboard Shortcuts</h5>
              <ul>
                <li><kbd>←</kbd> / <kbd>→</kbd> Skip 30s</li>
                <li><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> Jump between thumbnails</li>
                <li><kbd>Space</kbd> Play/Pause</li>
                <li><kbd>Esc</kbd> Close</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="sidebar-content">
            <h3>Fitness Player</h3>
            <p>No video selected</p>
          </div>
        )}
        {/* Drag handle */}
        <div
          className="fitness-player-sidebar-resizer"
          onMouseDown={handleResizeMouseDown}
          onKeyDown={handleResizeKeyDown}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          tabIndex={0}
          title="Drag (or use arrows) to resize sidebar. Double-click or press Enter to reset."
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR)}
        />
      </div>
      
      {/* MainPlayer Panel */}
      <div className="fitness-player-main" ref={mainPlayerRef}>
        {/* MainContent - 16:9 aspect ratio container */}
        <div
          className="fitness-player-content"
          ref={contentRef}
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
  <div className="fitness-player-footer" ref={footerRef} style={videoDims.hideFooter ? { display: 'none' } : undefined}>
          {/* Panel 1: Previous and Play/Pause buttons */}
          <div className="footer-controls-left">
            <div className="control-buttons-container">
              <button onClick={() => setIsPaused(!isPaused)} className="control-button play-pause-button">
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
              const percent = clickX / rect.width;
              const seekTime = percent * (duration || currentItem.duration || 600);
              handleSeek(seekTime);
            }}>
              <div className="progress" style={{ width: `${((currentTime / (duration || currentItem.duration || 600)) * 100)}%` }}></div>
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