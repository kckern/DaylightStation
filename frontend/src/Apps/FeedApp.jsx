import { useState, useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useParams, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import Headlines from '../modules/Feed/Headlines/Headlines.jsx';
import Scroll from '../modules/Feed/Scroll/Scroll.jsx';
import Reader from '../modules/Feed/Reader/Reader.jsx';
import { FeedPlayerProvider, useFeedPlayer } from '../modules/Feed/players/FeedPlayerContext.jsx';
import FeedPlayerMiniBar from '../modules/Feed/players/FeedPlayerMiniBar.jsx';
import PersistentPlayer from '../modules/Feed/Scroll/PersistentPlayer.jsx';
import { usePlaybackObserver } from '../modules/Feed/Scroll/hooks/usePlaybackObserver.js';
import { DaylightAPI } from '../lib/api.mjs';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import './FeedApp.scss';

const log = getLogger().child({ app: 'feed', module: 'feed-app', sessionLog: true });

// PWA: inject feed-scoped manifest and register service worker
function useFeedPWA() {
  useEffect(() => {
    // Inject manifest link
    let link = document.querySelector('link[rel="manifest"][data-feed-pwa]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/feed-manifest.json';
      link.setAttribute('data-feed-pwa', '');
      document.head.appendChild(link);
    }

    // Register service worker scoped to /feed
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/feed-sw.js', { scope: '/feed' });
    }

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, []);
}

function HeadlinesPage() {
  const { pageId } = useParams();
  return <Headlines pageId={pageId} />;
}

function FeedLayout() {
  useFeedPWA();

  useEffect(() => {
    configureLogger({ context: { app: 'feed', sessionLog: true } });
    log.info('feed-session.start', {
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
    });
    return () => {
      log.info('feed-session.end');
      configureLogger({ context: { sessionLog: false } });
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      log.debug('feed-session.visibility', { state: document.visibilityState });
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const [headlinePages, setHeadlinePages] = useState([]);
  const location = useLocation();
  const isScroll = location.pathname.startsWith('/feed/scroll');

  const { activeMedia, playerVisible, playerRef, stop } = useFeedPlayer();
  const playback = usePlaybackObserver(playerRef, !!activeMedia);
  const showMiniBar = !!activeMedia && !playerVisible;

  // Log mini-bar visibility changes
  const prevMiniBarRef = useRef(showMiniBar);
  useEffect(() => {
    if (showMiniBar !== prevMiniBarRef.current) {
      log.info('feed-layout.miniBar', { visible: showMiniBar, hasMedia: !!activeMedia, playerVisible });
      prevMiniBarRef.current = showMiniBar;
    }
  }, [showMiniBar, activeMedia, playerVisible]);

  useEffect(() => {
    DaylightAPI('/api/v1/feed/headlines/pages')
      .then(pages => setHeadlinePages(pages || []))
      .catch(() => setHeadlinePages([]));
  }, []);

  return (
    <div className="feed-app">
      {!isScroll && (
        <nav className="feed-tabs">
          <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
            Reader
          </NavLink>
          {headlinePages.map(page => (
            <NavLink
              key={page.id}
              to={`/feed/headlines/${page.id}`}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {page.label}
            </NavLink>
          ))}
          <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
            Scroll
          </NavLink>
        </nav>
      )}
      <div className="feed-content">
        <Outlet />
      </div>
      {showMiniBar && (
        <FeedPlayerMiniBar
          item={activeMedia.item}
          playback={playback}
          onOpen={() => {}}
          onClose={stop}
        />
      )}
      <PersistentPlayer
        ref={playerRef}
        contentId={activeMedia?.contentId || null}
        onEnd={stop}
      />
    </div>
  );
}

const FeedApp = () => {
  return (
    <MantineProvider>
      <FeedPlayerProvider>
        <Routes>
          <Route element={<FeedLayout />}>
            <Route index element={<Navigate to="/feed/scroll" replace />} />
            <Route path="reader" element={<Reader />} />
            <Route path="headlines/:pageId" element={<HeadlinesPage />} />
            <Route path="headlines" element={<Navigate to="/feed/headlines/mainstream" replace />} />
            <Route path="scroll" element={<Scroll />} />
            <Route path="scroll/:itemId" element={<Scroll />} />
          </Route>
        </Routes>
      </FeedPlayerProvider>
    </MantineProvider>
  );
};

export default FeedApp;
