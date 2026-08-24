import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { FeedPlayerProvider, useFeedPlayer } from '../modules/Feed/players/FeedPlayerContext.jsx';
import { FeedWorkspaceProvider, useFeedWorkspace } from '../modules/Feed/FeedWorkspaceContext.jsx';
import FeedErrorBoundary from '../modules/Feed/FeedErrorBoundary.jsx';
import FeedDataControls from '../modules/Feed/FeedDataControls.jsx';
import FeedPlayerMiniBar from '../modules/Feed/players/FeedPlayerMiniBar.jsx';
import FeedPlayerSheet from '../modules/Feed/players/FeedPlayerSheet.jsx';
import PersistentPlayer from '../modules/Feed/Scroll/PersistentPlayer.jsx';
import { usePlaybackObserver } from '../modules/Feed/Scroll/hooks/usePlaybackObserver.js';
import { DaylightAPI } from '../lib/api.mjs';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import './FeedApp.scss';

const Headlines = lazy(() => import('../modules/Feed/Headlines/Headlines.jsx'));
const Scroll = lazy(() => import('../modules/Feed/Scroll/Scroll.jsx'));
const Reader = lazy(() => import('../modules/Feed/Reader/Reader.jsx'));
const FeedSearch = lazy(() => import('../modules/Feed/Search/FeedSearch.jsx'));

const log = getLogger().child({ app: 'feed', module: 'feed-app', sessionLog: true });

// The root app already ships /manifest.json + /sw.js. The feed-specific
// manifest and worker provided NO offline behavior (empty fetch handler) and a
// second manifest + overlapping worker scope only created ambiguous, hard-to-
// reason-about behavior. Rather than ship installability theater, we stop
// registering them and actively unregister any previously-installed feed
// worker so it can't keep controlling its scope after deploy. (F-19)
function useFeedPWA() {
  useEffect(() => {
    document.querySelectorAll('link[rel="manifest"][data-feed-pwa]').forEach(el => el.remove());
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => {
          for (const reg of regs) {
            const script = reg.active?.scriptURL || '';
            if (script.includes('/feed-sw.js') || (reg.scope || '').endsWith('/feed')) {
              reg.unregister();
            }
          }
        })
        .catch(() => { /* best-effort cleanup */ });
    }
  }, []);
}

function HeadlinesPage() {
  const { pageId } = useParams();
  return <Headlines pageId={pageId} />;
}

function FeedLayout() {
  useFeedPWA();

  useEffect(() => {
    // Only crank the whole-app logger to debug when explicitly requested via
    // ?debug=1 or window.DAYLIGHT_LOG_LEVEL; otherwise keep info-level so
    // ordinary sessions don't flood the transport with per-frame diagnostics. (F-18)
    const debugMode = new URLSearchParams(window.location.search).get('debug') === '1'
      || (typeof window !== 'undefined' && window.DAYLIGHT_LOG_LEVEL === 'debug');
    configureLogger({ level: debugMode ? 'debug' : 'info', context: { app: 'feed', sessionLog: true } });
    log.info('feed-session.start', {
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
    });
    return () => {
      log.info('feed-session.end');
      configureLogger({ level: 'info', context: { sessionLog: false } });
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
  const navigate = useNavigate();
  const isScroll = location.pathname.startsWith('/feed/scroll');
  const isHeadlines = location.pathname.startsWith('/feed/headlines');
  const currentHeadlinePage = isHeadlines ? location.pathname.split('/').filter(Boolean)[2] : '';
  const { density, setDensity, readingPreferences, setReadingPreference, summary, retrySync, pendingMutations, workspaceReady, refreshSummary, refreshWorkspace, sourcePreferences, setSourcePreference } = useFeedWorkspace();

  const { activeMedia, playerVisible, playerRef, stop, speed } = useFeedPlayer();
  const playback = usePlaybackObserver(playerRef, !!activeMedia, speed);
  const showMiniBar = !!activeMedia && !playerVisible;
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close sheet if media is cleared
  useEffect(() => {
    if (!activeMedia) setSheetOpen(false);
  }, [activeMedia]);

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

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;
      event.preventDefault();
      navigate('/feed/search');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div
      className="feed-app"
      data-density={density}
      data-reading-theme={readingPreferences.theme}
      style={{
        '--feed-reading-scale': readingPreferences.fontScale,
        '--feed-reading-line-height': readingPreferences.lineHeight,
        '--feed-reading-measure': `${readingPreferences.measure}ch`,
      }}
    >
      {/* Persistent nav on every mode so Reader/Headlines stay discoverable
          from Scroll; compact modifier keeps it unobtrusive while scrolling. (F-12) */}
      <nav className={isScroll ? 'feed-tabs feed-tabs--compact' : 'feed-tabs'} aria-label="Feed modes">
        <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
          Reader{summary.readerUnread > 0 && <span className="feed-tab-badge" aria-label={`${summary.readerUnread} unread Reader items`}>{summary.readerUnread > 999 ? '999+' : summary.readerUnread}</span>}
        </NavLink>
        <NavLink to={`/feed/headlines/${currentHeadlinePage || headlinePages[0]?.id || 'mainstream'}`} className={() => isHeadlines ? 'active' : ''}>Headlines</NavLink>
        <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
          Scroll
        </NavLink>
        <span className="feed-tabs__spacer" />
        {isHeadlines && headlinePages.length > 1 && (
          <label className="feed-edition-picker">
            <span className="feed-visually-hidden">Headline edition</span>
            <select value={currentHeadlinePage} onChange={event => navigate(`/feed/headlines/${event.target.value}${location.search}`)}>
              {headlinePages.map(page => <option key={page.id} value={page.id}>{page.label}</option>)}
            </select>
          </label>
        )}
        <NavLink to="/feed/search" aria-label="Search feed history" className={({ isActive }) => `feed-tabs__icon ${isActive ? 'active' : ''}`}>Search</NavLink>
        <button className="feed-density-toggle" onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} aria-label={`Use ${density === 'compact' ? 'comfortable' : 'compact'} density`}>
          {density === 'compact' ? 'Comfort' : 'Compact'}
        </button>
        <details className="feed-reading-settings">
          <summary aria-label="Reading appearance">Aa</summary>
          <div className="feed-reading-settings__panel">
            <label>Theme<select value={readingPreferences.theme} onChange={event => setReadingPreference('theme', event.target.value)}><option value="dark">Dark</option><option value="sepia">Sepia</option><option value="light">Light</option></select></label>
            <label>Text size<select value={readingPreferences.fontScale} onChange={event => setReadingPreference('fontScale', Number(event.target.value))}><option value="0.9">Small</option><option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Extra large</option></select></label>
            <label>Line spacing<select value={readingPreferences.lineHeight} onChange={event => setReadingPreference('lineHeight', Number(event.target.value))}><option value="1.5">Tight</option><option value="1.65">Standard</option><option value="1.85">Relaxed</option></select></label>
            <label>Reading width<select value={readingPreferences.measure} onChange={event => setReadingPreference('measure', Number(event.target.value))}><option value="56">Narrow</option><option value="72">Standard</option><option value="88">Wide</option></select></label>
            <label>Scroll session<select value={readingPreferences.sessionBudget} onChange={event => setReadingPreference('sessionBudget', Number(event.target.value))}><option value="0">Until caught up</option><option value="30">30 items</option><option value="60">60 items</option><option value="100">100 items</option></select></label>
            <FeedDataControls onImported={() => Promise.all([refreshWorkspace(), refreshSummary()])} />
            {!!Object.keys(sourcePreferences).length && <div className="feed-source-preferences"><span>Adjusted sources</span>{Object.entries(sourcePreferences).map(([source, level]) => <div key={source}><span>{source} · {level}</span><button type="button" onClick={() => setSourcePreference(source, 'normal')}>Reset</button></div>)}</div>}
          </div>
        </details>
        {(summary.pendingSync + pendingMutations) > 0 && <button className="feed-sync-status" onClick={retrySync} title="Retry synchronization" aria-label={`Retry ${summary.pendingSync + pendingMutations} pending change${summary.pendingSync + pendingMutations === 1 ? '' : 's'}`}><span aria-hidden="true">↻</span><span className="feed-sync-status__label">{summary.pendingSync + pendingMutations} pending</span></button>}
      </nav>
      <div className="feed-content">
        {workspaceReady ? (
          <FeedErrorBoundary key={location.pathname}>
            <Suspense fallback={<div className="feed-placeholder" role="status">Loading view…</div>}><Outlet /></Suspense>
          </FeedErrorBoundary>
        ) : <div className="feed-placeholder" role="status">Restoring your reading workspace…</div>}
      </div>
      {showMiniBar && !sheetOpen && (
        <FeedPlayerMiniBar
          item={activeMedia.item}
          playback={playback}
          onOpen={() => setSheetOpen(true)}
          onClose={stop}
        />
      )}
      <FeedPlayerSheet
        open={sheetOpen && !!activeMedia}
        onClose={() => setSheetOpen(false)}
        item={activeMedia?.item}
        playback={playback}
      />
      <PersistentPlayer
        ref={playerRef}
        contentId={activeMedia?.contentId || null}
        onEnd={stop}
      />
    </div>
  );
}

const FeedApp = () => {
  useDocumentTitle('Feed');
  return (
    <MantineProvider>
      <Notifications position="bottom-center" />
      <FeedWorkspaceProvider>
        <FeedPlayerProvider>
          <Routes>
            <Route element={<FeedLayout />}>
            <Route index element={<Navigate to="/feed/scroll" replace />} />
            <Route path="reader" element={<Reader />} />
            <Route path="headlines/:pageId" element={<HeadlinesPage />} />
            <Route path="headlines" element={<Navigate to="/feed/headlines/mainstream" replace />} />
            <Route path="scroll" element={<Scroll />} />
            <Route path="scroll/:feedItemId" element={<Scroll />} />
            <Route path="search" element={<FeedSearch />} />
            </Route>
          </Routes>
        </FeedPlayerProvider>
      </FeedWorkspaceProvider>
    </MantineProvider>
  );
};

export default FeedApp;
