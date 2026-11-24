import { subscribeToken } from '@/lib/auth.js';
import { feedQueueOwner } from './offline/feedOfflineStore.js';
import { Select } from '@/lib/ui/Select.jsx';
import { PlaybackFrame } from '@/lib/ui/AppFrame.jsx';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import { lazy, Suspense, useCallback, useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useParams, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { AppThemeProvider } from '@/lib/ui/AppThemeProvider.jsx';
import { DismissStackProvider } from '@/lib/ui/dismiss/DismissStackProvider.jsx';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { useElementSize } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import { FeedPlayerProvider, useFeedPlayer } from "./players/FeedPlayerContext.jsx";
import { FeedWorkspaceProvider, useFeedWorkspace } from "./FeedWorkspaceContext.jsx";
import FeedErrorBoundary from "./FeedErrorBoundary.jsx";
import FeedDataControls from "./FeedDataControls.jsx";
import FeedPlayerMiniBar from "./players/FeedPlayerMiniBar.jsx";
import FeedPlayerSheet from "./players/FeedPlayerSheet.jsx";
import PersistentPlayer from "./Scroll/PersistentPlayer.jsx";
import { usePlaybackObserver } from "./Scroll/hooks/usePlaybackObserver.js";
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import getLogger, { configure as configureLogger } from "../../../../frontend/src/lib/logging/Logger.js";
import { wsService } from "../../../../frontend/src/services/WebSocketService.js";
import "./FeedApp.scss";

const Headlines = lazy(() => import("./Headlines/Headlines.jsx"));
const Scroll = lazy(() => import("./Scroll/Scroll.jsx"));
const Reader = lazy(() => import("./Reader/Reader.jsx"));
const FeedSearch = lazy(() => import("./Search/FeedSearch.jsx"));
const Paper = lazy(() => import("./Paper/Paper.jsx"));
const SEARCH_PATH = '/feed/search';

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

function ReadingAppearance({ pathname }) {
  const { readingPreferences, setReadingPreference, refreshWorkspace, refreshSummary, sourcePreferences, setSourcePreference } = useFeedWorkspace();
  const [open, setOpen] = useState(false);
  const disclosure = useRef(null);
  const summary = useRef(null);

  const close = useCallback(() => {
    const details = disclosure.current;
    if (!details?.open) return;
    const restoreFocus = details.contains(document.activeElement);
    setOpen(false);
    if (restoreFocus) summary.current?.focus({ preventScroll: true });
  }, []);
  useDismissLayer(open, close);

  // Keep account-owned import/export mounted when changing modes.
  useLayoutEffect(close, [pathname, close]);

  return (
    <details ref={disclosure} className="feed-reading-settings" open={open}>
      <summary ref={summary} aria-label="Reading appearance" onClick={event => {
        // Register the layer with this activation, before the next key event.
        event.preventDefault();
        setOpen(current => !current);
      }}>Aa</summary>
      <div className="feed-reading-settings__panel">
        <label>Theme<Select density="compact" value={readingPreferences.theme} onChange={event => setReadingPreference('theme', event.target.value)}><option value="dark">Dark</option><option value="sepia">Sepia</option><option value="light">Light</option></Select></label>
        <label>Text size<Select density="compact" value={readingPreferences.fontScale} onChange={event => setReadingPreference('fontScale', Number(event.target.value))}><option value="0.9">Small</option><option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Extra large</option></Select></label>
        <label>Line spacing<Select density="compact" value={readingPreferences.lineHeight} onChange={event => setReadingPreference('lineHeight', Number(event.target.value))}><option value="1.5">Tight</option><option value="1.65">Standard</option><option value="1.85">Relaxed</option></Select></label>
        <label>Reading width<Select density="compact" value={readingPreferences.measure} onChange={event => setReadingPreference('measure', Number(event.target.value))}><option value="56">Narrow</option><option value="72">Standard</option><option value="88">Wide</option></Select></label>
        <label>Scroll session<Select density="compact" value={readingPreferences.sessionBudget} onChange={event => setReadingPreference('sessionBudget', Number(event.target.value))}><option value="0">Until caught up</option><option value="30">30 items</option><option value="60">60 items</option><option value="100">100 items</option></Select></label>
        <FeedDataControls onImported={() => Promise.all([refreshWorkspace(), refreshSummary()])} />
        {!!Object.keys(sourcePreferences).length && <div className="feed-source-preferences"><span>Adjusted sources</span>{Object.entries(sourcePreferences).map(([source, level]) => <div key={source}><span>{source} · {level}</span><button type="button" aria-label={`Reset ${source} to normal`} onClick={() => setSourcePreference(source, 'normal').catch(() => {})}>Reset</button></div>)}</div>}
      </div>
    </details>
  );
}

function FeedLayout() {
  useFeedPWA();
  const scrollRef = useRef(null);
  const { ref: tabsRef, height: tabsHeight } = useElementSize();

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

  const { data: pages } = useApiResource('/api/v1/feed/headlines/pages', { label: 'Feed headline pages', dedupe: false });
  const headlinePages = Array.isArray(pages) ? pages : [];
  const location = useLocation();
  const navigate = useNavigate();
  const isScroll = location.pathname.startsWith('/feed/scroll');
  const isHeadlines = location.pathname.startsWith('/feed/headlines');
  const isSearch = Boolean(useMatch(SEARCH_PATH));
  const isPaper = Boolean(useMatch('/feed/paper/*'));
  const currentHeadlinePage = isHeadlines ? location.pathname.split('/').filter(Boolean)[2] : '';
  const { density, setDensity, readingPreferences, summary, retrySync, pendingMutations, workspaceReady } = useFeedWorkspace();

  const { activeMedia, playerRef, stop, speed, volume } = useFeedPlayer();
  const playback = usePlaybackObserver(playerRef, !!activeMedia, activeMedia?.contentId);
  const showMiniBar = Boolean(activeMedia);
  const [sheetOpen, setSheetOpen] = useState(false);

  const playerOpenerRef = useRef(null);
  const closePlayerSheet = useCallback(() => setSheetOpen(false), []);

  // Close sheet if media is cleared
  useEffect(() => {
    if (!activeMedia) setSheetOpen(false);
  }, [activeMedia]);

  // Log mini-bar visibility changes
  const prevMiniBarRef = useRef(showMiniBar);
  useEffect(() => {
    if (showMiniBar !== prevMiniBarRef.current) {
      log.info('feed-layout.miniBar', { visible: showMiniBar, hasMedia: !!activeMedia });
      prevMiniBarRef.current = showMiniBar;
    }
  }, [showMiniBar, activeMedia]);

  // Keep the current mode's tab in view when the rail scrolls on a phone,
  // again whenever a tab changes width (the unread badge, the web font).
  const modesRef = useRef(null);
  useLayoutEffect(() => {
    const rail = modesRef.current;
    if (!rail) return undefined;
    const reveal = () => {
      const active = rail.querySelector('a.active');
      if (!active || rail.scrollWidth <= rail.clientWidth) return;
      const start = active.offsetLeft - rail.offsetLeft;
      const end = start + active.offsetWidth;
      if (start < rail.scrollLeft) rail.scrollLeft = start;
      else if (end > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = end - rail.clientWidth;
    };
    reveal();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(reveal);
    observer.observe(rail);
    for (const tab of rail.children) observer.observe(tab);
    return () => observer.disconnect();
  }, [location.pathname]);

  useHotkey('/', () => {
    if (isSearch) return false;
    navigate(SEARCH_PATH);
  });

  return (
    <PlaybackFrame
      className="feed-app"
      controls={showMiniBar && !sheetOpen && (
        <FeedPlayerMiniBar
          openerRef={playerOpenerRef}
          item={activeMedia.item}
          playback={playback}
          onOpen={() => setSheetOpen(true)}
          onClose={stop}
        />
      )}
      overlays={<FeedPlayerSheet
        open={sheetOpen && !!activeMedia}
        openerRef={playerOpenerRef}
        onClose={closePlayerSheet}
        item={activeMedia?.item}
        playback={playback}
      />}
      player={<PersistentPlayer
        ref={playerRef}
        speed={speed}
        volume={volume}
        media={activeMedia}
        onEnd={stop}
      />}
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
      <nav ref={tabsRef} className={isScroll ? 'feed-tabs feed-tabs--compact' : 'feed-tabs'}
        style={{ '--feed-tabs-height': `${tabsHeight}px` }} aria-label="Feed modes">
        {/* The mode links scroll sideways as one rail on a phone, so the
            controls to the right keep their row instead of wrapping. */}
        <div ref={modesRef} className="feed-tabs__modes">
          <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
            Reader{summary.readerUnread > 0 && <span className="feed-tab-badge" aria-label={`${summary.readerUnread} unread Reader items`}>{summary.readerUnread > 999 ? '999+' : summary.readerUnread}</span>}
          </NavLink>
          <NavLink to={`/feed/headlines/${currentHeadlinePage || headlinePages[0]?.id || 'mainstream'}`} className={() => isHeadlines ? 'active' : ''}>Headlines</NavLink>
          <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
            Scroll
          </NavLink>
          <NavLink to="/feed/paper" className={() => isPaper ? 'active' : ''}>Paper</NavLink>
        </div>
        <span className="feed-tabs__spacer" />
        {isHeadlines && headlinePages.length > 1 && (
          <label className="feed-edition-picker">
            <span className="feed-visually-hidden">Headline edition</span>
            <Select density="compact" value={currentHeadlinePage} onChange={event => navigate(`/feed/headlines/${event.target.value}${location.search}`)}>
              {headlinePages.map(page => <option key={page.id} value={page.id}>{page.label}</option>)}
            </Select>
          </label>
        )}
        <NavLink to={SEARCH_PATH} aria-label="Search feed history" className={({ isActive }) => `feed-tabs__icon ${isActive ? 'active' : ''}`}>Search</NavLink>
        <button className="feed-density-toggle" onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} aria-label={`Use ${density === 'compact' ? 'comfortable' : 'compact'} density`}>
          {density === 'compact' ? 'Comfort' : 'Compact'}
        </button>
        <ReadingAppearance pathname={location.pathname} />
        {(summary.pendingSync + pendingMutations) > 0 && <button className="feed-sync-status" onClick={retrySync} title="Retry synchronization" aria-label={`Retry ${summary.pendingSync + pendingMutations} pending change${summary.pendingSync + pendingMutations === 1 ? '' : 's'}`}><span aria-hidden="true">↻</span><span className="feed-sync-status__label">{summary.pendingSync + pendingMutations} pending</span></button>}
      </nav>
      <main className="feed-content" ref={scrollRef} tabIndex={-1} aria-label="Feed">
        {workspaceReady ? (
          <FeedErrorBoundary route={location.pathname}>
            <Suspense fallback={<div className="feed-placeholder" role="status">Loading view…</div>}><Outlet context={{ scrollRef, playback: { ...playback, progressElRef: playback.detailProgressElRef } }} /></Suspense>
          </FeedErrorBoundary>
        ) : <div className="feed-placeholder" role="status">Restoring your reading workspace…</div>}
      </main>
    </PlaybackFrame>
  );
}

const FeedApp = () => {
  useDocumentTitle('Feed');
  // A sustained backend outage must leave Feed's local playback running.
  useEffect(() => wsService.suppressAutoReload('feed local playback'), []);
  const owner = useSyncExternalStore(subscribeToken, feedQueueOwner);
  return (
    <AppThemeProvider pack="feed">
      <Notifications position="bottom-center" withinPortal={false} data-safe-area-center />
      <DismissStackProvider>
        <FeedWorkspaceProvider key={JSON.stringify(owner)} owner={owner}>
          <FeedPlayerProvider>
            <Routes>
              <Route element={<FeedLayout />}>
                <Route index element={<Navigate to="/feed/scroll" replace />} />
                <Route path="reader" element={<Reader />} />
                <Route path="headlines/:pageId" element={<HeadlinesPage />} />
                <Route path="headlines" element={<Navigate to="/feed/headlines/mainstream" replace />} />
                <Route path="scroll/:feedItemId?" element={<Scroll />} />
                <Route path="search" element={<FeedSearch />} />
                <Route path="paper/:date?" element={<Paper />} />
              </Route>
            </Routes>
          </FeedPlayerProvider>
        </FeedWorkspaceProvider>
      </DismissStackProvider>
    </AppThemeProvider>
  );
};

export default FeedApp;
