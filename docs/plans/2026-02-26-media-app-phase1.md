# MediaApp Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** MediaApp route exists at `/media`, plays content locally via URL parameters with basic transport controls and a MiniPlayer bar.

**Architecture:** Mobile-first React app at `/media` route. Thin `MediaAppPlayer` wrapper around existing `Player.jsx` in single-play mode (`play=` prop, never `queue=`). URL parameters parsed via a shared utility extracted from TVApp. No backend queue infrastructure yet (Phase 2).

**Tech Stack:** React 18, React Router v6, SCSS modules, existing Player.jsx, existing Play API / Display API.

**Requirements covered:** 0.1.3, 0.9.1, 0.9.2, 1.1.1–1.1.9, 1.2.1–1.2.7

**Reference docs:**
- Requirements registry: `docs/roadmap/2026-02-26-media-app-requirements.md`
- Architecture narrative: `docs/roadmap/2026-02-26-media-app-design.md`
- Backend architecture: `docs/reference/core/backend-architecture.md`
- Coding standards: `docs/reference/core/coding-standards.md`

---

## Task 1: Extract `parseAutoplayParams` — Tests

**Req:** 0.9.1
**Files:**
- Create: `tests/isolated/assembly/player/parseAutoplayParams.test.mjs`

**Step 1: Write the test file**

This tests the shared URL parser that will be extracted from TVApp. The function signature is `parseAutoplayParams(searchString, supportedActions)` → `{ action, contentId, config }` or `null`.

```js
import { describe, test, expect } from '@jest/globals';
import { parseAutoplayParams } from '#frontend/src/lib/parseAutoplayParams.js';

describe('parseAutoplayParams', () => {
  const ALL_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];
  const MEDIA_ACTIONS = ['play', 'queue'];

  describe('basic action parsing', () => {
    test('parses ?play=hymn:198', () => {
      const result = parseAutoplayParams('?play=hymn:198', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('parses ?queue=plex:67890', () => {
      const result = parseAutoplayParams('?queue=plex:67890', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.queue).toBeDefined();
      expect(result.queue.contentId).toBe('plex:67890');
    });

    test('returns null when no action params present', () => {
      const result = parseAutoplayParams('?volume=50', ALL_ACTIONS);
      expect(result).toBeNull();
    });

    test('returns null for empty search string', () => {
      const result = parseAutoplayParams('', ALL_ACTIONS);
      expect(result).toBeNull();
    });
  });

  describe('contentId normalization', () => {
    test('bare digits become plex: prefix', () => {
      const result = parseAutoplayParams('?play=12345', ALL_ACTIONS);
      expect(result.play.contentId).toBe('plex:12345');
    });

    test('compound IDs pass through unchanged', () => {
      const result = parseAutoplayParams('?play=hymn:198', ALL_ACTIONS);
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('case-insensitive source prefix', () => {
      const result = parseAutoplayParams('?play=PLEX:123', ALL_ACTIONS);
      expect(result.play.contentId).toBe('PLEX:123');
    });
  });

  describe('alias shorthand', () => {
    test('?hymn=198 becomes play hymn:198', () => {
      const result = parseAutoplayParams('?hymn=198', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('?scripture=bom becomes play scripture:bom', () => {
      const result = parseAutoplayParams('?scripture=bom', ALL_ACTIONS);
      expect(result.play.contentId).toBe('scripture:bom');
    });

    test('?plex=12345 becomes play plex:12345', () => {
      const result = parseAutoplayParams('?plex=12345', ALL_ACTIONS);
      expect(result.play.contentId).toBe('plex:12345');
    });
  });

  describe('config modifiers', () => {
    test('extracts volume from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&volume=50', ALL_ACTIONS);
      expect(result.play.volume).toBe('50');
    });

    test('extracts shader from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&shader=focused', ALL_ACTIONS);
      expect(result.play.shader).toBe('focused');
    });

    test('extracts shuffle from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&shuffle=true', ALL_ACTIONS);
      expect(result.play.shuffle).toBe('true');
    });

    test('extracts playbackRate from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&playbackRate=1.5', ALL_ACTIONS);
      expect(result.play.playbackRate).toBe('1.5');
    });
  });

  describe('supportedActions filtering', () => {
    test('ignores unsupported actions', () => {
      const result = parseAutoplayParams('?display=photo:1', MEDIA_ACTIONS);
      // display is not in MEDIA_ACTIONS, so it should fall through to alias
      // ?display=photo:1 → alias rule → play display:photo:1
      // This tests that display is NOT treated as the display action
      expect(result).not.toBeNull();
      if (result.display) {
        throw new Error('display action should not be recognized with MEDIA_ACTIONS');
      }
    });

    test('supports play action when in supportedActions', () => {
      const result = parseAutoplayParams('?play=hymn:198', MEDIA_ACTIONS);
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('supports queue action when in supportedActions', () => {
      const result = parseAutoplayParams('?queue=plex:67890', MEDIA_ACTIONS);
      expect(result.queue).toBeDefined();
    });
  });

  describe('TVApp-specific actions', () => {
    test('parses ?display=photo:1 with ALL_ACTIONS', () => {
      const result = parseAutoplayParams('?display=photo:1', ALL_ACTIONS);
      expect(result.display).toBeDefined();
    });

    test('parses ?open=webcam with ALL_ACTIONS', () => {
      const result = parseAutoplayParams('?open=webcam', ALL_ACTIONS);
      expect(result.open).toBeDefined();
      expect(result.open.app).toBe('webcam');
    });

    test('parses ?app=webcam as alias for open', () => {
      const result = parseAutoplayParams('?app=webcam', ALL_ACTIONS);
      expect(result.open).toBeDefined();
      expect(result.open.app).toBe('webcam');
    });
  });

  describe('composite mode', () => {
    test('comma-separated play triggers compose', () => {
      const result = parseAutoplayParams('?play=plex:1,plex:2', ALL_ACTIONS);
      expect(result.compose).toBeDefined();
      expect(result.compose.sources).toEqual(['plex:1', 'plex:2']);
    });

    test('app: prefix triggers compose', () => {
      const result = parseAutoplayParams('?play=app:webcam', ALL_ACTIONS);
      expect(result.compose).toBeDefined();
    });
  });

  describe('edge cases', () => {
    test('first action key wins when multiple present', () => {
      const result = parseAutoplayParams('?play=hymn:1&queue=plex:2', ALL_ACTIONS);
      // Should parse the first matching action
      expect(result).not.toBeNull();
    });

    test('config-only params without action return null', () => {
      const result = parseAutoplayParams('?volume=50&shader=dark', ALL_ACTIONS);
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/assembly/player/parseAutoplayParams.test.mjs --verbose`
Expected: FAIL — module not found (`#frontend/src/lib/parseAutoplayParams.js`)

**Step 3: Commit test file**

```bash
git add tests/isolated/assembly/player/parseAutoplayParams.test.mjs
git commit -m "test(media): 0.9.1 add parseAutoplayParams unit tests"
```

---

## Task 2: Extract `parseAutoplayParams` — Implementation

**Req:** 0.9.1
**Files:**
- Create: `frontend/src/lib/parseAutoplayParams.js`
- Modify: `jest.config.js` (add `#frontend/*` module alias if not present)

**Step 1: Check if `#frontend/*` alias exists in jest.config.js**

Read `jest.config.js` and look at `moduleNameMapper`. If there's no `#frontend/(.*)` entry, add one mapping to `<rootDir>/frontend/$1`.

**Step 2: Create the shared parser**

Extract the URL parsing logic from `TVApp.jsx` lines 96-192 into a standalone function. The key changes from the TVApp code:
- Accept `supportedActions` parameter to filter which action keys are recognized
- Accept `searchString` parameter instead of reading `window.location.search`
- Return the same shape TVApp currently produces

```js
// frontend/src/lib/parseAutoplayParams.js

/**
 * Parse URL search params into an autoplay command.
 *
 * Extracted from TVApp.jsx for reuse by MediaApp and other apps.
 * Each app passes its own supported actions list.
 *
 * @param {string} searchString - URL search string (e.g., '?play=hymn:198&volume=50')
 * @param {string[]} supportedActions - Action keys this app handles (e.g., ['play', 'queue'])
 * @returns {object|null} Parsed command object or null if no action found
 */

const CONFIG_KEYS = [
  'volume', 'shader', 'playbackRate', 'shuffle', 'continuous',
  'repeat', 'loop', 'overlay', 'advance', 'interval', 'mode', 'frame'
];

function toContentId(value) {
  if (/^[a-z]+:.+$/i.test(value)) return value;
  if (/^\d+$/.test(value)) return `plex:${value}`;
  return value;
}

// All known action mappings. Each returns the command shape for that action.
const ACTION_MAPPINGS = {
  playlist: (value, config) => ({ queue: { contentId: toContentId(value), ...config } }),
  queue: (value, config) => {
    if (value.includes(',')) return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
    if (value.startsWith('app:')) return { compose: { sources: [value], ...config } };
    return { queue: { contentId: toContentId(value), ...config } };
  },
  play: (value, config) => {
    if (value.includes(',')) return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
    if (value.startsWith('app:')) return { compose: { sources: [value], ...config } };
    return { play: { contentId: toContentId(value), ...config } };
  },
  random: (value, config) => ({ play: { contentId: toContentId(value), random: true, ...config } }),
  display: (value, config) => ({ display: { id: value, ...config } }),
  read: (value, config) => ({ read: { id: value, ...config } }),
  open: (value) => ({ open: { app: value } }),
  app: (value) => ({ open: { app: value } }),
  launch: (value) => ({ launch: { contentId: toContentId(value) } }),
  list: (value, config) => ({ list: { contentId: toContentId(value), ...config } }),
};

export function parseAutoplayParams(searchString, supportedActions) {
  if (!searchString || !supportedActions?.length) return null;

  const params = new URLSearchParams(searchString);
  const queryEntries = Object.fromEntries(params.entries());
  if (Object.keys(queryEntries).length === 0) return null;

  // Extract config modifiers
  const config = {};
  for (const configKey of CONFIG_KEYS) {
    if (queryEntries[configKey] != null) {
      if (configKey === 'overlay') {
        config.overlay = {
          queue: { contentId: toContentId(queryEntries[configKey]) },
          shuffle: true
        };
      } else {
        config[configKey] = queryEntries[configKey];
      }
    }
  }

  // Parse advance as structured object
  if (queryEntries.advance) {
    config.advance = {
      mode: queryEntries.advance,
      interval: parseInt(queryEntries.interval) || 5000
    };
  }

  // Parse track modifiers (e.g., ?loop.audio=0&shuffle.visual=1)
  const trackModifiers = { visual: {}, audio: {} };
  for (const [key, value] of Object.entries(queryEntries)) {
    const match = key.match(/^(\w+)\.(visual|audio)$/);
    if (match) {
      const [, modifier, track] = match;
      trackModifiers[track][modifier] = value;
    }
  }
  if (Object.keys(trackModifiers.visual).length || Object.keys(trackModifiers.audio).length) {
    config.trackModifiers = trackModifiers;
  }

  // Match first supported action key
  for (const [key, value] of Object.entries(queryEntries)) {
    if (supportedActions.includes(key) && ACTION_MAPPINGS[key]) {
      return ACTION_MAPPINGS[key](value, config);
    }
  }

  // Alias fallback: unknown key → play key:value
  for (const [key, value] of Object.entries(queryEntries)) {
    if (!CONFIG_KEYS.includes(key) && !key.includes('.')) {
      return { play: { contentId: `${key}:${value}`, ...config } };
    }
  }

  return null;
}

export default parseAutoplayParams;
```

**Step 3: Add jest module alias if needed**

Read `jest.config.js`. If `#frontend/(.*)` is not in `moduleNameMapper`, add:
```js
'^#frontend/(.*)$': '<rootDir>/frontend/$1',
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/player/parseAutoplayParams.test.mjs --verbose`
Expected: All tests PASS. If any fail, adjust implementation to match TVApp's actual behavior.

**Step 5: Commit**

```bash
git add frontend/src/lib/parseAutoplayParams.js jest.config.js
git commit -m "feat(media): 0.9.1 extract parseAutoplayParams from TVApp into shared utility"
```

---

## Task 3: Refactor TVApp to Use Shared Parser

**Req:** 0.9.2
**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx` (lines ~96-192)

**Step 1: Read TVApp.jsx to understand the current autoplay useMemo**

Read `frontend/src/Apps/TVApp.jsx`. The `autoplay` variable is computed in a `useMemo` around lines 96-192. It reads `window.location.search` and produces the same shape that `parseAutoplayParams` now produces.

**Step 2: Replace the inline parsing with the shared utility**

Add import at the top of TVApp.jsx:
```js
import { parseAutoplayParams } from '../lib/parseAutoplayParams.js';
```

Replace the entire `useMemo` block (lines ~96-192) with:
```js
const TV_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];
const autoplay = useMemo(() => parseAutoplayParams(window.location.search, TV_ACTIONS), []);
```

**Step 3: Verify no behavior change**

Run: `npx jest tests/isolated/assembly/player/parseAutoplayParams.test.mjs --verbose`
Expected: All tests still pass.

If there are existing TVApp-specific tests, run those too:
```bash
npx jest --testPathPattern=TVApp --verbose
npx jest tests/isolated/assembly/player/ --verbose
```

**Step 4: Manual smoke test** (if dev server is available)

Open `/tv?play=hymn:198` and `/tv?hymn=198` — verify they still work. Open `/tv` with no params — verify normal behavior.

**Step 5: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "refactor(tv): 0.9.2 use shared parseAutoplayParams utility (no behavior change)"
```

---

## Task 4: MediaApp Route Shell

**Req:** 0.1.3, 1.2.1
**Files:**
- Modify: `frontend/src/main.jsx` (add route)
- Modify: `frontend/src/Apps/MediaApp.jsx` (implement shell)
- Create: `frontend/src/Apps/MediaApp.scss`

**Step 1: Read current files**

Read `frontend/src/main.jsx` to see route registration pattern.
Read `frontend/src/Apps/MediaApp.jsx` to see current state (likely empty).

**Step 2: Implement MediaApp shell**

```jsx
// frontend/src/Apps/MediaApp.jsx
import React, { useMemo, useEffect } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import './MediaApp.scss';

const MediaApp = () => {
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);

  useEffect(() => {
    configureLogger({ context: { app: 'media' } });
    logger.info('media-app.mounted');
    return () => {
      configureLogger({ context: {} });
      logger.info('media-app.unmounted');
    };
  }, [logger]);

  return (
    <div className="App media-app">
      <div className="media-app-container">
        <div className="media-now-playing">
          <h2>MediaApp</h2>
          <p>Phase 1 — Player coming soon</p>
        </div>
      </div>
    </div>
  );
};

export default MediaApp;
```

**Step 3: Create minimal SCSS**

```scss
// frontend/src/Apps/MediaApp.scss
.media-app {
  width: 100%;
  height: 100vh;
  background: #0a0a0a;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.media-app-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
```

**Step 4: Register route in main.jsx**

Add import at top:
```js
import MediaApp from './Apps/MediaApp.jsx';
```

Add route (inside `<Routes>`, near the TV route):
```jsx
<Route path="/media" element={<MediaApp />} />
```

**Step 5: Verify route works**

If dev server is running, navigate to `http://localhost:{port}/media` — should see the shell.

**Step 6: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx frontend/src/Apps/MediaApp.scss frontend/src/main.jsx
git commit -m "feat(media): 0.1.3, 1.2.1 register /media route with app shell"
```

---

## Task 5: `useMediaUrlParams` Hook

**Req:** 1.2.6
**Files:**
- Create: `frontend/src/hooks/media/useMediaUrlParams.js`
- Create: `tests/unit/hooks/useMediaUrlParams.test.jsx` (optional — hook is thin)

**Step 1: Create the hook**

This hook parses URL params on mount and returns the parsed command for MediaApp to act on.

```js
// frontend/src/hooks/media/useMediaUrlParams.js
import { useMemo } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';

const MEDIA_ACTIONS = ['play', 'queue'];

/**
 * Parse URL params for MediaApp autoplay commands.
 * Supports: ?play=contentId, ?queue=contentId, and alias shorthand (?hymn=198).
 * Config modifiers: ?volume=, ?shuffle=, ?shader=
 */
export function useMediaUrlParams() {
  const command = useMemo(
    () => parseAutoplayParams(window.location.search, MEDIA_ACTIONS),
    []
  );

  return command;
}

export default useMediaUrlParams;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/media/useMediaUrlParams.js
git commit -m "feat(media): 1.2.6 add useMediaUrlParams hook for URL-driven playback"
```

---

## Task 6: MediaAppPlayer Wrapper

**Req:** 1.2.3, 8.2.1, 8.2.2
**Files:**
- Create: `frontend/src/modules/Media/MediaAppPlayer.jsx`

**Context:** Read `frontend/src/modules/Player/Player.jsx` for the Player API. Key points:
- Single-play mode: `<Player play={playObject} clear={onEnd} ref={playerRef} />`
- `play` must be memoized (new object = remount)
- `playerRef` exposes: `seek()`, `toggle()`, `play()`, `pause()`, `getCurrentTime()`, `getDuration()`
- `clear` is called when the item ends naturally
- `playerType` is a CSS class hint

**Step 1: Read Player.jsx to confirm API**

Read `frontend/src/modules/Player/Player.jsx` — verify `play`, `clear`, `ref`, `onProgress`, `playerType` props.

**Step 2: Implement MediaAppPlayer**

```jsx
// frontend/src/modules/Media/MediaAppPlayer.jsx
import React, { useState, useCallback, useMemo, forwardRef } from 'react';
import Player from '../Player/Player.jsx';

/**
 * Thin wrapper around Player.jsx for MediaApp.
 * - Single-play mode only (play= prop, never queue=)
 * - Manages embedded vs fullscreen CSS state
 * - Forwards playerRef for external transport controls
 *
 * Req: 1.2.3, 8.2.1, 8.2.2
 */
const MediaAppPlayer = forwardRef(function MediaAppPlayer(
  { contentId, format, onItemEnd, onProgress, config },
  ref
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Memoize play object to avoid Player remount on every render
  const playObject = useMemo(() => {
    if (!contentId) return null;
    return { contentId, ...config };
  }, [contentId, config]);

  // Format-aware auto-fullscreen
  const handleProgress = useCallback((progressData) => {
    // Auto-fullscreen for video on first progress event
    if (format === 'video' && !isFullscreen && progressData.currentTime === 0) {
      setIsFullscreen(true);
    }
    onProgress?.(progressData);
  }, [format, isFullscreen, onProgress]);

  const handleClear = useCallback(() => {
    setIsFullscreen(false);
    onItemEnd?.();
  }, [onItemEnd]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  if (!playObject) return null;

  return (
    <div
      className={`media-player-wrapper${isFullscreen ? ' fullscreen' : ''}`}
      onClick={isFullscreen ? undefined : undefined}
    >
      <Player
        ref={ref}
        play={playObject}
        clear={handleClear}
        onProgress={handleProgress}
        playerType="media"
      />
      {isFullscreen && (
        <button
          className="media-fullscreen-exit"
          onClick={() => setIsFullscreen(false)}
          aria-label="Exit fullscreen"
        >
          &times;
        </button>
      )}
    </div>
  );
});

export default MediaAppPlayer;
```

**Step 3: Add fullscreen CSS to MediaApp.scss**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
// MediaAppPlayer fullscreen
.media-player-wrapper {
  position: relative;
  width: 100%;

  &.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #000;
  }
}

.media-fullscreen-exit {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1001;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/MediaAppPlayer.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): 1.2.3 create MediaAppPlayer wrapper with fullscreen support"
```

---

## Task 7: NowPlaying View

**Req:** 1.2.4, 1.1.4, 1.1.5, 1.1.6, 1.1.7
**Files:**
- Create: `frontend/src/modules/Media/NowPlaying.jsx`

**Step 1: Implement NowPlaying**

```jsx
// frontend/src/modules/Media/NowPlaying.jsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import MediaAppPlayer from './MediaAppPlayer.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';

/**
 * Main player view: player + track info + progress bar + transport controls + volume.
 *
 * Req: 1.2.4, 1.1.4, 1.1.5, 1.1.6, 1.1.7
 */
const NowPlaying = ({ currentItem, onItemEnd, onNext, onPrev }) => {
  const logger = useMemo(() => getLogger().child({ component: 'NowPlaying' }), []);
  const playerRef = useRef(null);

  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
  });
  const [volume, setVolume] = useState(0.8);

  const handleProgress = useCallback((data) => {
    setPlaybackState({
      currentTime: data.currentTime || 0,
      duration: data.duration || 0,
      paused: data.paused ?? true,
    });
  }, []);

  const handleToggle = useCallback(() => {
    playerRef.current?.toggle?.();
  }, []);

  const handleSeek = useCallback((e) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekTime = percent * playbackState.duration;
    playerRef.current?.seek?.(seekTime);
  }, [playbackState.duration]);

  const handleVolumeChange = useCallback((e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    const el = playerRef.current?.getMediaElement?.();
    if (el) el.volume = newVolume;
  }, []);

  const formatTime = (seconds) => {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!currentItem) {
    return (
      <div className="media-now-playing media-now-playing--empty">
        <div className="media-empty-state">
          <p>Nothing playing</p>
          <p className="media-empty-hint">Use ?play=hymn:198 to start playback</p>
        </div>
      </div>
    );
  }

  const thumbnailUrl = currentItem.contentId
    ? ContentDisplayUrl(currentItem.contentId)
    : null;

  const progress = playbackState.duration > 0
    ? (playbackState.currentTime / playbackState.duration) * 100
    : 0;

  return (
    <div className="media-now-playing">
      {/* Player (may be embedded or fullscreen) */}
      <MediaAppPlayer
        ref={playerRef}
        contentId={currentItem.contentId}
        format={currentItem.format}
        config={currentItem.config}
        onItemEnd={onItemEnd}
        onProgress={handleProgress}
      />

      {/* Track Info */}
      <div className="media-track-info">
        {thumbnailUrl && (
          <div className="media-track-thumbnail">
            <img src={thumbnailUrl} alt="" />
          </div>
        )}
        <div className="media-track-details">
          <div className="media-track-title">{currentItem.title || currentItem.contentId}</div>
          {currentItem.source && (
            <div className="media-track-source">{currentItem.source}</div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="media-progress" onClick={handleSeek}>
        <div className="media-progress-bar">
          <div
            className="media-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="media-progress-times">
          <span>{formatTime(playbackState.currentTime)}</span>
          <span>{formatTime(playbackState.duration)}</span>
        </div>
      </div>

      {/* Transport Controls */}
      <div className="media-transport">
        <button
          className="media-transport-btn"
          onClick={onPrev}
          aria-label="Previous"
        >
          &#9198;
        </button>
        <button
          className="media-transport-btn media-transport-btn--primary"
          onClick={handleToggle}
          aria-label={playbackState.paused ? 'Play' : 'Pause'}
        >
          {playbackState.paused ? '\u25B6' : '\u23F8'}
        </button>
        <button
          className="media-transport-btn"
          onClick={onNext}
          aria-label="Next"
        >
          &#9197;
        </button>
      </div>

      {/* Volume */}
      <div className="media-volume">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
      </div>
    </div>
  );
};

export default NowPlaying;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/NowPlaying.jsx
git commit -m "feat(media): 1.2.4, 1.1.4-1.1.7 create NowPlaying view with transport controls"
```

---

## Task 8: MiniPlayer

**Req:** 1.2.5, 1.1.8
**Files:**
- Create: `frontend/src/modules/Media/MiniPlayer.jsx`

**Step 1: Implement MiniPlayer**

```jsx
// frontend/src/modules/Media/MiniPlayer.jsx
import React, { useCallback } from 'react';
import { ContentDisplayUrl } from '../../lib/api.mjs';

/**
 * Persistent bottom bar when content is playing.
 * Shows thumbnail, title, play/pause, and thin progress indicator.
 * Tap expands to full NowPlaying view.
 *
 * Req: 1.2.5, 1.1.8
 */
const MiniPlayer = ({ currentItem, playbackState, onToggle, onExpand }) => {
  if (!currentItem) return null;

  const thumbnailUrl = currentItem.contentId
    ? ContentDisplayUrl(currentItem.contentId)
    : null;

  const progress = playbackState?.duration > 0
    ? (playbackState.currentTime / playbackState.duration) * 100
    : 0;

  const handleBarClick = useCallback((e) => {
    // Don't expand when clicking play/pause button
    if (e.target.closest('.mini-player-toggle')) return;
    onExpand?.();
  }, [onExpand]);

  return (
    <div className="media-mini-player" onClick={handleBarClick}>
      <div className="mini-player-progress" style={{ width: `${progress}%` }} />
      <div className="mini-player-content">
        {thumbnailUrl && (
          <img className="mini-player-thumb" src={thumbnailUrl} alt="" />
        )}
        <div className="mini-player-title">
          {currentItem.title || currentItem.contentId}
        </div>
        <button
          className="mini-player-toggle"
          onClick={onToggle}
          aria-label={playbackState?.paused ? 'Play' : 'Pause'}
        >
          {playbackState?.paused ? '\u25B6' : '\u23F8'}
        </button>
      </div>
    </div>
  );
};

export default MiniPlayer;
```

**Step 2: Add MiniPlayer CSS to MediaApp.scss**

Append to `frontend/src/Apps/MediaApp.scss`:

```scss
// MiniPlayer
.media-mini-player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: #1a1a1a;
  border-top: 1px solid #333;
  cursor: pointer;
  z-index: 100;
  overflow: hidden;
}

.mini-player-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: #1db954;
  transition: width 0.3s linear;
}

.mini-player-content {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  gap: 12px;
}

.mini-player-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}

.mini-player-title {
  flex: 1;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-toggle {
  background: none;
  border: none;
  color: #fff;
  font-size: 20px;
  padding: 8px;
  cursor: pointer;
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/MiniPlayer.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): 1.2.5, 1.1.8 create MiniPlayer persistent bottom bar"
```

---

## Task 9: MediaApp Assembly — Wire Everything Together

**Req:** 1.2.2, 1.1.1, 1.1.2, 1.1.3, 1.1.9, 1.2.1 (continued)
**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx` (full implementation)

**Step 1: Read the current MediaApp.jsx shell**

Read `frontend/src/Apps/MediaApp.jsx` — currently the shell from Task 4.

**Step 2: Wire NowPlaying, MiniPlayer, and URL params together**

Replace the shell with the full assembled app:

```jsx
// frontend/src/Apps/MediaApp.jsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import { DaylightAPI } from '../lib/api.mjs';
import useMediaUrlParams from '../hooks/media/useMediaUrlParams.js';
import NowPlaying from '../modules/Media/NowPlaying.jsx';
import MiniPlayer from '../modules/Media/MiniPlayer.jsx';
import './MediaApp.scss';

/**
 * MediaApp — media controller and player.
 * Phase 1: URL-driven local playback with basic transport.
 *
 * Req: 1.2.1, 1.2.2, 1.1.1, 1.1.2, 1.1.3, 1.1.9
 */
const MediaApp = () => {
  const logger = useMemo(() => getLogger().child({ app: 'media' }), []);
  const urlCommand = useMediaUrlParams();

  // View state: 'now-playing' or 'mini' (Phase 1 only has these two)
  const [view, setView] = useState('now-playing');

  // Current item being played
  const [currentItem, setCurrentItem] = useState(null);
  const [loading, setLoading] = useState(false);

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
    if (!urlCommand) return;

    const playCommand = urlCommand.play || urlCommand.queue;
    if (!playCommand?.contentId) return;

    logger.info('media-app.url-command', {
      action: urlCommand.play ? 'play' : 'queue',
      contentId: playCommand.contentId,
    });

    // Build current item from URL command
    // The Player component handles content resolution internally via Play API,
    // so we just need the contentId and any config modifiers
    const { contentId, ...config } = playCommand;
    setCurrentItem({
      contentId,
      config: Object.keys(config).length > 0 ? config : undefined,
      title: contentId, // Player will resolve the real title
    });
  }, [urlCommand, logger]);

  // Handle item end (clear callback from Player)
  const handleItemEnd = useCallback(() => {
    logger.info('media-app.item-ended', { contentId: currentItem?.contentId });
    // Phase 1: single play mode, just clear
    setCurrentItem(null);
    setPlaybackState({ currentTime: 0, duration: 0, paused: true });
  }, [currentItem, logger]);

  // Handle progress updates from NowPlaying → shared with MiniPlayer
  const handleProgress = useCallback((data) => {
    setPlaybackState({
      currentTime: data.currentTime || 0,
      duration: data.duration || 0,
      paused: data.paused ?? true,
    });
  }, []);

  // Phase 1: next/prev are no-ops (no queue yet)
  const handleNext = useCallback(() => {
    logger.debug('media-app.next-pressed', { note: 'no queue in Phase 1' });
  }, [logger]);

  const handlePrev = useCallback(() => {
    logger.debug('media-app.prev-pressed', { note: 'no queue in Phase 1' });
  }, [logger]);

  if (loading) {
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
            currentItem={currentItem}
            onItemEnd={handleItemEnd}
            onNext={handleNext}
            onPrev={handlePrev}
          />
        )}

        {/* MiniPlayer shows when viewing other panels (Phase 2+) */}
        {view !== 'now-playing' && currentItem && (
          <MiniPlayer
            currentItem={currentItem}
            playbackState={playbackState}
            onToggle={() => {
              // In Phase 1, we don't have playerRef at this level
              // MiniPlayer toggle will be wired in Phase 2 via context
            }}
            onExpand={() => setView('now-playing')}
          />
        )}
      </div>
    </div>
  );
};

export default MediaApp;
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): 1.2.2, 1.1.1-1.1.3, 1.1.9 wire MediaApp with URL-driven playback"
```

---

## Task 10: SCSS Polish

**Req:** 1.2.7
**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss` (complete styling)

**Step 1: Read current MediaApp.scss**

Read `frontend/src/Apps/MediaApp.scss` — should have the base from Tasks 4, 6, 8.

**Step 2: Add NowPlaying and polish styles**

Replace the full file with the complete Phase 1 stylesheet. Use the `frontend-design` skill for design quality — dark theme, PlexAmp-inspired, mobile-first.

Key styles to add:
- `.media-now-playing` — centered layout, album art sizing
- `.media-now-playing--empty` — empty state styling
- `.media-track-info` — thumbnail + text layout
- `.media-progress` — seekable bar with fill
- `.media-transport` — centered button row
- `.media-volume` — range input styling
- `.media-loading` — spinner/loading state
- Desktop breakpoint (sidebar layout prep for Phase 2)

**Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "style(media): 1.2.7 complete Phase 1 SCSS (mobile-first dark theme)"
```

---

## Task 11: Smoke Test & Verification

**Req:** All Phase 1

**Step 1: Start dev server if not running**

```bash
lsof -i :3111  # Check if already running
# If not: npm run dev
```

**Step 2: Verify routes**

- Navigate to `/media` → should see empty state ("Nothing playing")
- Navigate to `/media?play=hymn:198` → should start playing hymn 198
- Navigate to `/media?hymn=198` → same (alias shorthand)
- Navigate to `/tv?play=hymn:198` → TVApp should still work (regression check)

**Step 3: Verify player controls**

On `/media?play=hymn:198`:
- Play/pause button toggles playback
- Progress bar shows elapsed/remaining time
- Clicking progress bar seeks
- Volume slider works
- When item ends, empty state returns

**Step 4: Run existing tests**

```bash
npx jest tests/isolated/assembly/player/ --verbose
npm run test:isolated
```

**Step 5: Commit any fixes discovered during smoke test**

---

## Dependency Graph

```
Task 1 (tests)
  └── Task 2 (parseAutoplayParams impl)
        ├── Task 3 (TVApp refactor)
        └── Task 5 (useMediaUrlParams)
              └── Task 9 (MediaApp assembly)

Task 4 (route shell) ──────────┐
Task 6 (MediaAppPlayer) ───────┤
Task 7 (NowPlaying) ───────────┤──► Task 9 (assembly)
Task 8 (MiniPlayer) ───────────┘

Task 10 (SCSS polish) ← can run after Task 9
Task 11 (smoke test) ← runs last
```

**Parallelizable:** Tasks 4, 6, 7, 8 can be developed in parallel after Task 2 completes.

---

## Files Created (Summary)

| File | Task |
|------|------|
| `tests/isolated/assembly/player/parseAutoplayParams.test.mjs` | 1 |
| `frontend/src/lib/parseAutoplayParams.js` | 2 |
| `frontend/src/Apps/MediaApp.scss` | 4, 6, 8, 10 |
| `frontend/src/hooks/media/useMediaUrlParams.js` | 5 |
| `frontend/src/modules/Media/MediaAppPlayer.jsx` | 6 |
| `frontend/src/modules/Media/NowPlaying.jsx` | 7 |
| `frontend/src/modules/Media/MiniPlayer.jsx` | 8 |

## Files Modified (Summary)

| File | Task |
|------|------|
| `jest.config.js` (maybe) | 2 |
| `frontend/src/Apps/TVApp.jsx` | 3 |
| `frontend/src/main.jsx` | 4 |
| `frontend/src/Apps/MediaApp.jsx` | 4, 9 |
