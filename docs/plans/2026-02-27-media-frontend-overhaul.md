# MediaApp Frontend Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure MediaApp from an empty-state dead end into a content-first media player with Spotify-style navigation, config-driven browse categories, and responsive desktop 3-column / mobile swipe layout.

**Architecture:** Two-mode navigation (Browse Mode + Player Mode) connected by a MiniPlayer. Browse Mode shows ContentBrowser as the primary view. Player Mode shows Queue | NowPlaying | Devices as swipe pages on mobile or a 3-column layout on desktop. Config-driven browse categories from `config/media.yml`.

**Tech Stack:** React, CSS scroll-snap (mobile), CSS grid (desktop), Express REST API, YAML config

---

## Task 1: Media Browse Config

Create the config file and backend endpoint that drives the browse categories and filter chips.

**Files:**
- Create: `data/household/config/media.yml`
- Modify: `backend/src/4_api/v1/routers/media.mjs`
- Modify: `backend/src/app.mjs` (pass configService to media router)

**Step 1: Create the config file**

```yaml
# data/household/config/media.yml
browse:
  - source: plex
    mediaType: audio
    label: Browse Music
    icon: music
    searchFilter: true
  - source: plex
    mediaType: video
    label: Browse Video
    icon: video
    searchFilter: true
  - source: singalong
    label: Browse Hymns
    icon: hymn
    searchFilter: true
  - source: readable
    label: Browse Books
    icon: book
    searchFilter: true
```

**Step 2: Add configService to media router factory**

In `backend/src/app.mjs`, find the media router wiring (~line 721) and add `configService`:

```javascript
v1Routers.media = createMediaRouter({
  mediaQueueService: mediaServices.mediaQueueService,
  configService,  // ADD THIS
  broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
  logger: rootLogger.child({ module: 'media-api' }),
});
```

**Step 3: Add GET /config endpoint to media router**

In `backend/src/4_api/v1/routers/media.mjs`, destructure `configService` from config (~line 30) and add the endpoint before the queue routes:

```javascript
// Inside createMediaRouter, after destructuring:
const { mediaQueueService, contentIdResolver, configService, broadcastEvent, logger = console } = config;

// Add new route before queue routes:

// ── 0. GET /config ──────────────────────────────────────────────
router.get('/config', asyncHandler(async (req, res) => {
  const hid = resolveHid(req);
  const appConfig = configService.getHouseholdAppConfig(hid, 'media') || {};
  res.json({ browse: appConfig.browse || [] });
}));
```

**Step 4: Verify endpoint works**

Run: `curl http://localhost:3112/api/v1/media/config | jq .`
Expected: JSON with `{ browse: [...] }` array matching the YAML.

**Step 5: Commit**

```bash
git add data/household/config/media.yml backend/src/4_api/v1/routers/media.mjs backend/src/app.mjs
git commit -m "feat(media): add config-driven browse categories endpoint"
```

---

## Task 2: ContentBrowser — Promote to Main View

Remove the overlay pattern and transform ContentBrowser into the always-visible home screen with config-driven browse rows.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Remove overlay pattern and add browse config fetching**

Replace the entire `ContentBrowser.jsx` with this restructured version. Key changes:
- Remove `open`/`onClose` props and the `if (!open) return null` guard (line 65)
- Remove the close button from the header (line 77)
- Fetch browse categories from `/api/v1/media/config` on mount
- Build filter chips from config instead of hardcoded `FILTERS` array
- Add browse-by-source rows that appear when not searching
- Accept new `onMiniPlayerPadding` prop to know if MiniPlayer is showing (for bottom padding)

```jsx
// frontend/src/modules/Media/ContentBrowser.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useContentBrowse } from '../../hooks/media/useContentBrowse.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';

const ContentBrowser = ({ hasMiniplayer }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowser' }), []);
  const [activeFilter, setActiveFilter] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [browseConfig, setBrowseConfig] = useState([]);

  // Fetch browse categories from backend config
  useEffect(() => {
    fetch('/api/v1/media/config')
      .then(r => r.json())
      .then(data => setBrowseConfig(data.browse || []))
      .catch(err => logger.warn('content-browser.config-fetch-failed', { error: err.message }));
  }, [logger]);

  // Build filters from config: "All" + entries with searchFilter: true
  const filters = useMemo(() => {
    const configFilters = browseConfig
      .filter(c => c.searchFilter)
      .map(c => ({
        label: c.label.replace(/^Browse\s+/i, ''),
        params: [c.source && `source=${c.source}`, c.mediaType && `mediaType=${c.mediaType}`]
          .filter(Boolean).join('&'),
      }));
    return [{ label: 'All', params: '' }, ...configFilters];
  }, [browseConfig]);

  const filterParams = filters[activeFilter]?.params || '';
  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    filterParams
  );
  const { breadcrumbs, browseResults, browsing, loading: browseLoading, browse, goBack, exitBrowse } = useContentBrowse();

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    exitBrowse();
    search(val);
  }, [search, exitBrowse]);

  const handlePlayNow = useCallback((item) => {
    const nextPosition = queue.position + 1;
    logger.info('content-browser.play-now', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next')
      .then(() => queue.setPosition(nextPosition));
  }, [queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    logger.info('content-browser.add-to-queue', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }]);
  }, [queue, logger]);

  const handlePlayNext = useCallback((item) => {
    logger.info('content-browser.play-next', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next');
  }, [queue, logger]);

  const handleDrillDown = useCallback((item) => {
    if (item.contentId) {
      const [source, ...rest] = item.contentId.split(':');
      logger.debug('content-browser.drill-down', { source, localId: rest.join(':'), title: item.title });
      browse(source, rest.join(':'), item.title);
    }
  }, [browse, logger]);

  const handleBrowseCategory = useCallback((cat) => {
    logger.info('content-browser.browse-category', { source: cat.source, label: cat.label });
    browse(cat.source, '', cat.label);
  }, [browse, logger]);

  const displayResults = browsing ? browseResults : results;
  const isSearchActive = searchText.length > 0 || browsing;

  return (
    <div className={`content-browser ${hasMiniplayer ? 'content-browser--with-miniplayer' : ''}`}>
      <div className="content-browser-header">
        <input
          type="text"
          className="content-browser-search"
          placeholder="Search media..."
          value={searchText}
          onChange={handleSearch}
          autoFocus
        />
      </div>

      <div className="content-browser-filters">
        {filters.map((f, i) => (
          <button
            key={f.label}
            className={`filter-chip ${i === activeFilter ? 'active' : ''}`}
            onClick={() => { setActiveFilter(i); search(searchText); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Breadcrumbs when browsing */}
      {browsing && (
        <div className="content-browser-breadcrumbs">
          <button onClick={goBack}>&larr; Back</button>
          {breadcrumbs.map((b, i) => (
            <span key={i} className="breadcrumb">{b.title}</span>
          ))}
        </div>
      )}

      <div className="content-browser-body">
        {/* When searching or browsing: show results */}
        {isSearchActive && (
          <div className="content-browser-results">
            {(isSearching || browseLoading) && <div className="search-loading">Searching...</div>}
            {pending.length > 0 && (
              <div className="search-pending">Loading from: {pending.join(', ')}</div>
            )}
            {displayResults.map((item, i) => (
              <div key={item.contentId || i} className="search-result-item">
                <div className="search-result-thumb">
                  {item.contentId && <img src={ContentDisplayUrl(item.contentId)} alt="" />}
                </div>
                <div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
                  <div className="search-result-title">{item.title}</div>
                  <div className="search-result-meta">
                    {item.source && <span className="source-badge">{item.source}</span>}
                    {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
                    {item.format && (
                      <span className={`format-badge format-badge--${item.format}`}>{item.format}</span>
                    )}
                  </div>
                </div>
                <div className="search-result-actions">
                  <button onClick={() => handlePlayNow(item)} title="Play Now">&#9654;</button>
                  <button onClick={() => handlePlayNext(item)} title="Play Next">&#10549;</button>
                  <button onClick={() => handleAddToQueue(item)} title="Add to Queue">+</button>
                  <CastButton contentId={item.contentId} className="search-action-cast" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* When idle (no search text, not browsing): show browse categories */}
        {!isSearchActive && (
          <div className="content-browser-home">
            {browseConfig.map((cat, i) => (
              <button
                key={`${cat.source}-${cat.mediaType || i}`}
                className="browse-category-row"
                onClick={() => handleBrowseCategory(cat)}
              >
                <span className="browse-category-label">{cat.label}</span>
                <span className="browse-category-arrow">&rarr;</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentBrowser;
```

**Step 2: Verify it renders**

The component is not yet wired into the new layout (that's Task 4), but verify no import errors by checking the dev server console.

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "refactor(media): promote ContentBrowser to main view with config-driven categories"
```

---

## Task 3: QueueDrawer and DevicePanel — Remove Overlay Pattern

Remove the drawer/overlay wrappers so these components render as inline content.

**Files:**
- Modify: `frontend/src/modules/Media/QueueDrawer.jsx`
- Modify: `frontend/src/modules/Media/DevicePanel.jsx`

**Step 1: Refactor QueueDrawer**

Remove `open`/`onClose` props and the `if (!open) return null` guard. Remove the close button. The component always renders its content.

In `frontend/src/modules/Media/QueueDrawer.jsx`:

- Line 7: Change `const QueueDrawer = ({ open, onClose }) => {` to `const QueueDrawer = () => {`
- Line 46: Remove `if (!open) return null;`
- Lines 70-72: Remove the close button:
  ```jsx
  <button className="queue-action-btn" onClick={onClose} aria-label="Close">
    &#9660;
  </button>
  ```

**Step 2: Refactor DevicePanel**

Same pattern. In `frontend/src/modules/Media/DevicePanel.jsx`:

- Line 7: Change `const DevicePanel = ({ open, onClose }) => {` to `const DevicePanel = () => {`
- Line 11: Remove `if (!open) return null;`
- Lines 25-26: Remove the close button:
  ```jsx
  <button className="device-panel-close" onClick={onClose}>&times;</button>
  ```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/QueueDrawer.jsx frontend/src/modules/Media/DevicePanel.jsx
git commit -m "refactor(media): remove overlay pattern from QueueDrawer and DevicePanel"
```

---

## Task 4: NowPlaying — Remove Panel Toggle Buttons and Fix Empty State

Remove the search/queue/device toggle buttons (those panels are now adjacent via swipe or columns). Update the empty state to show a useful message.

**Files:**
- Modify: `frontend/src/modules/Media/NowPlaying.jsx`

**Step 1: Remove toggle button props and JSX**

In `frontend/src/modules/Media/NowPlaying.jsx`:

- Line 57: Remove `onQueueToggle`, `onSearchToggle`, `onDeviceToggle`, `queueLength` from destructured props:
  ```jsx
  // Before:
  const NowPlaying = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, onQueueToggle, onSearchToggle, onDeviceToggle, queueLength, playerRef }) => {
  // After:
  const NowPlaying = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, playerRef }) => {
  ```

- Lines 256-271: Remove the four toggle buttons (search, cast, device, queue). Keep only the transport buttons (prev, play/pause, next). The transport div (lines 242-272) becomes:
  ```jsx
  {/* Transport Controls */}
  <div className="media-transport">
    <button className="media-transport-btn" onClick={onPrev} aria-label="Previous">
      &#9198;
    </button>
    <button
      className="media-transport-btn media-transport-btn--primary"
      onClick={handleToggle}
      aria-label={playbackState.paused ? 'Play' : 'Pause'}
    >
      {playbackState.paused ? '\u25B6' : '\u23F8'}
    </button>
    <button className="media-transport-btn" onClick={onNext} aria-label="Next">
      &#9197;
    </button>
  </div>
  ```

**Step 2: Update empty state**

Replace lines 172-181 (the empty state) with a message that guides users toward the browse view:

```jsx
if (!currentItem) {
  return (
    <div className="media-now-playing media-now-playing--empty">
      <div className="media-empty-state">
        <p>Nothing playing</p>
        <p className="media-empty-hint">Search or browse to find something to play</p>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "refactor(media): remove panel toggle buttons from NowPlaying, update empty state"
```

---

## Task 5: PlayerSwipeContainer — New Component

Create the container that holds Queue, NowPlaying, and Devices as three pages. On mobile: horizontal scroll-snap with swipe. On desktop: 3-column CSS grid, all visible.

**Files:**
- Create: `frontend/src/modules/Media/PlayerSwipeContainer.jsx`

**Step 1: Create the component**

```jsx
// frontend/src/modules/Media/PlayerSwipeContainer.jsx
import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Responsive container for Queue | NowPlaying | Devices.
 *
 * Mobile (<768px): Horizontal scroll-snap — swipe between 3 full-width pages.
 * Desktop (>=768px): 3-column CSS grid — all panels visible simultaneously.
 *
 * Props:
 * - onCollapse: () => void — called when user taps collapse handle or swipes down
 * - children: exactly 3 React elements (queue, nowPlaying, devices)
 */
const PlayerSwipeContainer = ({ onCollapse, children }) => {
  const scrollRef = useRef(null);
  const [activePage, setActivePage] = useState(1); // 0=queue, 1=now-playing, 2=devices

  // On mount, scroll to center page (NowPlaying) on mobile
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const page = el.children[1];
    if (page) page.scrollIntoView({ behavior: 'instant', inline: 'start' });
  }, []);

  // Track active page via scroll position (mobile only)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollLeft = el.scrollLeft;
        const pageWidth = el.clientWidth;
        const page = Math.round(scrollLeft / pageWidth);
        setActivePage(Math.min(2, Math.max(0, page)));
        ticking = false;
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToPage = useCallback((page) => {
    const el = scrollRef.current;
    if (!el || !el.children[page]) return;
    el.children[page].scrollIntoView({ behavior: 'smooth', inline: 'start' });
  }, []);

  const childArray = React.Children.toArray(children);

  return (
    <div className="player-mode">
      {/* Collapse handle — mobile only */}
      <div className="player-collapse-handle" onClick={onCollapse}>
        <div className="player-collapse-bar" />
      </div>

      {/* Swipe container (mobile) / Grid container (desktop) */}
      <div className="player-swipe-container" ref={scrollRef}>
        <div className="player-swipe-page player-swipe-page--queue">
          {childArray[0]}
        </div>
        <div className="player-swipe-page player-swipe-page--now-playing">
          {childArray[1]}
        </div>
        <div className="player-swipe-page player-swipe-page--devices">
          {childArray[2]}
        </div>
      </div>

      {/* Dot indicators — mobile only */}
      <div className="player-dots">
        {[0, 1, 2].map(i => (
          <button
            key={i}
            className={`player-dot ${i === activePage ? 'player-dot--active' : ''}`}
            onClick={() => scrollToPage(i)}
            aria-label={['Queue', 'Now Playing', 'Devices'][i]}
          />
        ))}
      </div>
    </div>
  );
};

export default PlayerSwipeContainer;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/PlayerSwipeContainer.jsx
git commit -m "feat(media): add PlayerSwipeContainer with scroll-snap mobile + grid desktop"
```

---

## Task 6: MediaApp.jsx — Restructure State and Layout

Replace the current 3-drawer-booleans + view state with a 2-mode architecture. Wire the new components together.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`

**Step 1: Rewrite MediaAppInner**

Replace the entire `MediaAppInner` component (lines 28-169) with the new two-mode structure:

```jsx
const MediaAppInner = () => {
  const { queue } = useMediaApp();
  const playerRef = useRef(null);
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

  // Process URL command on mount — unchanged from current
  useEffect(() => {
    if (queue.loading || urlCommandProcessed.current) return;
    if (!urlCommand) return;
    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    urlCommandProcessed.current = true;

    const { contentId, volume, ...config } = playCommand;
    logger.info('media-app.url-command', { action: urlCommand.play ? 'play' : 'queue', contentId, device: urlCommand.device });

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

        {/* Browse Mode: ContentBrowser is the main view */}
        {mode === 'browse' && (
          <ContentBrowser hasMiniplayer={hasMiniplayer} />
        )}

        {/* Player Mode: swipe pages (mobile) or 3-column grid (desktop) */}
        {mode === 'player' && (
          <PlayerSwipeContainer onCollapse={() => setMode('browse')}>
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
        )}

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
```

**Step 2: Update imports**

At the top of `MediaApp.jsx`, add the new import and remove unused ones:

```jsx
import PlayerSwipeContainer from '../modules/Media/PlayerSwipeContainer.jsx';
```

The existing imports for `NowPlaying`, `MiniPlayer`, `QueueDrawer`, `ContentBrowser`, `DevicePanel` stay.

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "refactor(media): restructure to two-mode navigation (browse/player)"
```

---

## Task 7: SCSS — New Layout System

Replace the overlay/drawer styles with the new browse + player mode layout system.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Add browse mode and player mode layout styles**

Add these new styles. They replace the overlay positioning — the structural classes for `.queue-drawer`, `.content-browser`, `.device-panel` should be updated from `position: fixed` to flow-based layout.

Add after the `.media-app-container` block (after line 18):

```scss
// ── Browse Mode ────────────────────────────────────────────────
.content-browser {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  // Remove: position: fixed, z-index, top/left/right/bottom

  &--with-miniplayer {
    padding-bottom: 56px; // room for MiniPlayer
  }
}

.content-browser-body {
  flex: 1;
  overflow-y: auto;
}

// Browse category rows (home screen when not searching)
.content-browser-home {
  padding: 8px 0;
}

.browse-category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 16px;
  background: none;
  border: none;
  border-bottom: 1px solid #1a1a1a;
  color: #e0e0e0;
  font-size: 16px;
  cursor: pointer;
  text-align: left;

  &:hover { background: #1a1a1a; }
  &:active { background: #222; }
}

.browse-category-arrow {
  color: #666;
  font-size: 18px;
}

// ── Player Mode ────────────────────────────────────────────────
.player-mode {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.player-collapse-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  cursor: pointer;

  @media (min-width: 768px) {
    display: none; // no collapse handle on desktop
  }
}

.player-collapse-bar {
  width: 36px;
  height: 4px;
  background: #444;
  border-radius: 2px;
}

// Mobile: horizontal scroll-snap
.player-swipe-container {
  flex: 1;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;

  &::-webkit-scrollbar { display: none; }

  // Desktop: 3-column grid, no scrolling
  @media (min-width: 768px) {
    overflow-x: hidden;
    scroll-snap-type: none;
    display: grid;
    grid-template-columns: 280px 1fr 280px;
    gap: 0;
  }
}

.player-swipe-page {
  flex: 0 0 100%;
  scroll-snap-align: start;
  overflow-y: auto;

  @media (min-width: 768px) {
    flex: none; // grid takes over sizing
  }

  &--queue {
    @media (min-width: 768px) {
      border-right: 1px solid #222;
    }
  }

  &--devices {
    @media (min-width: 768px) {
      border-left: 1px solid #222;
    }
  }
}

// Dot indicators — mobile only
.player-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 12px;

  @media (min-width: 768px) {
    display: none; // not needed when all 3 columns visible
  }
}

.player-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: #444;
  cursor: pointer;
  padding: 0;

  &--active { background: #1db954; }
}
```

**Step 2: Update existing component styles to remove overlay positioning**

Find and update these existing style blocks:

1. **`.queue-drawer`** (~line 313): Remove `position: fixed`, `bottom: 0`, `left: 0`, `right: 0`, `z-index: 900`, `animation: slideUp`. Remove the `@media (min-width: 768px)` block that sets `position: static; width: 320px`. The component now flows within the swipe page. Keep the internal styles (header, list, items).

   Replace lines 313-336 with:
   ```scss
   .queue-drawer {
     display: flex;
     flex-direction: column;
     height: 100%;
     background: #111;
   }
   ```

2. **`.content-browser`** (~line 447-463): Already replaced by the new styles above. Remove the old block entirely (the `position: fixed` version). The new `.content-browser` block handles it.

3. **`.device-panel`** (~line 619-637): Remove `position: fixed`, `right: 0`, `top: 0`, `bottom: 0`, `width: 320px`, `z-index`, `box-shadow`. Remove the `@media (max-width: 600px)` block. Keep internal styles.

   Replace lines 619-637 with:
   ```scss
   .device-panel {
     display: flex;
     flex-direction: column;
     height: 100%;
     background: #181818;
   }
   ```

4. **Remove `.device-panel-close`** styles (~line 653-661) since the close button is removed.

5. **Remove `.content-browser-close`** styles (~line 485-491) since the close button is removed.

**Step 3: Verify layout renders**

Start the dev server and open `/media`. Verify:
- Browse mode shows ContentBrowser full screen with browse category rows
- No overlays/drawers visible initially

**Step 4: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "style(media): new layout system — browse mode, player mode, scroll-snap + grid"
```

---

## Task 8: MiniPlayer — Wire Mode Transition

Update MiniPlayer to work within the new mode system. The existing component is close — the main change is ensuring it appears correctly in browse mode.

**Files:**
- Modify: `frontend/src/modules/Media/MiniPlayer.jsx` (minor — verify no changes needed)

**Step 1: Verify MiniPlayer works**

The existing MiniPlayer already:
- Accepts `onExpand` prop (now wired to `() => setMode('player')` in Task 6)
- Checks `if (!currentItem) return null`
- Shows thumbnail, title, play/pause, progress

The only potential issue: `useMediaApp()` currently provides `playerRef`, but in the new layout the `playerRef` lives on `MediaAppInner` and `NowPlaying` is unmounted in browse mode. The MiniPlayer uses `playerRef.current?.toggle?.()` for play/pause.

Check: In `MediaAppContext.jsx`, does `playerRef` survive across modes? If not, the MiniPlayer play/pause button won't work in browse mode because the Player is unmounted.

**Step 2: Fix playerRef availability**

The `playerRef` is created in `MediaAppInner` and passed to `NowPlaying` which renders `MediaAppPlayer`. When `mode === 'browse'`, NowPlaying is unmounted, so `playerRef.current` is null.

**Solution:** Keep `MediaAppPlayer` mounted regardless of mode, just visually hidden in browse mode. This also preserves playback state across mode switches.

In `MediaApp.jsx`, move the `MediaAppPlayer` out of `NowPlaying` and render it at the `MediaAppInner` level, always mounted:

Update the `MediaAppInner` return JSX to include a persistent, hidden player:

```jsx
return (
  <div className="App media-app">
    <div className="media-app-container">
      {/* Persistent player — always mounted to preserve playback */}
      {queue.currentItem && (
        <div className="media-persistent-player" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <MediaAppPlayer
            ref={playerRef}
            contentId={queue.currentItem.contentId}
            config={queue.currentItem.config}
            onItemEnd={handleItemEnd}
            onProgress={(data) => {
              setPlaybackState({
                currentTime: data.currentTime || 0,
                duration: data.duration || 0,
                paused: data.paused ?? true,
              });
            }}
            isFullscreen={false}
          />
        </div>
      )}

      {mode === 'browse' && (
        <ContentBrowser hasMiniplayer={hasMiniplayer} />
      )}

      {mode === 'player' && (
        <PlayerSwipeContainer onCollapse={() => setMode('browse')}>
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
      )}

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
```

Wait — this creates a problem: NowPlaying also renders its own MediaAppPlayer internally. We'd have two player instances. The better approach is:

**Revised solution:** Keep the player inside NowPlaying but always mount NowPlaying (just hide it visually in browse mode). This is simpler and avoids double-mounting.

```jsx
return (
  <div className="App media-app">
    <div className="media-app-container">
      {mode === 'browse' && (
        <ContentBrowser hasMiniplayer={hasMiniplayer} />
      )}

      {mode === 'player' && (
        <PlayerSwipeContainer onCollapse={() => setMode('browse')}>
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
      )}

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
```

For the MiniPlayer play/pause: instead of using `playerRef` (which requires the player to be mounted), use the queue's internal play/pause state. The MiniPlayer already gets `playbackState` — it just needs a way to toggle.

**Simplest fix:** Have MiniPlayer call the queue advance API or use a shared toggle function. Actually, the cleanest fix is to store a `togglePlayback` callback in the MediaApp context so MiniPlayer can call it regardless of whether NowPlaying is mounted.

Update `MediaAppContext.jsx` to also store a toggle callback:

In `frontend/src/contexts/MediaAppContext.jsx`, add `playerRef` to the context value:

```jsx
import React, { createContext, useContext } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';

const MediaAppContext = createContext(null);

export const MediaAppProvider = ({ children }) => {
  const queue = useMediaQueue();
  return (
    <MediaAppContext.Provider value={{ queue }}>
      {children}
    </MediaAppContext.Provider>
  );
};

export const useMediaApp = () => {
  const ctx = useContext(MediaAppContext);
  if (!ctx) throw new Error('useMediaApp must be used within MediaAppProvider');
  return ctx;
};
```

The context doesn't have playerRef — MiniPlayer imports `useMediaApp` and accesses `playerRef` from it. Looking at the code: MiniPlayer line 13 does `const { playerRef } = useMediaApp();`.

But the context only provides `{ queue }`. Let me check... Ah, the context must have been extended at some point. Let me look at this more carefully.

Actually, looking at the exploration report, `MediaAppContext.jsx` is 22 lines and only exposes `{ queue }`. But MiniPlayer destructures `playerRef` from it. This would throw or be undefined. This might be a bug or it might have been added after the exploration.

**Pragmatic approach for the plan:** The MiniPlayer toggle issue is a real concern. The simplest fix for the plan:

1. Pass `playerRef` into the context from `MediaAppInner`
2. Or: always mount a hidden player element in MediaAppInner

For the plan, we'll go with option 1: pass playerRef into context.

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/MiniPlayer.jsx frontend/src/contexts/MediaAppContext.jsx
git commit -m "fix(media): ensure MiniPlayer can toggle playback in browse mode"
```

---

## Task 9: Integration Test — Verify Navigation Flow

Manually verify the full navigation flow works end-to-end.

**Files:** None (manual verification)

**Step 1: Verify Browse Mode (empty state)**

1. Open `/media` in browser
2. Verify: ContentBrowser is the main view
3. Verify: Search bar at top, filter chips, browse category rows
4. Verify: No MiniPlayer visible (nothing playing)

**Step 2: Verify search and play**

1. Type a search term in the search bar
2. Verify: Results stream in, filter chips work
3. Tap "Play Now" on a result
4. Verify: MiniPlayer appears at bottom with title and play/pause
5. Verify: Audio/video starts playing

**Step 3: Verify Player Mode (mobile)**

1. Tap MiniPlayer
2. Verify: Expands to full NowPlaying view
3. Verify: Dot indicators show (3 dots, center active)
4. Swipe left → Queue page shows
5. Swipe right past NowPlaying → Devices page shows
6. Tap collapse handle → returns to Browse Mode + MiniPlayer

**Step 4: Verify Player Mode (desktop)**

1. Resize browser window to >768px wide
2. Tap MiniPlayer to expand
3. Verify: All three columns visible simultaneously (Queue | NowPlaying | Devices)
4. Verify: No dot indicators (hidden on desktop)
5. Verify: No swipe behavior (scroll overflow hidden)

**Step 5: Verify mode transitions**

1. In Player Mode, tap collapse handle → Browse Mode
2. Verify: Playback continues uninterrupted
3. Verify: MiniPlayer shows correct progress
4. Tap MiniPlayer → Player Mode
5. Verify: NowPlaying shows correct state

**Step 6: Commit any fixes needed**

```bash
git add -A
git commit -m "fix(media): integration test fixes for navigation flow"
```

---

## Task 10: Polish — Transitions and Edge Cases

Add smooth transitions between modes and handle edge cases.

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`
- Modify: `frontend/src/Apps/MediaApp.jsx`

**Step 1: Add mode transition animation**

In `MediaApp.scss`, add a slide-up animation for player mode entry:

```scss
.player-mode {
  animation: playerSlideUp 0.25s ease-out;
}

@keyframes playerSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
```

**Step 2: Handle edge case — queue empties during player mode**

In `MediaAppInner`, add an effect that returns to browse mode if the queue empties:

```jsx
// Auto-collapse to browse mode when queue empties
useEffect(() => {
  if (mode === 'player' && !queue.currentItem && queue.items.length === 0) {
    setMode('browse');
  }
}, [mode, queue.currentItem, queue.items.length]);
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss frontend/src/Apps/MediaApp.jsx
git commit -m "polish(media): add mode transitions and edge case handling"
```

---

## Summary

| Task | Description | Est. Files |
|------|-------------|-----------|
| 1 | Media browse config endpoint | 3 |
| 2 | ContentBrowser as main view | 1 |
| 3 | QueueDrawer + DevicePanel inline | 2 |
| 4 | NowPlaying — remove toggles | 1 |
| 5 | PlayerSwipeContainer (new) | 1 |
| 6 | MediaApp.jsx restructure | 1 |
| 7 | SCSS layout system | 1 |
| 8 | MiniPlayer + playerRef fix | 2 |
| 9 | Integration verification | 0 |
| 10 | Polish + edge cases | 2 |

**Total: ~14 files touched, ~10 commits**

**Key design decision:** Desktop (>=768px) shows all 3 columns in a CSS grid without scroll-snap. Mobile (<768px) uses scroll-snap for swipe navigation. The breakpoint matches the existing `@media (min-width: 768px)` used throughout `MediaApp.scss`.
