// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import { MediaAppProvider, useMediaApp } from '../contexts/MediaAppContext.jsx';
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
import NowPlaying from '../modules/Media/NowPlaying.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import QueueDrawer from '../modules/Media/QueueDrawer.jsx';
import ContentBrowser from '../modules/Media/ContentBrowser.jsx';
import './MediaApp.scss';

/**
 * MediaApp — media controller and player.
 * Phase 2: Queue-backed playback with context provider.
 *
 * Req: 1.2.1, 1.2.2, 1.1.1, 1.1.2, 1.1.3, 1.1.9
 */
const MediaApp = () => {
  return (
    <MediaAppProvider>
      <MediaAppInner />
    </MediaAppProvider>
  );
};

const MediaAppInner = () => {
  const { queue, playerRef } = useMediaApp();
  usePlaybackBroadcast(playerRef, queue.currentItem);
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();

  // View state: 'now-playing' or 'mini'
  const [view, setView] = useState('now-playing');

  // Queue drawer and content browser state
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  // Process URL command on mount — now uses queue
  useEffect(() => {
    if (!urlCommand || queue.loading) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId });

    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config: Object.keys(config).length > 0 ? config : undefined }])
      );
    }
    if (volume) queue.setVolume(Number(volume) / 100);
    if (playCommand.shuffle) queue.setShuffle(true);
  }, [urlCommand, queue.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle item end — advance queue
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: queue.currentItem?.contentId });
    queue.advance(1);
    setPlaybackState({ currentTime: 0, duration: 0, paused: true });
  }, [queue.currentItem, queue, logger]);

  // Next/prev now use queue
  const handleNext = useCallback(() => {
    logger.debug('media-app.next-pressed');
    queue.advance(1);
  }, [logger, queue]);

  const handlePrev = useCallback(() => {
    logger.debug('media-app.prev-pressed');
    if (playbackState.currentTime > 3) {
      playerRef.current?.seek?.(0);
    } else {
      queue.advance(-1);
    }
  }, [logger, queue, playbackState.currentTime, playerRef]);

  if (queue.loading) {
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
            currentItem={queue.currentItem}
            onItemEnd={handleItemEnd}
            onNext={handleNext}
            onPrev={handlePrev}
            onPlaybackState={setPlaybackState}
            onQueueToggle={() => setQueueDrawerOpen(o => !o)}
            onSearchToggle={() => setSearchOpen(o => !o)}
            queueLength={queue.items.length}
          />
        )}

        <QueueDrawer
          open={queueDrawerOpen}
          onClose={() => setQueueDrawerOpen(false)}
        />

        <ContentBrowser
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />

        {/* MiniPlayer shows when viewing other panels */}
        {view !== 'now-playing' && queue.currentItem && (
          <MiniPlayer
            currentItem={queue.currentItem}
            playbackState={playbackState}
            onExpand={() => setView('now-playing')}
          />
        )}
      </div>
    </div>
  );
};

export default MediaApp;
