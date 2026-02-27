import React, { useMemo, forwardRef } from 'react';
import Player from '../Player/Player.jsx';

/**
 * Thin wrapper around Player.jsx for MediaApp.
 * - Single-play mode only (play= prop, never queue=)
 * - Controlled: isFullscreen and onExitFullscreen are props (state owned by parent)
 * - Forwards playerRef for external transport controls
 * - renderOverlay?: () => ReactNode — rendered inside fullscreen wrapper
 * - onPlayerClick: handler for click on the player wrapper div
 *
 * Req: 1.2.3, 8.2.1, 8.2.2
 */
const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, format, onItemEnd, onProgress, config, isFullscreen, onExitFullscreen, renderOverlay, onPlayerClick },
  ref
) {
  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  if (!playObject) return null;

  return (
    <div
      className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}
      onClick={onPlayerClick}
    >
      <Player
        ref={ref}
        play={playObject}
        clear={onItemEnd}
        onProgress={onProgress}
        playerType="media"
      />
      {isFullscreen && (
        <>
          <button
            className="media-fullscreen-exit"
            onClick={onExitFullscreen}
            aria-label="Exit fullscreen"
          >
            &times;
          </button>
          {renderOverlay?.()}
        </>
      )}
    </div>
  );
});

export default MediaAppPlayer;
