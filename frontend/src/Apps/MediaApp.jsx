// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import { MediaAppProvider, useMediaApp } from '../contexts/MediaAppContext.jsx';
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
import NowPlaying from '../modules/Media/NowPlaying.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import QueueDrawer from '../modules/Media/QueueDrawer.jsx';
import ContentBrowser from '../modules/Media/ContentBrowser.jsx';
import DevicePanel from '../modules/Media/DevicePanel.jsx';
import './MediaApp.scss';

/**
 * MediaApp — media controller and player.
 * Phase 5: Queue-backed playback with device monitoring and format-aware fullscreen.
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
  const { queue } = useMediaApp();
  const playerRef = useRef(null);
  const urlCommandProcessed = useRef(false);
  usePlaybackBroadcast(playerRef, queue.currentItem);
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();

  // View state: 'now-playing' or 'mini'
  const [view, setView] = useState('now-playing');

  // Queue drawer, content browser, and device panel state
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);

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
    if (queue.loading || urlCommandProcessed.current) return;
    if (!urlCommand) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    urlCommandProcessed.current = true;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId, device: urlCommand.device });

    // Cast to device if ?device= specified (5.2.3, 5.1.7)
    if (urlCommand.device && playCommand?.contentId) {
      const params = new URLSearchParams({ open: '/media', play: playCommand.contentId });
      fetch(`/api/v1/device/${urlCommand.device}/load?${params}`)
        .then(r => r.json())
        .then(result => logger.info('media-app.device-cast', { device: urlCommand.device, contentId: playCommand.contentId, ok: result.ok }))
        .catch(err => logger.error('media-app.device-cast-failed', { device: urlCommand.device, error: err.message }));
      return; // Don't play locally
    }

    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config: Object.keys(config).length > 0 ? config : undefined }])
      );
    }
    if (volume) queue.setVolume(Number(volume) / 100);
    if (playCommand.shuffle) queue.setShuffle(true);
  }, [urlCommand, queue.loading, queue.clear, queue.addItems, queue.setVolume, queue.setShuffle, logger]);
  // No eslint-disable needed: urlCommandProcessed ref prevents double-execution

  // Handle item end — auto-advance (passes auto:true so repeat:one loops correctly)
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: queue.currentItem?.contentId });
    queue.advance(1, { auto: true });
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
            onDeviceToggle={() => setDevicePanelOpen(o => !o)}
            queueLength={queue.items.length}
            playerRef={playerRef}
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

        <DevicePanel
          open={devicePanelOpen}
          onClose={() => setDevicePanelOpen(false)}
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
