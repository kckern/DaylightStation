import React, { useState, useCallback, useMemo, forwardRef } from 'react';
import Player from '../Player/Player.jsx';

/**
 * Thin wrapper around Player.jsx for MediaApp.
 * - Single-play mode only (play= prop, never queue=)
 * - Manages embedded vs fullscreen CSS state
 * - Forwards playerRef for external transport controls
 *
 * Req: 1.2.3, 8.2.1, 8.2.2
 */
const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, format, onItemEnd, onProgress, config },
  ref
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Memoize play object to avoid Player remount on every render
  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  // Format-aware auto-fullscreen
  const handleProgress = useCallback((progressData) => {
    // Auto-fullscreen for video on first progress event
    if (format === 'video' && !isFullscreen && progressData.currentTime === 0) {
      setIsFullscreen(true);
    }
    onProgress?.(progressData);
  }, [format, isFullscreen, onProgress]);

  const handleClear = useCallback(() => {
    setIsFullscreen(false);
    onItemEnd?.();
  }, [onItemEnd]);

  if (!playObject) return null;

  return (
    <div className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}>
      <Player
        ref={ref}
        play={playObject}
        clear={handleClear}
        onProgress={handleProgress}
        playerType="media"
      />
      {isFullscreen && (
        <button
          className="media-fullscreen-exit"
          onClick={() => setIsFullscreen(false)}
          aria-label="Exit fullscreen"
        >
          &times;
        </button>
      )}
    </div>
  );
});

export default MediaAppPlayer;
