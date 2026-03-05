// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import { MediaAppProvider, useMediaApp } from '../contexts/MediaAppContext.jsx';
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
import NowPlaying from '../modules/Media/NowPlaying.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import QueueDrawer from '../modules/Media/QueueDrawer.jsx';
import ContentBrowser from '../modules/Media/ContentBrowser.jsx';
import ContentDetailView from '../modules/Media/ContentDetailView.jsx';
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
  const logger = useMemo(() => getLogger().child({ app: 'media', sessionLog: true }), []);
  const urlCommand = useMediaUrlParams();

  // Two-mode navigation: 'browse' (default) or 'player' (expanded)
  const [mode, setModeRaw] = useState('browse');
  const setMode = useCallback((newMode) => {
    setModeRaw(prev => {
      if (prev !== newMode) logger.info('media-app.mode-change', { from: prev, to: newMode });
      return newMode;
    });
  }, [logger]);

  // Playback state (shared between NowPlaying and MiniPlayer)
  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
  });

  // Logger setup
  useEffect(() => {
    configureLogger({ context: { app: 'media', sessionLog: true } });
    logger.info('media-app.mounted');
    return () => {
      configureLogger({ context: { sessionLog: false } });
      logger.info('media-app.unmounted');
    };
  }, [logger]);

  // Process URL command on mount
  useEffect(() => {
    if (queue.loading || urlCommandProcessed.current) return;
    if (!urlCommand) return;
    logger.info('media-app.url-parsed', {
      action: urlCommand.play ? 'play' : urlCommand.queue ? 'queue' : 'unknown',
      contentId: (urlCommand.play || urlCommand.queue)?.contentId,
      volume: (urlCommand.play || urlCommand.queue)?.volume,
      shuffle: (urlCommand.play || urlCommand.queue)?.shuffle,
      device: urlCommand.device,
    });
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
      ).then(() => logger.info('media-app.autoplay-result', { contentId, success: true }))
        .catch(err => logger.warn('media-app.autoplay-result', { contentId, success: false, error: err.message }));
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

  // Derive detail view content ID from URL path (e.g., /media/view/plex:12345 or /media/view/readalong:scripture/ot/nirv/1)
  const location = useLocation();
  const detailContentId = useMemo(() => {
    const match = location.pathname.match(/^\/media\/view\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  // Auto-collapse to browse mode when queue empties
  useEffect(() => {
    if (mode === 'player' && !queue.currentItem && queue.items.length === 0) {
      setMode('browse');
    }
  }, [mode, queue.currentItem, queue.items.length]);

  // Auto-expand to player mode for video content (player is hidden in browse mode)
  useEffect(() => {
    if (mode === 'browse' && queue.currentItem) {
      const fmt = queue.currentItem.format;
      if (fmt === 'video' || fmt === 'dash_video') {
        logger.info('media-app.auto-expand-for-video', { format: fmt, contentId: queue.currentItem.contentId });
        setMode('player');
      }
    }
  }, [mode, queue.currentItem?.contentId, queue.currentItem?.format, logger]);

  // Log layout state when currentItem or mode changes
  useEffect(() => {
    if (queue.loading) return;
    logger.info('media-app.layout-state', {
      mode,
      hasCurrentItem: !!queue.currentItem,
      currentFormat: queue.currentItem?.format,
      currentContentId: queue.currentItem?.contentId,
      hasMiniplayer: mode === 'browse' && !!queue.currentItem,
      detailContentId: detailContentId || null,
      playerHidden: mode !== 'player',
    });
  }, [mode, queue.loading, queue.currentItem?.contentId, queue.currentItem?.format, detailContentId, logger]);

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
          {/* ContentBrowser is ALWAYS mounted so search state persists across detail view navigation */}
          <div className={detailContentId ? 'hidden' : ''}>
            <ContentBrowser hasMiniplayer={hasMiniplayer} />
          </div>
          {detailContentId && <ContentDetailView contentId={detailContentId} />}
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
