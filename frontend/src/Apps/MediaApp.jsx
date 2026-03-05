// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import { MediaAppProvider, useMediaApp } from '../contexts/MediaAppContext.jsx';
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
import SearchHomePanel from '../modules/Media/SearchHomePanel.jsx';
import ContentBrowserPanel from '../modules/Media/ContentBrowserPanel.jsx';
import PlayerPanel from '../modules/Media/PlayerPanel.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import { recordPlay, updateProgress } from '../hooks/media/useMediaHistory.js';
import './MediaApp.scss';

const MediaApp = () => {
  return (
    <MediaAppProvider>
      <MediaAppInner />
    </MediaAppProvider>
  );
};

const MediaAppInner = () => {
  const { queue, playerRef } = useMediaApp();
  const location = useLocation();
  const navigate = useNavigate();
  const urlCommandProcessed = useRef(false);
  usePlaybackBroadcast(playerRef, queue.currentItem);
  const logger = useMemo(() => getLogger().child({ app: 'media', sessionLog: true }), []);
  const urlCommand = useMediaUrlParams();

  // Playback state (shared between PlayerPanel and MiniPlayer)
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

  // Process URL command on mount (preserved from original)
  useEffect(() => {
    if (queue.loading || urlCommandProcessed.current) return;
    if (!urlCommand) return;
    urlCommandProcessed.current = true;

    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId });

    if (urlCommand.device && playCommand?.contentId) {
      const params = new URLSearchParams({ open: '/media', play: playCommand.contentId });
      fetch(`/api/v1/device/${urlCommand.device}/load?${params}`)
        .then(r => r.json())
        .then(result => logger.info('media-app.device-cast', { device: urlCommand.device, contentId, ok: result.ok }))
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

  // Record play history when current item changes
  useEffect(() => {
    if (queue.currentItem) recordPlay(queue.currentItem);
  }, [queue.currentItem?.contentId]);

  // Update progress periodically (~every 5s, only while playing)
  const lastProgressBucket = useRef(-1);
  useEffect(() => {
    if (!queue.currentItem?.contentId || playbackState.paused || playbackState.currentTime <= 0) return;
    const bucket = Math.floor(playbackState.currentTime / 5);
    if (bucket === lastProgressBucket.current) return;
    lastProgressBucket.current = bucket;
    updateProgress(queue.currentItem.contentId, playbackState.currentTime, playbackState.duration);
  }, [queue.currentItem?.contentId, playbackState.currentTime, playbackState.paused, playbackState.duration]);

  // Stall detection: if playback hasn't advanced for 30s while not paused, auto-advance
  const stallRef = useRef({ time: 0, since: 0 });
  useEffect(() => {
    if (!queue.currentItem || playbackState.paused) {
      stallRef.current = { time: 0, since: 0 };
      return;
    }
    const now = Date.now();
    const prev = stallRef.current;
    if (Math.abs(playbackState.currentTime - prev.time) > 0.5) {
      stallRef.current = { time: playbackState.currentTime, since: now };
      return;
    }
    // Time hasn't changed — check if stalled long enough
    if (prev.since > 0 && now - prev.since > 30000) {
      logger.warn('media-app.stall-recovery', {
        contentId: queue.currentItem.contentId,
        stalledAt: playbackState.currentTime,
        stallDurationMs: now - prev.since,
      });
      stallRef.current = { time: 0, since: 0 };
      queue.advance(1, { auto: true });
    }
  }, [queue.currentItem?.contentId, playbackState.currentTime, playbackState.paused, queue, logger]);

  // Poll stall check every 5s (playbackState updates may stop during stalls)
  useEffect(() => {
    if (!queue.currentItem || playbackState.paused) return;
    const interval = setInterval(() => {
      const prev = stallRef.current;
      if (prev.since > 0 && Date.now() - prev.since > 30000) {
        logger.warn('media-app.stall-recovery', {
          contentId: queue.currentItem?.contentId,
          stalledAt: prev.time,
          stallDurationMs: Date.now() - prev.since,
        });
        stallRef.current = { time: 0, since: 0 };
        queue.advance(1, { auto: true });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [queue.currentItem?.contentId, playbackState.paused, queue, logger]);

  // Determine active panel from route for mobile layout
  const activePanel = useMemo(() => {
    if (location.pathname.startsWith('/media/play')) return 'player';
    if (location.pathname.startsWith('/media/view/')) return 'browser';
    if (location.pathname.startsWith('/media/search/')) return 'search';
    return 'search'; // default: search/home
  }, [location.pathname]);

  // Extract content ID from /media/view/:contentId route
  const detailContentId = useMemo(() => {
    const match = location.pathname.match(/^\/media\/view\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  if (queue.loading) {
    return (
      <div className="App media-app">
        <div className="media-app-container">
          <div className="media-loading">Loading...</div>
        </div>
      </div>
    );
  }

  const hasCurrentItem = !!queue.currentItem;

  return (
    <div className="App media-app">
      <div className={`media-panels media-panels--active-${activePanel}`}>
        {/* Panel 1: Search/Home (left) */}
        <div className={`media-panel media-panel--search ${activePanel === 'search' ? 'media-panel--active' : ''}`}>
          <SearchHomePanel />
        </div>

        {/* Panel 2: Content Browser (center) */}
        <div className={`media-panel media-panel--browser ${activePanel === 'browser' ? 'media-panel--active' : ''}`}>
          <ContentBrowserPanel contentId={detailContentId} />
        </div>

        {/* Panel 3: Player (right) */}
        <div className={`media-panel media-panel--player ${activePanel === 'player' ? 'media-panel--active' : ''}`}>
          <PlayerPanel
            currentItem={queue.currentItem}
            onItemEnd={handleItemEnd}
            onNext={handleNext}
            onPrev={handlePrev}
            onPlaybackState={setPlaybackState}
            playerRef={playerRef}
          />
        </div>
      </div>

      {/* MiniPlayer: visible on mobile/tablet when player panel is not active */}
      {hasCurrentItem && activePanel !== 'player' && (
        <MiniPlayer
          currentItem={queue.currentItem}
          playbackState={playbackState}
          onExpand={() => navigate('/media/play')}
        />
      )}
    </div>
  );
};

export default MediaApp;
