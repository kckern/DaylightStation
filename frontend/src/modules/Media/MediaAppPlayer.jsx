import React, { useMemo, useEffect, forwardRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import Player from '../Player/Player.jsx';

/**
 * Thin wrapper around Player.jsx for MediaApp.
 * - Single-play mode only (play= prop, never queue=)
 * - Controlled: isFullscreen and onExitFullscreen are props (state owned by parent)
 * - Forwards playerRef for external transport controls
 * - renderOverlay?: () => ReactNode — rendered inside fullscreen wrapper
 * - onPlayerClick: handler for click on the player wrapper div
 *
 * Note: format is NOT a prop here — it is embedded in contentId / config via the playObject.
 *
 * Req: 1.2.3, 8.2.1, 8.2.2
 */
const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, onItemEnd, onProgress, config, isFullscreen, onExitFullscreen, renderOverlay, onPlayerClick },
  ref
) {
  const logger = useMemo(() => getLogger().child({ component: 'MediaAppPlayer' }), []);

  // IMPORTANT: config must be a stable object reference (e.g., from useState/useMemo in parent).
  // A new config object reference on each render will cause Player to remount and restart playback.
  // The queue item stores config in state, which is stable — do not inline config objects here.
  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  useEffect(() => {
    if (playObject) {
      logger.info('media-player.loaded', { contentId: playObject.contentId, hasConfig: !!config });
    }
  }, [playObject?.contentId, logger]);

  if (!playObject) return null;

  return (
    <div
      className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}
      // onPlayerClick — wired for Task 2 auto-hide: tap fullscreen wrapper to reveal controls
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
