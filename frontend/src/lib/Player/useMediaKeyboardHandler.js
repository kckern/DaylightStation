import { useEffect, useRef } from 'react';
import { DaylightAPI } from '../api.mjs';

/**
 * Custom hook for handling media playback keyboard shortcuts
 * Centralizes keyboard handling logic for Player, ContentScroller, and their subcomponents
 */
export function useMediaKeyboardHandler({
  mediaRef,
  getMediaEl,
  onEnd,
  onClear,
  cycleThroughClasses,
  playbackKeys = {},
  queuePosition = 0,
  ignoreKeys = false,
  // Additional props for logging and state updates
  meta,
  type,
  media_key,
  setCurrentTime // For ContentScroller to update its local state
}) {
  const lastKeypressTimeRef = useRef(0);
  const delta = 350;

  useEffect(() => {
    if (ignoreKeys) return;

    const getMedia = () => getMediaEl ? getMediaEl() : mediaRef?.current;

    const skipToNextTrack = () => {
      const mediaEl = getMedia();
      
      // Log completion for Player components
      if (mediaEl && meta && type && media_key) {
        const percent = ((mediaEl.currentTime / mediaEl.duration) * 100).toFixed(1);
        const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
        DaylightAPI(`media/log`, { title, type, media_key, seconds: mediaEl.currentTime, percent: 100 });
        DaylightAPI(`harvest/watchlist`);
      }
      
      onEnd && onEnd(1);
    };

    const skipToPrevTrack = () => {
      const mediaEl = getMedia();
      if (mediaEl && mediaEl.currentTime > 5) {
        mediaEl.currentTime = 0;
        // Update ContentScroller state if needed
        setCurrentTime && setCurrentTime(0);
      } else {
        onEnd && onEnd(-1);
      }
    };

    const advanceInCurrentTrack = (seconds) => {
      const mediaEl = getMedia();
      if (mediaEl) {
        const increment = mediaEl.duration
          ? Math.max(5, Math.floor(mediaEl.duration / 50))
          : 5;
        const newTime = seconds > 0
          ? Math.min(mediaEl.currentTime + Math.max(seconds, increment), mediaEl.duration || 0)
          : Math.max(mediaEl.currentTime + Math.min(seconds, -increment), 0);
        mediaEl.currentTime = newTime;
        // Update ContentScroller state if needed
        setCurrentTime && setCurrentTime(newTime);
      }
    };

    const togglePlayPause = () => {
      const mediaEl = getMedia();
      if (mediaEl) {
        mediaEl.paused ? mediaEl.play() : mediaEl.pause();
      }
    };

    const startTrackOver = () => {
      const mediaEl = getMedia();
      if (mediaEl) {
        mediaEl.currentTime = 0;
        // Update ContentScroller state if needed
        setCurrentTime && setCurrentTime(0);
      }
    };

    const handleRightArrow = () => {
      const isDoubleClick = Date.now() - lastKeypressTimeRef.current < delta;
      lastKeypressTimeRef.current = Date.now();
      if (isDoubleClick) return skipToNextTrack();
      return advanceInCurrentTrack(10);
    };

    const handleLeftArrow = () => {
      const isDoubleClick = Date.now() - lastKeypressTimeRef.current < delta;
      lastKeypressTimeRef.current = Date.now();
      if (isDoubleClick) return skipToPrevTrack();
      return advanceInCurrentTrack(-10);
    };

    const handleKeyDown = (event) => {
      if (event.repeat) return;

      const mediaEl = getMedia();
      const isPlaying = mediaEl?.paused === false;
      const isPaused = mediaEl?.paused === true;
      const isFirstTrackInQueue = queuePosition === 0;

      // When paused and pressing up/down arrows, don't handle them here - let LoadingOverlay handle them
      if (isPaused && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        return;
      }

      const keyMap = {
        // Default keyboard shortcuts
        Tab: skipToNextTrack,
        Backspace: skipToPrevTrack,
        ArrowRight: handleRightArrow,
        ArrowLeft: handleLeftArrow,
        ArrowUp: () => cycleThroughClasses && cycleThroughClasses(1),
        ArrowDown: () => cycleThroughClasses && cycleThroughClasses(-1),
        Escape: onClear,
        Enter: togglePlayPause,
        ' ': togglePlayPause,
        Space: togglePlayPause,
        Spacebar: togglePlayPause,
        MediaPlayPause: togglePlayPause,

        // Custom playback key mappings
        ...(playbackKeys['prev'] || []).reduce((map, key) => ({ 
          ...map, 
          [key]: isFirstTrackInQueue ? startTrackOver : skipToPrevTrack 
        }), {}),
        ...(playbackKeys['play'] || []).reduce((map, key) => ({ 
          ...map, 
          [key]: () => !isPlaying ? mediaEl?.play() : skipToNextTrack() 
        }), {}),
        ...(playbackKeys['pause'] || []).reduce((map, key) => ({ 
          ...map, 
          [key]: togglePlayPause 
        }), {}),
        ...(playbackKeys['rew'] || []).reduce((map, key) => ({ 
          ...map, 
          [key]: () => advanceInCurrentTrack(-10) 
        }), {}),
        ...(playbackKeys['fwd'] || []).reduce((map, key) => ({ 
          ...map, 
          [key]: () => advanceInCurrentTrack(10) 
        }), {})
      };

      const action = keyMap[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onClear, 
    onEnd, 
    cycleThroughClasses, 
    playbackKeys, 
    queuePosition, 
    ignoreKeys,
    mediaRef,
    getMediaEl,
    meta,
    type,
    media_key,
    setCurrentTime
  ]);
}
