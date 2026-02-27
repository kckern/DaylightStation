// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import NowPlaying from '../modules/Media/NowPlaying.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import './MediaApp.scss';

/**
 * MediaApp — media controller and player.
 * Phase 1: URL-driven local playback with basic transport.
 *
 * Req: 1.2.1, 1.2.2, 1.1.1, 1.1.2, 1.1.3, 1.1.9
 */
const MediaApp = () => {
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();

  // View state: 'now-playing' or 'mini' (Phase 1 only has these two)
  const [view, setView] = useState('now-playing');

  // Current item being played
  const [currentItem, setCurrentItem] = useState(null);
  const [loading, setLoading] = useState(false);

  // Playback state (shared between NowPlaying and MiniPlayer)
  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
  });

  // Logger setup
  useEffect(() => {
    configureLogger({ context: { app: 'media' } });
    logger.info('media-app.mounted');
    return () => {
      configureLogger({ context: {} });
      logger.info('media-app.unmounted');
    };
  }, [logger]);

  // Process URL command on mount
  useEffect(() => {
    if (!urlCommand) return;

    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    logger.info('media-app.url-command', {
      action: urlCommand.play ? 'play' : 'queue',
      contentId: playCommand.contentId,
    });

    // Build current item from URL command
    // The Player component handles content resolution internally via Play API,
    // so we just need the contentId and any config modifiers
    const { contentId, ...config } = playCommand;
    setCurrentItem({
      contentId,
      config: Object.keys(config).length > 0 ? config : undefined,
      title: contentId, // Player will resolve the real title
    });
  }, [urlCommand, logger]);

  // Handle item end (clear callback from Player)
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: currentItem?.contentId });
    // Phase 1: single play mode, just clear
    setCurrentItem(null);
    setPlaybackState({ currentTime: 0, duration: 0, paused: true });
  }, [currentItem, logger]);

  // Phase 1: next/prev are no-ops (no queue yet)
  const handleNext = useCallback(() => {
    logger.debug('media-app.next-pressed', { note: 'no queue in Phase 1' });
  }, [logger]);

  const handlePrev = useCallback(() => {
    logger.debug('media-app.prev-pressed', { note: 'no queue in Phase 1' });
  }, [logger]);

  if (loading) {
    return (
      <div className="App media-app">
        <div className="media-app-container">
          <div className="media-loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="App media-app">
      <div className="media-app-container">
        {view === 'now-playing' && (
          <NowPlaying
            currentItem={currentItem}
            onItemEnd={handleItemEnd}
            onNext={handleNext}
            onPrev={handlePrev}
          />
        )}

        {/* MiniPlayer shows when viewing other panels (Phase 2+) */}
        {view !== 'now-playing' && currentItem && (
          <MiniPlayer
            currentItem={currentItem}
            playbackState={playbackState}
            onToggle={() => {
              // In Phase 1, we don't have playerRef at this level
              // MiniPlayer toggle will be wired in Phase 2 via context
            }}
            onExpand={() => setView('now-playing')}
          />
        )}
      </div>
    </div>
  );
};

export default MediaApp;
