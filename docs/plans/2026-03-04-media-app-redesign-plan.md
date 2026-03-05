# MediaApp Three-Panel Responsive Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the MediaApp frontend around a three-panel responsive layout (Search/Home | Content Browser | Player) that works across mobile, tablet, and desktop viewports.

**Architecture:** Route-based panel navigation with CSS-driven responsive layout. Three fixed-role panels display as 1, 2, or 3 columns based on viewport width. All existing renderers, queue management, and search infrastructure are preserved. This is a UI layout + navigation overhaul, not a backend change.

**Tech Stack:** React, React Router, SCSS with global breakpoint mixins, existing hooks (useStreamingSearch, useMediaQueue, useContentDetail, useScopePrefs)

**Design doc:** `docs/plans/2026-03-04-media-app-redesign-design.md`

---

## Task 1: Global Breakpoints File

**Files:**
- Create: `frontend/src/styles/_breakpoints.scss`

**Step 1: Create the breakpoints file**

```scss
// frontend/src/styles/_breakpoints.scss
// Global responsive breakpoints — import in any app or module SCSS.
// Mobile-first: styles outside mixins apply to all viewports.

$bp-md: 768px;   // 2-column threshold (tablet)
$bp-lg: 1200px;  // 3-column threshold (desktop)

@mixin mobile-only  { @media (max-width: #{$bp-md - 1}) { @content; } }
@mixin tablet-up    { @media (min-width: $bp-md) { @content; } }
@mixin desktop-up   { @media (min-width: $bp-lg) { @content; } }
@mixin tablet-only  { @media (min-width: $bp-md) and (max-width: #{$bp-lg - 1}) { @content; } }
```

**Step 2: Verify it compiles**

Run: `cd /root/Code/DaylightStation && npx sass frontend/src/styles/_breakpoints.scss --no-source-map /dev/stdout`
Expected: Empty output (partials don't produce output on their own, but no errors)

**Step 3: Commit**

```bash
git add frontend/src/styles/_breakpoints.scss
git commit -m "feat(media): add global responsive breakpoint mixins"
```

---

## Task 2: MediaApp Route Structure

Replace the mode-based navigation (browse/player) with React Router routes.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`

**Step 1: Rewrite MediaAppInner with route structure**

Replace the entire `MediaAppInner` component. The new structure uses `useLocation` to determine which panel is active on mobile, while tablet/desktop show multiple panels simultaneously via CSS.

```jsx
// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Routes, Route, useParams } from 'react-router-dom';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import { MediaAppProvider, useMediaApp } from '../contexts/MediaAppContext.jsx';
import { usePlaybackBroadcast } from '../hooks/media/usePlaybackBroadcast.js';
import SearchHomePanel from '../modules/Media/SearchHomePanel.jsx';
import ContentBrowserPanel from '../modules/Media/ContentBrowserPanel.jsx';
import PlayerPanel from '../modules/Media/PlayerPanel.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
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
```

**Step 2: Verify the app builds (will have import errors for new components — that's expected)**

Run: `cd /root/Code/DaylightStation && npx vite build 2>&1 | head -20`
Expected: Import errors for SearchHomePanel, ContentBrowserPanel, PlayerPanel (not yet created)

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): rewrite MediaApp with route-based three-panel layout"
```

---

## Task 3: SearchHomePanel Component

Create the left panel: search bar + recent searches + recently played + continue watching.

**Files:**
- Create: `frontend/src/modules/Media/SearchHomePanel.jsx`

**Step 1: Create SearchHomePanel**

This replaces the old `ContentBrowser` home screen. It keeps the search bar + scope dropdown but replaces browse categories with Continue/Recently Played/Recent Searches sections.

```jsx
// frontend/src/modules/Media/SearchHomePanel.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { useScopePrefs } from '../../hooks/media/useScopePrefs.js';
import ScopeDropdown from './ScopeDropdown.jsx';
import ScopeChips from './ScopeChips.jsx';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';

// --- Recent Searches (localStorage) ---
const RECENT_SEARCHES_KEY = 'media-recent-searches';
const MAX_RECENT_SEARCHES = 10;

function loadRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
  } catch { return []; }
}

function saveRecentSearch(query, scope) {
  const existing = loadRecentSearches().filter(s => s.query !== query);
  const updated = [{ query, scope, timestamp: Date.now() }, ...existing].slice(0, MAX_RECENT_SEARCHES);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  return updated;
}

export function resolveContentId(item) {
  return item.id || item.contentId;
}

const SearchHomePanel = () => {
  const { queue } = useMediaApp();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'SearchHomePanel' }), []);
  const [searchText, setSearchText] = useState('');
  const [searchScopes, setSearchScopes] = useState([]);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const searchTimerRef = useRef(null);

  // Scope persistence
  const { lastScopeKey, recents, favorites, recordUsage, toggleFavorite } = useScopePrefs();
  const [activeScopeKey, setActiveScopeKey] = useState(lastScopeKey);

  const activeScopeParams = useMemo(() => {
    for (const scope of searchScopes) {
      if (scope.key === activeScopeKey) return scope.params || '';
      if (scope.children) {
        const child = scope.children.find(c => c.key === activeScopeKey);
        if (child) return child.params || '';
      }
    }
    return 'capability=playable&take=25';
  }, [searchScopes, activeScopeKey]);

  // Fetch search scopes from backend
  useEffect(() => {
    logger.info('search-home.mounted');
    fetch('/api/v1/media/config')
      .then(r => r.json())
      .then(data => {
        setSearchScopes(data.searchScopes || []);
        logger.info('search-home.scopes-loaded', { scopeCount: (data.searchScopes || []).length });
      })
      .catch(err => logger.warn('search-home.config-fetch-failed', { error: err.message }));
    return () => {
      logger.info('search-home.unmounted');
      clearTimeout(searchTimerRef.current);
    };
  }, [logger]);

  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    activeScopeParams
  );

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    clearTimeout(searchTimerRef.current);
    if (!val || val.length < 2) {
      search(val);
      return;
    }
    searchTimerRef.current = setTimeout(() => search(val), 300);
  }, [search]);

  const handleScopeSelect = useCallback((scope) => {
    logger.info('search-home.scope-changed', { key: scope.key });
    setActiveScopeKey(scope.key);
    if (searchText.length >= 2) {
      search(searchText, scope.params);
    }
  }, [logger, searchText, search]);

  // Record recent search when user interacts with a result
  const recordSearchInteraction = useCallback(() => {
    if (searchText.length >= 2) {
      const updated = saveRecentSearch(searchText, activeScopeKey);
      setRecentSearches(updated);
      logger.debug('search-home.recent-recorded', { query: searchText });
    }
  }, [searchText, activeScopeKey, logger]);

  const handleResultClick = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (contentId) navigate(`/media/view/${contentId}`);
  }, [recordSearchInteraction, navigate]);

  const handlePlayNow = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.play-now', { contentId, title: item.title });
    queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
    navigate('/media/play');
  }, [recordSearchInteraction, queue, logger, navigate]);

  const handlePlayNext = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.play-next', { contentId });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next');
  }, [recordSearchInteraction, queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.add-to-queue', { contentId });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
  }, [recordSearchInteraction, queue, logger]);

  const handleRecentSearchClick = useCallback((entry) => {
    setSearchText(entry.query);
    if (entry.scope) setActiveScopeKey(entry.scope);
    search(entry.query);
    logger.debug('search-home.recent-clicked', { query: entry.query });
  }, [search, logger]);

  const handleSourceBadgeClick = useCallback((source) => {
    for (const scope of searchScopes) {
      if (scope.children) {
        const match = scope.children.find(c => {
          const p = new URLSearchParams(c.params);
          return p.get('source') === source;
        });
        if (match) { handleScopeSelect(match); return; }
      }
    }
  }, [searchScopes, handleScopeSelect]);

  const isSearchActive = searchText.length > 0;

  return (
    <div className="search-home-panel">
      <div className="search-home-header">
        <ScopeDropdown
          scopes={searchScopes}
          activeKey={activeScopeKey}
          onSelect={handleScopeSelect}
          recents={recents}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
        <input
          type="text"
          className="search-home-input"
          placeholder="Search media..."
          value={searchText}
          onChange={handleSearch}
        />
      </div>

      <div className="search-home-body">
        {isSearchActive ? (
          <div className="search-home-results">
            <ScopeChips
              results={results}
              scopes={searchScopes}
              activeKey={activeScopeKey}
              onSelect={handleScopeSelect}
            />
            {(isSearching) && (
              <div className="search-loading">
                <span className="search-loading-spinner" />
                <span>{pending.length > 0 ? `Searching ${pending.length} source${pending.length > 1 ? 's' : ''}...` : 'Searching...'}</span>
              </div>
            )}
            {results.map((item, i) => {
              const contentId = resolveContentId(item);
              return (
                <div key={contentId || i} className="search-result-item">
                  <div className="search-result-thumb">
                    {(item.thumbnail || contentId) && <img src={item.thumbnail || ContentDisplayUrl(contentId)} alt="" />}
                  </div>
                  <div className="search-result-info" onClick={() => handleResultClick(item)}>
                    <div className="search-result-title">{item.title}</div>
                    <div className="search-result-meta">
                      {item.source && (
                        <span className="source-badge source-badge--clickable"
                              onClick={(e) => { e.stopPropagation(); handleSourceBadgeClick(item.source); }}
                              title={`Search only ${item.source}`}>
                          {item.source}
                        </span>
                      )}
                      {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
                      {item.format && <span className={`format-badge format-badge--${item.format}`}>{item.format}</span>}
                    </div>
                  </div>
                  <div className="search-result-actions">
                    <button onClick={() => handlePlayNow(item)} title="Play Now">&#9654;</button>
                    <button onClick={() => handlePlayNext(item)} title="Play Next">&#10549;</button>
                    <button onClick={() => handleAddToQueue(item)} title="Add to Queue">+</button>
                    <CastButton contentId={contentId} className="search-action-cast" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="search-home-sections">
            {/* TODO Task 7: Continue section (items with progress) */}
            {/* TODO Task 7: Recently Played section */}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div className="search-home-section">
                <h3 className="search-home-section-title">Recent Searches</h3>
                {recentSearches.map((entry, i) => (
                  <button key={i} className="recent-search-item" onClick={() => handleRecentSearchClick(entry)}>
                    <span className="recent-search-query">{entry.query}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchHomePanel;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/SearchHomePanel.jsx
git commit -m "feat(media): add SearchHomePanel with search, recent searches"
```

---

## Task 4: ContentBrowserPanel Component

Create the center panel that wraps ContentDetailView with breadcrumb navigation.

**Files:**
- Create: `frontend/src/modules/Media/ContentBrowserPanel.jsx`

**Step 1: Create ContentBrowserPanel**

```jsx
// frontend/src/modules/Media/ContentBrowserPanel.jsx
import React, { useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ContentDetailView from './ContentDetailView.jsx';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Center panel: wraps ContentDetailView with breadcrumb navigation.
 * Tracks navigation history for breadcrumbs on desktop.
 */
const ContentBrowserPanel = ({ contentId }) => {
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowserPanel' }), []);
  const navigate = useNavigate();
  const location = useLocation();
  const historyRef = useRef([]);

  // Track breadcrumb history from route changes
  useEffect(() => {
    if (!contentId) {
      historyRef.current = [];
      return;
    }
    const current = historyRef.current;
    // If navigating back to a previous entry, trim forward history
    const existingIdx = current.findIndex(e => e.contentId === contentId);
    if (existingIdx >= 0) {
      historyRef.current = current.slice(0, existingIdx + 1);
    } else {
      historyRef.current = [...current, { contentId, title: null }];
    }
    logger.debug('browser-panel.history', { depth: historyRef.current.length, contentId });
  }, [contentId, logger]);

  // Callback to update breadcrumb title once data loads
  const handleTitleResolved = (title) => {
    const current = historyRef.current;
    if (current.length > 0) {
      current[current.length - 1].title = title;
    }
  };

  if (!contentId) {
    return (
      <div className="content-browser-panel">
        <div className="content-browser-panel-empty">
          <p>Select something to browse</p>
        </div>
      </div>
    );
  }

  const breadcrumbs = historyRef.current.slice(0, -1); // All except current

  return (
    <div className="content-browser-panel">
      {breadcrumbs.length > 0 && (
        <div className="content-browser-breadcrumbs">
          <button onClick={() => navigate(-1)}>&larr; Back</button>
          {breadcrumbs.map((b, i) => (
            <button key={i} className="breadcrumb" onClick={() => navigate(`/media/view/${b.contentId}`)}>
              {b.title || b.contentId.split(':').pop()}
            </button>
          ))}
        </div>
      )}
      <ContentDetailView contentId={contentId} onTitleResolved={handleTitleResolved} />
    </div>
  );
};

export default ContentBrowserPanel;
```

**Step 2: Add `onTitleResolved` callback to ContentDetailView**

Modify `frontend/src/modules/Media/ContentDetailView.jsx` — add one line after data loads:

In the `useContentDetail` effect, after `setData(infoData)` succeeds and title is available, call the callback:

```jsx
// Add onTitleResolved to props
const ContentDetailView = ({ contentId, onTitleResolved }) => {
  // ... existing code ...

  // After data loads, notify parent of title
  useEffect(() => {
    if (data?.title) onTitleResolved?.(data.title);
  }, [data?.title, onTitleResolved]);

  // ... rest unchanged ...
};
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowserPanel.jsx frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): add ContentBrowserPanel with breadcrumb navigation"
```

---

## Task 5: PlayerPanel Component

Create the right panel: format-adaptive player + inline queue.

**Files:**
- Create: `frontend/src/modules/Media/PlayerPanel.jsx`

**Step 1: Create PlayerPanel**

This wraps the existing `NowPlaying` component (which handles all format rendering) and adds an inline queue below it for desktop, or a collapsible queue preview for mobile.

```jsx
// frontend/src/modules/Media/PlayerPanel.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import NowPlaying from './NowPlaying.jsx';
import QueueDrawer from './QueueDrawer.jsx';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import getLogger from '../../lib/logging/Logger.js';

const PlayerPanel = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, playerRef }) => {
  const logger = useMemo(() => getLogger().child({ component: 'PlayerPanel' }), []);
  const navigate = useNavigate();
  const { queue } = useMediaApp();
  const [queueExpanded, setQueueExpanded] = useState(false);

  const handleCollapse = useCallback(() => {
    logger.debug('player-panel.collapse');
    navigate(-1);
  }, [navigate, logger]);

  // Next item in queue for "Up Next" preview
  const nextItem = useMemo(() => {
    if (!queue.items.length || queue.position >= queue.items.length - 1) return null;
    return queue.items[queue.position + 1];
  }, [queue.items, queue.position]);

  return (
    <div className="player-panel">
      {/* Collapse handle — mobile only */}
      <div className="player-panel-collapse" onClick={handleCollapse}>
        <div className="player-panel-collapse-bar" />
      </div>

      {/* Now Playing area */}
      <div className="player-panel-media">
        <NowPlaying
          currentItem={currentItem}
          onItemEnd={onItemEnd}
          onNext={onNext}
          onPrev={onPrev}
          onPlaybackState={onPlaybackState}
          playerRef={playerRef}
        />
      </div>

      {/* Queue — desktop: always visible; mobile: collapsible */}
      <div className={`player-panel-queue ${queueExpanded ? 'player-panel-queue--expanded' : ''}`}>
        {/* Mobile: Up Next preview bar */}
        <div className="player-panel-queue-preview" onClick={() => setQueueExpanded(!queueExpanded)}>
          <span className="queue-preview-label">
            {nextItem ? `Up Next: ${nextItem.title || nextItem.contentId}` : `Queue (${queue.items.length})`}
          </span>
          <span className="queue-preview-chevron">{queueExpanded ? '\u25BC' : '\u25B2'}</span>
        </div>
        {/* Full queue list */}
        <div className="player-panel-queue-list">
          <QueueDrawer />
        </div>
      </div>
    </div>
  );
};

export default PlayerPanel;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/PlayerPanel.jsx
git commit -m "feat(media): add PlayerPanel with format-adaptive player + inline queue"
```

---

## Task 6: Responsive SCSS Layout

Replace MediaApp.scss layout styles with the three-panel responsive grid.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Add panel layout styles**

Add these styles to the top of `MediaApp.scss` (after the existing `.media-app` block), replacing the old `.media-mode-browse`, `.media-mode-player`, `.player-mode`, and `.player-swipe-container` styles.

Keep all existing component styles (`.media-now-playing`, `.media-mini-player`, `.queue-drawer`, `.search-result-*`, `.content-detail-*`, etc.) — only replace the layout container styles.

```scss
@use '../styles/breakpoints' as *;

// ── Three-Panel Layout ────────────────────────────────────────
.media-panels {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;

  // Tablet: 2-column grid (search + browser)
  @include tablet-up {
    display: grid;
    grid-template-columns: 320px 1fr;
    grid-template-rows: 1fr;
  }

  // Desktop: 3-column grid (search + browser + player)
  @include desktop-up {
    grid-template-columns: 320px 1fr 360px;
  }
}

.media-panel {
  overflow: hidden;
  display: flex;
  flex-direction: column;

  // Mobile: only active panel is visible
  @include mobile-only {
    display: none;
    &.media-panel--active {
      display: flex;
      flex: 1;
    }
  }
}

.media-panel--search {
  border-right: 1px solid #222;

  @include mobile-only {
    border-right: none;
  }
}

.media-panel--browser {
  @include desktop-up {
    border-right: 1px solid #222;
  }
}

.media-panel--player {
  // Tablet: player is hidden (mini player shows instead)
  @include tablet-only {
    display: none;
  }
}

// ── Search/Home Panel ──────────────────────────────────────────
.search-home-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.search-home-header {
  display: flex;
  padding: 12px;
  gap: 8px;
  border-bottom: 1px solid #222;
}

.search-home-input {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 8px 12px;
  color: #e0e0e0;
  font-size: 14px;

  &::placeholder { color: #666; }
  &:focus { outline: none; border-color: #1db954; }
}

// When preceded by scope dropdown, flatten left border
.scope-dropdown + .search-home-input {
  border-radius: 0 8px 8px 0;
}

.search-home-body {
  flex: 1;
  overflow-y: auto;
}

.search-home-sections {
  padding: 8px 0;
}

.search-home-section {
  padding: 8px 12px;
}

.search-home-section-title {
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px;
}

.recent-search-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  color: #ccc;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;

  &:hover { background: #1a1a1a; }
}

// ── Content Browser Panel ──────────────────────────────────────
.content-browser-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.content-browser-panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #555;
  font-size: 14px;
}

// ── Player Panel ───────────────────────────────────────────────
.player-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #0a0a0a;
}

.player-panel-collapse {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  cursor: pointer;

  @include tablet-up {
    display: none;
  }
}

.player-panel-collapse-bar {
  width: 36px;
  height: 4px;
  background: #444;
  border-radius: 2px;
}

.player-panel-media {
  flex-shrink: 0;
}

.player-panel-queue {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.player-panel-queue-preview {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid #222;
  cursor: pointer;
  font-size: 13px;
  color: #aaa;

  // Desktop: hide preview bar (queue always visible)
  @include desktop-up {
    display: none;
  }
}

.queue-preview-chevron {
  font-size: 10px;
  color: #666;
}

.player-panel-queue-list {
  flex: 1;
  overflow-y: auto;

  // Mobile: hidden by default, shown when expanded
  @include mobile-only {
    display: none;
    .player-panel-queue--expanded & {
      display: block;
    }
  }
}

// ── MiniPlayer visibility adjustment ───────────────────────────
// Hide MiniPlayer on desktop (player panel always visible)
@include desktop-up {
  .media-mini-player {
    display: none;
  }
}
```

**Step 2: Remove old layout styles from MediaApp.scss**

Remove these style blocks that are no longer used:
- `.media-mode-browse` and `.media-mode-player` (lines ~1118-1127)
- `.player-mode` (lines ~1130-1141)
- `.player-collapse-handle` and `.player-collapse-bar` (lines ~1143-1159)
- `.player-swipe-container` and `.player-swipe-page` (lines ~1161-1203)
- `.player-dots` and `.player-dot` (lines ~1205-1227)

Also remove the old `.content-browser-header` and `.content-browser-search` styles (they are replaced by `.search-home-header` and `.search-home-input`), but keep all `.content-browser-body`, `.search-result-*`, `.content-detail-*`, `.queue-*`, `.media-now-playing`, etc.

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): responsive three-panel SCSS layout with breakpoint mixins"
```

---

## Task 7: Continue Watching & Recently Played Sections

Add the Continue and Recently Played sections to the SearchHomePanel home screen.

**Files:**
- Create: `frontend/src/hooks/media/useMediaHistory.js`
- Modify: `frontend/src/modules/Media/SearchHomePanel.jsx`

**Step 1: Create useMediaHistory hook**

This hook fetches continue-watching and recently-played data. Initially backed by the queue's play history — can be enhanced later with a dedicated API.

```jsx
// frontend/src/hooks/media/useMediaHistory.js
import { useState, useEffect } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaHistory' });
  return _logger;
}

const HISTORY_KEY = 'media-play-history';
const MAX_HISTORY = 30;

export function recordPlay(item) {
  if (!item?.contentId) return;
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const filtered = history.filter(h => h.contentId !== item.contentId);
    const entry = {
      contentId: item.contentId,
      title: item.title,
      format: item.format,
      thumbnail: item.thumbnail,
      timestamp: Date.now(),
      progress: item.progress || 0,
      duration: item.duration || 0,
    };
    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    logger().warn('history.save-failed', { error: err.message });
  }
}

export function updateProgress(contentId, progress, duration) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const idx = history.findIndex(h => h.contentId === contentId);
    if (idx >= 0) {
      history[idx].progress = progress;
      history[idx].duration = duration;
      history[idx].timestamp = Date.now();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  } catch { /* ignore */ }
}

export function useMediaHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
    } catch { setHistory([]); }
  }, []);

  const continueItems = history.filter(h => h.progress > 0 && h.duration > 0 && (h.progress / h.duration) < 0.9);
  const recentlyPlayed = history.filter(h => !continueItems.includes(h)).slice(0, 10);

  return { continueItems, recentlyPlayed, refresh: () => {
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch { /* */ }
  }};
}
```

**Step 2: Add Continue and Recently Played sections to SearchHomePanel**

In `SearchHomePanel.jsx`, import `useMediaHistory` and render the sections inside the `search-home-sections` div, replacing the TODO comments:

```jsx
import { useMediaHistory } from '../../hooks/media/useMediaHistory.js';
import { ContentDisplayUrl } from '../../lib/api.mjs';

// Inside SearchHomePanel component:
const { continueItems, recentlyPlayed } = useMediaHistory();

// In the JSX, replace the TODO comments:
{continueItems.length > 0 && (
  <div className="search-home-section">
    <h3 className="search-home-section-title">Continue</h3>
    {continueItems.map(item => (
      <div key={item.contentId} className="search-result-item" onClick={() => {
        navigate(`/media/view/${item.contentId}`);
      }}>
        <div className="search-result-thumb">
          <img src={item.thumbnail || ContentDisplayUrl(item.contentId)} alt="" />
          {item.duration > 0 && (
            <div className="continue-progress-bar">
              <div className="continue-progress-fill" style={{ width: `${(item.progress / item.duration) * 100}%` }} />
            </div>
          )}
        </div>
        <div className="search-result-info">
          <div className="search-result-title">{item.title}</div>
          {item.format && <div className="search-result-meta"><span className={`format-badge format-badge--${item.format}`}>{item.format}</span></div>}
        </div>
      </div>
    ))}
  </div>
)}

{recentlyPlayed.length > 0 && (
  <div className="search-home-section">
    <h3 className="search-home-section-title">Recently Played</h3>
    {recentlyPlayed.map(item => (
      <div key={item.contentId} className="search-result-item" onClick={() => {
        navigate(`/media/view/${item.contentId}`);
      }}>
        <div className="search-result-thumb">
          <img src={item.thumbnail || ContentDisplayUrl(item.contentId)} alt="" />
        </div>
        <div className="search-result-info">
          <div className="search-result-title">{item.title}</div>
          {item.format && <div className="search-result-meta"><span className={`format-badge format-badge--${item.format}`}>{item.format}</span></div>}
        </div>
      </div>
    ))}
  </div>
)}
```

**Step 3: Add continue progress bar styles to MediaApp.scss**

```scss
// Continue progress overlay on thumbnail
.search-result-thumb {
  position: relative;
}

.continue-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #333;
}

.continue-progress-fill {
  height: 100%;
  background: #1db954;
  border-radius: 0 2px 2px 0;
}
```

**Step 4: Wire up history recording in MediaApp**

In `MediaAppInner`, import `recordPlay` and `updateProgress` from `useMediaHistory`, then:
- Call `recordPlay(queue.currentItem)` when `queue.currentItem` changes
- Call `updateProgress(contentId, currentTime, duration)` in the playback state handler

**Step 5: Commit**

```bash
git add frontend/src/hooks/media/useMediaHistory.js frontend/src/modules/Media/SearchHomePanel.jsx frontend/src/Apps/MediaApp.scss frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): add Continue Watching and Recently Played sections"
```

---

## Task 8: MiniPlayer PiP Mode for Video

Adapt the MiniPlayer to show a floating PiP thumbnail for video content.

**Files:**
- Modify: `frontend/src/modules/Media/MiniPlayer.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Add format-aware rendering to MiniPlayer**

```jsx
// In MiniPlayer.jsx, add format detection:
const isVideo = currentItem.format === 'video' || currentItem.format === 'dash_video';

// In the JSX return, wrap with format class:
<div className={`media-mini-player ${isVideo ? 'media-mini-player--pip' : ''}`} onClick={handleBarClick}>
```

**Step 2: Add PiP styles**

```scss
// PiP mode for video
.media-mini-player--pip {
  // Override: floating corner instead of bottom bar
  width: 160px;
  height: 90px;
  bottom: 16px;
  right: 16px;
  left: auto;
  border-radius: 8px;
  border: 1px solid #333;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);

  .mini-player-content {
    padding: 0;
  }

  .mini-player-thumb {
    width: 100%;
    height: 100%;
    border-radius: 8px;
  }

  .mini-player-title,
  .mini-player-toggle {
    display: none;
  }

  .mini-player-progress {
    bottom: 0;
    top: auto;
    border-radius: 0 0 8px 8px;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/MiniPlayer.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): add PiP mini player mode for video content"
```

---

## Task 9: Clean Up Removed Components

Remove components that are no longer used after the redesign.

**Files:**
- Delete: `frontend/src/modules/Media/PlayerSwipeContainer.jsx`
- Delete: `frontend/src/modules/Media/DevicePanel.jsx`
- Delete: `frontend/src/modules/Media/DeviceCard.jsx`
- Delete: `frontend/src/modules/Media/DevicePicker.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss` — remove device panel and swipe container styles

**Step 1: Verify no remaining imports**

Run: `cd /root/Code/DaylightStation && grep -r "PlayerSwipeContainer\|DevicePanel\|DeviceCard\|DevicePicker" frontend/src/ --include="*.jsx" --include="*.js" -l`

Expected: Only the files themselves and possibly the old MediaApp.jsx (which was already rewritten). If any other files import these, update those imports first.

**Step 2: Delete unused files**

```bash
git rm frontend/src/modules/Media/PlayerSwipeContainer.jsx
git rm frontend/src/modules/Media/DevicePanel.jsx
git rm frontend/src/modules/Media/DeviceCard.jsx
git rm frontend/src/modules/Media/DevicePicker.jsx
```

**Step 3: Remove device/swipe styles from MediaApp.scss**

Remove these style blocks:
- `.device-panel`, `.device-panel-*` (~lines 755-796)
- `.media-app .device-card`, `.device-card-*` (~lines 799-907)
- `.device-picker-*` (~lines 909-980)

**Step 4: Remove old ContentBrowser.jsx if fully replaced**

Check if anything still imports the old `ContentBrowser`. The `resolveContentId` function was re-exported from it — make sure `SearchHomePanel` exports it or move it to a shared util.

**Step 5: Commit**

```bash
git add -u
git commit -m "chore(media): remove PlayerSwipeContainer, DevicePanel, DevicePicker"
```

---

## Task 10: Integration Testing & Polish

Verify the full flow works end-to-end across all viewport sizes.

**Step 1: Start dev server and test manually**

Run: `cd /root/Code/DaylightStation && npm run dev`

Test at each breakpoint:
1. **Mobile (< 768px):** Search → see results → tap result → ContentDetailView loads → tap Play → player shows fullscreen → tap collapse → mini player at bottom → tap mini player → player expands
2. **Tablet (768-1199px):** Search panel + content browser side-by-side → mini player at bottom when playing
3. **Desktop (≥ 1200px):** All three panels visible → play something → player panel shows on right → queue below player → continue browsing in center while playing

**Step 2: Verify routes work**

- `/media` → Search/Home panel
- `/media/search/mozart` → Search results
- `/media/view/plex:12345` → Content detail
- `/media/play` → Player panel
- Browser back/forward navigation

**Step 3: Verify existing Playwright tests still pass**

Run: `cd /root/Code/DaylightStation && npx playwright test tests/live/flow/ --reporter=line 2>&1 | tail -20`

**Step 4: Fix any visual issues**

Common things to check:
- Mini player padding on mobile (content not hidden behind it)
- Video player fills player panel correctly
- Queue scrolls independently within player panel
- Scope dropdown doesn't get clipped in narrow search panel
- Content detail hero image works in center panel width

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix(media): integration polish for three-panel layout"
```
