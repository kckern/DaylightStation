import React, { useCallback, useMemo } from 'react';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Persistent bottom bar when content is playing.
 * Shows thumbnail, title, play/pause, and thin progress indicator.
 * Tap expands to full NowPlaying view.
 *
 * Req: 1.2.5, 1.1.8
 */
const MiniPlayer = ({ currentItem, playbackState, onExpand }) => {
  const { playerRef } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'MiniPlayer' }), []);

  if (!currentItem) return null;

  const thumbnailUrl = currentItem.contentId
    ? ContentDisplayUrl(currentItem.contentId)
    : null;

  const progress = playbackState?.duration > 0
    ? (playbackState.currentTime / playbackState.duration) * 100
    : 0;

  const handleBarClick = useCallback((e) => {
    if (e.target.closest('.mini-player-toggle')) return;
    logger.debug('mini-player.expand', { contentId: currentItem?.contentId });
    onExpand?.();
  }, [onExpand, logger, currentItem?.contentId]);

  const handleToggle = useCallback(() => {
    logger.debug('mini-player.toggle', { paused: playbackState?.paused, contentId: currentItem?.contentId });
    playerRef.current?.toggle?.();
  }, [playerRef, logger, playbackState?.paused, currentItem?.contentId]);

  return (
    <div className="media-mini-player" onClick={handleBarClick}>
      <div className="mini-player-progress" style={{ width: `${progress}%` }} />
      <div className="mini-player-content">
        {thumbnailUrl && (
          <img className="mini-player-thumb" src={thumbnailUrl} alt="" />
        )}
        <div className="mini-player-title">
          {currentItem.title || currentItem.contentId}
        </div>
        <button
          className="mini-player-toggle"
          onClick={handleToggle}
          aria-label={playbackState?.paused ? 'Play' : 'Pause'}
        >
          {playbackState?.paused ? '\u25B6' : '\u23F8'}
        </button>
      </div>
    </div>
  );
};

export default MiniPlayer;
