import React, { useMemo, useEffect, useRef, forwardRef } from 'react';
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
  const wrapperRef = useRef(null);

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

  // Layout diagnostics: ResizeObserver fires when element gets/loses dimensions
  // (e.g. parent switches from display:none to visible)
  useEffect(() => {
    if (!playObject || !wrapperRef.current) return;
    const el = wrapperRef.current;
    let lastWidth = 0;
    let lastHeight = 0;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === lastWidth && h === lastHeight) return;
      lastWidth = w;
      lastHeight = h;
      const parentHidden = el.closest('.hidden') !== null;
      const modeContainer = el.closest('.media-mode-player, .media-mode-browse');
      logger.info('media-player.layout', {
        contentId: playObject.contentId,
        isFullscreen,
        width: w,
        height: h,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        parentHidden,
        modeContainer: modeContainer?.className || 'none',
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [playObject?.contentId, isFullscreen, logger]);

  if (!playObject) return null;

  return (
    <div
      ref={wrapperRef}
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
            onClick={(e) => { e.stopPropagation(); onExitFullscreen(); }}
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
