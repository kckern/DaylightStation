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
import PlayerSwipeContainer from '../modules/Media/PlayerSwipeContainer.jsx';
import './MediaApp.scss';

/**
 * MediaApp — media controller and player.
 *
 * Two-mode navigation:
 *   browse  — ContentBrowser (search/browse media library)
 *   player  — PlayerSwipeContainer with Queue | NowPlaying | Devices
 *
 * Both modes are ALWAYS mounted; CSS display:none hides the inactive one.
 * This keeps the <audio>/<video> element alive across mode switches so
 * playback never interrupts.
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
  const urlCommandProcessed = useRef(false);
  usePlaybackBroadcast(playerRef, queue.currentItem);
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();

  // Two-mode navigation: 'browse' (default) or 'player' (expanded)
  const [mode, setMode] = useState('browse');

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
    if (queue.loading || urlCommandProcessed.current) return;
    if (!urlCommand) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    urlCommandProcessed.current = true;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId, device: urlCommand.device });

    // Cast to device if ?device= specified
    if (urlCommand.device && playCommand?.contentId) {
      const params = new URLSearchParams({ open: '/media', play: playCommand.contentId });
      fetch(`/api/v1/device/${urlCommand.device}/load?${params}`)
        .then(r => r.json())
        .then(result => logger.info('media-app.device-cast', { device: urlCommand.device, contentId: playCommand.contentId, ok: result.ok }))
        .catch(err => logger.error('media-app.device-cast-failed', { device: urlCommand.device, error: err.message }));
      return;
    }

    if (urlCommand.play) {
      queue.clear().then(() =>
        queue.addItems([{ contentId, title: contentId, config: Object.keys(config).length > 0 ? config : undefined }])
      );
    }
    if (volume) queue.setVolume(Number(volume) / 100);
    if (playCommand.shuffle) queue.setShuffle(true);
  }, [urlCommand, queue.loading, queue.clear, queue.addItems, queue.setVolume, queue.setShuffle, logger]);

  // Handle item end — auto-advance
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: queue.currentItem?.contentId });
    queue.advance(1, { auto: true });
    setPlaybackState({ currentTime: 0, duration: 0, paused: true });
  }, [queue.currentItem, queue, logger]);

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

  // Auto-collapse to browse mode when queue empties
  useEffect(() => {
    if (mode === 'player' && !queue.currentItem && queue.items.length === 0) {
      setMode('browse');
    }
  }, [mode, queue.currentItem, queue.items.length]);

  if (queue.loading) {
    return (
      <div className="App media-app">
        <div className="media-app-container">
          <div className="media-loading">Loading...</div>
        </div>
      </div>
    );
  }

  const hasMiniplayer = mode === 'browse' && !!queue.currentItem;

  return (
    <div className="App media-app">
      <div className="media-app-container">
        {/* Browse Mode — always mounted, hidden when in player mode */}
        <div className={`media-mode-browse${mode !== 'browse' ? ' hidden' : ''}`}>
          <ContentBrowser hasMiniplayer={hasMiniplayer} />
        </div>

        {/* Player Mode — always mounted, hidden when in browse mode */}
        <div className={`media-mode-player${mode !== 'player' ? ' hidden' : ''}`}>
          <PlayerSwipeContainer onCollapse={() => setMode('browse')} visible={mode === 'player'}>
            <QueueDrawer />
            <NowPlaying
              currentItem={queue.currentItem}
              onItemEnd={handleItemEnd}
              onNext={handleNext}
              onPrev={handlePrev}
              onPlaybackState={setPlaybackState}
              playerRef={playerRef}
            />
            <DevicePanel />
          </PlayerSwipeContainer>
        </div>

        {/* MiniPlayer: shows in browse mode when something is playing */}
        {hasMiniplayer && (
          <MiniPlayer
            currentItem={queue.currentItem}
            playbackState={playbackState}
            onExpand={() => setMode('player')}
          />
        )}
      </div>
    </div>
  );
};

export default MediaApp;
