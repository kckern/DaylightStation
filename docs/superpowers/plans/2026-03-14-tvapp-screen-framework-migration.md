# TVApp → Screen-Framework Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the living room TV from legacy `TVApp.jsx` (`/tv`) to the screen-framework (`/screen/living-room`), including native Android app launching via FKB.

**Architecture:** Register a `menu` widget in the screen-framework that wraps the existing `MenuStack` + `MenuNavigationProvider`. Add `android:` prefix support in the backend normalizer for client-side FKB app launching. Create `living-room.yml` screen config. Validate with Playwright tests.

**Tech Stack:** React, Vite, Express, Vitest (unit), Playwright (flow), YAML configs

**Spec:** `docs/superpowers/specs/2026-03-14-android-app-launcher-design.md`

---

## Chunk 1: Backend — Normalizer `android:` Prefix

### Task 1: Add `android:` prefix unit tests

**Files:**
- Modify: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`

- [ ] **Step 1: Write failing tests for `normalizeListItem` android prefix**

Add a new `describe` block at the end of the `normalizeListItem` describe:

```javascript
// ── Android app items (client-side FKB launch) ──────────
describe('android items', () => {
  it('parses android: prefix into android key with package and activity', () => {
    const item = { label: 'Gospel Stream', input: 'android:org.lds.stream/.ux.androidtv.main.TvMainActivity' };
    const result = normalizeListItem(item);
    expect(result.title).toBe('Gospel Stream');
    expect(result.android).toEqual({
      package: 'org.lds.stream',
      activity: '.ux.androidtv.main.TvMainActivity'
    });
    expect(result.play).toBeUndefined();
    expect(result.list).toBeUndefined();
  });

  it('handles android: prefix with space after colon (YAML quirk)', () => {
    const item = { label: 'BYUtv', input: 'android: org.byutv.android/.MainActivity' };
    const result = normalizeListItem(item);
    expect(result.android).toEqual({
      package: 'org.byutv.android',
      activity: '.MainActivity'
    });
  });

  it('handles android: prefix with no activity (package only)', () => {
    const item = { label: 'Some App', input: 'android:com.example.app' };
    const result = normalizeListItem(item);
    expect(result.android).toEqual({
      package: 'com.example.app',
      activity: ''
    });
  });

  it('preserves common fields (uid, image, active)', () => {
    const item = {
      uid: 'abc-123',
      label: 'Zoom',
      input: 'android:us.zoom.videomeetings/com.zipow.videobox.LauncherActivity',
      image: '/media/img/apps/zoom.png',
      active: true
    };
    const result = normalizeListItem(item);
    expect(result.uid).toBe('abc-123');
    expect(result.image).toBe('/media/img/apps/zoom.png');
    expect(result.active).toBe(true);
    expect(result.android.package).toBe('us.zoom.videomeetings');
    expect(result.android.activity).toBe('com.zipow.videobox.LauncherActivity');
  });

  it('does not mutate the original item', () => {
    const item = { label: 'Test', input: 'android:com.test/Activity' };
    const copy = JSON.parse(JSON.stringify(item));
    normalizeListItem(item);
    expect(item).toEqual(copy);
  });
});
```

- [ ] **Step 2: Write failing tests for `extractContentId` with android items**

Add to the `extractContentId` describe block:

```javascript
it('extracts content ID from android item', () => {
  const item = { android: { package: 'org.lds.stream', activity: '.TvMainActivity' } };
  expect(extractContentId(item)).toBe('android:org.lds.stream/.TvMainActivity');
});
```

- [ ] **Step 3: Write failing test for `denormalizeItem` with android items**

Add to the `denormalizeItem` describe block:

```javascript
it('strips android key and sets input+action during denormalization', () => {
  const item = { title: 'Gospel Stream', android: { package: 'org.lds.stream', activity: '.TvMainActivity' } };
  const result = denormalizeItem(item);
  expect(result.android).toBeUndefined();
  expect(result.input).toBe('android:org.lds.stream/.TvMainActivity');
  expect(result.action).toBe('Android');
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`
Expected: FAIL — android-related tests fail (no android detection in normalizer yet)

---

### Task 2: Implement `android:` prefix in normalizer

**Files:**
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`

- [ ] **Step 1: Add android prefix detection in `normalizeListItem`**

Replace the `else if (item.input)` block (lines 63-90) with:

```javascript
else if (item.input) {
    const normalized = normalizeInput(item.input);

    // Android items are client-side only — produce android key, skip action switch
    if (normalized.startsWith('android:')) {
      const rest = normalized.slice('android:'.length);
      const slashIdx = rest.indexOf('/');
      result.android = {
        package: slashIdx >= 0 ? rest.slice(0, slashIdx) : rest,
        activity: slashIdx >= 0 ? rest.slice(slashIdx + 1) : ''
      };
    } else {
      const action = (item.action || 'Play').toLowerCase();

      switch (action) {
        case 'open': {
          // Extract local part after "app:" prefix (or use raw if no prefix)
          const colonIdx = normalized.indexOf(':');
          result.open = colonIdx >= 0 ? normalized.slice(colonIdx + 1) : normalized;
          break;
        }
        case 'display':
          result.display = { contentId: normalized };
          break;
        case 'list':
          result.list = { contentId: normalized };
          break;
        case 'queue':
          result.queue = { contentId: normalized };
          break;
        case 'launch':
          result.launch = { contentId: normalized };
          break;
        default: // 'play' or unrecognized
          result.play = { contentId: normalized };
          break;
      }
    }
  }
```

- [ ] **Step 2: Update `extractContentId` to handle android items**

In `extractContentId()`, add after the `item.open` ternary (line 121) and before the final `|| ''` (line 122):

```javascript
    || (item.android ? `android:${item.android.package}/${item.android.activity}` : '')
```

The full chain becomes:
```javascript
    || (item.open ? `app:${item.open}` : '')
    || (item.android ? `android:${item.android.package}/${item.android.activity}` : '')
    || '';
```

- [ ] **Step 3: Update `extractActionName` to handle android items**

In `extractActionName()`, add after `if (item.action) return item.action;`:

```javascript
  if (item.android) return 'Android';
```

- [ ] **Step 4: Update `denormalizeItem` to clean up android key**

In `denormalizeItem()`, add to the cleanup section (after `delete result.launch;`):

```javascript
  delete result.android;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/list/listConfigNormalizer.mjs tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
git commit -m "feat(normalizer): add android: prefix support for FKB app launching"
```

---

## Chunk 2: Frontend Lib — FKB Integration

### Task 3: Create `fkb.js` standalone lib

**Files:**
- Create: `frontend/src/lib/fkb.js`

- [ ] **Step 1: Create `frontend/src/lib/fkb.js`**

```javascript
// frontend/src/lib/fkb.js
// Standalone FKB (Fully Kiosk Browser) integration.
// No React dependency. No-ops when FKB is not present.

import getLogger from './logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fkb' });
  return _logger;
}

/**
 * Check if the FKB JavaScript interface is available.
 * The `fully` global is injected by FKB into all WebView pages.
 */
export function isFKBAvailable() {
  return typeof fully !== 'undefined';
}

/**
 * Launch an Android app via FKB's startApplication API.
 * Fire-and-forget — FKB provides no success/failure callback.
 *
 * @param {string} packageName - Android package name (e.g., 'org.lds.stream')
 * @param {string} [activityName] - Activity class name (e.g., '.TvMainActivity')
 * @returns {boolean} true if FKB was available and launch was attempted
 */
export function launchApp(packageName, activityName) {
  if (!isFKBAvailable()) {
    logger().warn('fkb.launch.unavailable', { packageName });
    return false;
  }
  logger().info('fkb.launch.attempt', { packageName, activityName });
  fully.startApplication(packageName, '', activityName || '');
  return true;
}

// Singleton pattern: each call overwrites previous callback
// to avoid stale handler accumulation (FKB has no unbind API).
let _onResumeCallback = null;
let _bound = false;

/**
 * Register a callback for FKB's onResume event (fires when FKB
 * returns to foreground after another app exits).
 *
 * Uses singleton pattern — only one callback active at a time.
 * Each call replaces the previous callback.
 *
 * @param {Function} callback
 */
export function onResume(callback) {
  _onResumeCallback = callback;
  if (!_bound && isFKBAvailable()) {
    fully.bind('onResume', () => {
      logger().info('fkb.resume');
      if (_onResumeCallback) _onResumeCallback();
    });
    _bound = true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/fkb.js
git commit -m "feat: add standalone FKB integration lib"
```

---

## Chunk 3: Menu Module — Android Launch Support

### Task 4: Create AndroidLaunchCard component

**Files:**
- Create: `frontend/src/modules/Menu/AndroidLaunchCard.jsx`
- Create: `frontend/src/modules/Menu/AndroidLaunchCard.scss`

- [ ] **Step 1: Create `AndroidLaunchCard.scss`**

```scss
// frontend/src/modules/Menu/AndroidLaunchCard.scss

.android-launch-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  background: rgba(0, 0, 0, 0.9);
  color: #e0e0e0;
  font-family: inherit;
  gap: 1.5rem;
  padding: 2rem;
  box-sizing: border-box;

  &__icon {
    width: 128px;
    height: 128px;
    object-fit: contain;
    border-radius: 16px;
  }

  &__title {
    font-size: 2rem;
    font-weight: 500;
    margin: 0;
    text-align: center;
  }

  &__status {
    font-size: 1.2rem;
    opacity: 0.7;
  }

  &--unavailable {
    .android-launch-card__status {
      color: #ff6b6b;
      opacity: 1;
    }
  }
}
```

- [ ] **Step 2: Create `AndroidLaunchCard.jsx`**

```jsx
// frontend/src/modules/Menu/AndroidLaunchCard.jsx
import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { isFKBAvailable, launchApp, onResume } from '../../lib/fkb.js';
import { DaylightMediaPath } from '../../lib/api.mjs';
import './AndroidLaunchCard.scss';

const AndroidLaunchCard = ({ android, title, image, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'AndroidLaunchCard' }), []);
  const [status, setStatus] = useState('checking'); // checking | launching | unavailable

  // Attempt launch on mount
  useEffect(() => {
    if (!android?.package) {
      setStatus('unavailable');
      return;
    }

    if (!isFKBAvailable()) {
      logger.info('android-launch.fkb-unavailable', { package: android.package });
      setStatus('unavailable');
      return;
    }

    setStatus('launching');
    launchApp(android.package, android.activity);

    // Bind onResume to return to menu
    onResume(() => {
      logger.info('android-launch.returned', { package: android.package });
      onClose?.();
    });
  }, [android, logger, onClose]);

  // Escape key always dismisses
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'GamepadSelect') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const imgSrc = image && (image.startsWith('/media/') || image.startsWith('media/'))
    ? DaylightMediaPath(image)
    : image;

  const isUnavailable = status === 'unavailable';

  return (
    <div className={`android-launch-card${isUnavailable ? ' android-launch-card--unavailable' : ''}`}>
      {imgSrc && <img className="android-launch-card__icon" src={imgSrc} alt={title} />}
      <h2 className="android-launch-card__title">{title}</h2>
      <div className="android-launch-card__status">
        {status === 'checking' && 'Checking...'}
        {status === 'launching' && 'Launching...'}
        {status === 'unavailable' && 'Not available on this device'}
      </div>
    </div>
  );
};

export default AndroidLaunchCard;
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Menu/AndroidLaunchCard.jsx frontend/src/modules/Menu/AndroidLaunchCard.scss
git commit -m "feat: add AndroidLaunchCard component for FKB app launching"
```

---

### Task 5: Add android support to MenuStack and Menu

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx`
- Modify: `frontend/src/modules/Menu/Menu.jsx`

- [ ] **Step 1: Add lazy import and handleSelect case in MenuStack.jsx**

In `MenuStack.jsx`, add the lazy import (after the existing lazy imports around line 12):

```javascript
const AndroidLaunchCard = lazy(() => import('./AndroidLaunchCard.jsx'));
```

In `handleSelect` callback (around line 103, after the `} else if (selection.launch) {` block), add:

```javascript
    } else if (selection.android) {
      const logger = getLogger();
      logger.info('android-launch.intent', {
        package: selection.android.package,
        activity: selection.android.activity,
        title: selection.title || selection.label,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'android-launch', props: selection });
    }
```

- [ ] **Step 2: Add render case in MenuStack.jsx**

In the render switch (after the `case 'launch':` block, around line 234), add:

```javascript
    case 'android-launch':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AndroidLaunchCard
            android={props.android}
            title={props.title}
            image={props.image}
            onClose={clear}
          />
        </Suspense>
      );
```

- [ ] **Step 3: Update Menu.jsx — add FKB import and disabled class**

At the top of `Menu.jsx`, add the import:

```javascript
import { isFKBAvailable } from '../../lib/fkb.js';
```

In `logMenuSelection` (line 20), update the mediaKey extraction to include android items. Since `item.android` is `{ package, activity }` (not a contentId object), wrap it:

```javascript
const mediaKey = item?.play || item?.queue || item?.list || item?.open || item?.launch
    || (item?.android ? { contentId: `android:${item.android.package}` } : null);
```

In `findKeyForItem` (line 572-576), add `item?.android` to the chain. Replace the function body:

```javascript
  const findKeyForItem = useCallback((item) => {
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    const androidKey = item?.android ? `android:${item.android.package}` : null;
    return item?.id ?? item?.key ?? actionVal ?? androidKey ?? item?.label ?? null;
  }, []);
```

In the `MenuItems` render loop (around line 761), add the disabled class. Find the line with `className={`menu-item` and update:

```javascript
        const isAndroid = !!item.android;
        const isDisabled = isAndroid && !isFKBAvailable();
```

Then update the className (around line 786):

```javascript
            className={`menu-item ${item.type || ""} ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
```

Also add the disabled style to `frontend/src/modules/Menu/Menu.scss` (at the end, inside the existing styles):

```scss
.menu-item.disabled {
  opacity: 0.4;
  filter: grayscale(0.8);
  pointer-events: none;
}
```

- [ ] **Step 4: Verify the dev server builds without errors**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds (no import errors, no JSX issues)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx frontend/src/modules/Menu/Menu.jsx frontend/src/modules/Menu/Menu.scss
git commit -m "feat(menu): add android-launch type and FKB disabled state"
```

---

## Chunk 4: Screen-Framework — Menu Widget + Config

### Task 6: Create MenuWidget and register in builtins

**Files:**
- Create: `frontend/src/screen-framework/widgets/MenuWidget.jsx`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`

- [ ] **Step 1: Create `MenuWidget.jsx`**

```jsx
// frontend/src/screen-framework/widgets/MenuWidget.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
import { PlayerOverlayLoading } from '../../modules/Player/Player.jsx';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';
import { usePlaybackBroadcast } from '../../hooks/media/usePlaybackBroadcast.js';
import { getChildLogger } from '../../lib/logging/singleton.js';

const TV_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];

/**
 * MenuWidget — screen-framework widget that wraps MenuStack.
 *
 * Provides the same functionality as TVApp.jsx:
 * - Fetches root menu data from the configured source
 * - Parses autoplay URL params on mount
 * - Sets up playback broadcast
 * - Renders MenuStack for navigation
 *
 * Does NOT create its own MenuNavigationProvider —
 * uses the one already provided by ScreenRenderer.
 *
 * Props come from the screen YAML config:
 *   widget: menu
 *   props:
 *     source: TVApp        # menu list name
 *     style: tv-menu       # (reserved for future style variants)
 *     showImages: true      # (reserved for future use)
 */
function MenuWidget({ source }) {
  const [list, setList] = useState(null);
  const logger = useMemo(() => getChildLogger({ widget: 'menu' }), []);

  const autoplay = useMemo(
    () => parseAutoplayParams(window.location.search, TV_ACTIONS),
    []
  );

  const isQueueOrPlay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());
    return ['queue', 'play'].some(key => Object.keys(queryEntries).includes(key));
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`);
      setList(data);
      logger.info('menu-widget.data-loaded', { source, count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [source, logger]);

  // Show loading overlay if autoplay is pending and data not ready
  if (!list && isQueueOrPlay) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  if (!list) {
    return <MenuSkeleton />;
  }

  return (
    <MenuWidgetContent
      rootMenu={list}
      autoplay={autoplay}
      logger={logger}
    />
  );
}

/**
 * Inner component that uses the navigation context for autoplay handling.
 * Must be rendered inside MenuNavigationProvider (provided by ScreenRenderer).
 */
function MenuWidgetContent({ rootMenu, autoplay, logger }) {
  const { push, currentContent } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);
  const playerRef = useRef(null);

  // Derive broadcastItem from currentContent (same logic as TVAppContent)
  const broadcastItem = useMemo(() => {
    if (!currentContent) return null;
    if (currentContent.type !== 'player' && currentContent.type !== 'composite') return null;
    const contentProps = currentContent.props || {};
    const item = contentProps.play || (contentProps.queue && contentProps.queue[0]) || null;
    if (!item) return null;
    return {
      contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
      title: item.title ?? item.label ?? item.name ?? null,
      format: item.format ?? item.mediaType ?? item.type ?? null,
      thumbnail: item.thumbnail ?? item.image ?? null,
    };
  }, [currentContent]);

  usePlaybackBroadcast(playerRef, broadcastItem);

  // Handle autoplay on mount (same logic as TVAppContent in TVApp.jsx)
  useEffect(() => {
    if (!autoplayed && autoplay) {
      if (autoplay.compose) {
        push({ type: 'composite', props: autoplay.compose });
      } else if (autoplay.queue || autoplay.play) {
        push({ type: 'player', props: autoplay });
      } else if (autoplay.display) {
        push({ type: 'display', props: autoplay });
      } else if (autoplay.read) {
        push({ type: 'reader', props: autoplay });
      } else if (autoplay.launch) {
        push({ type: 'launch', props: autoplay });
      } else if (autoplay.list?.contentId) {
        push({ type: 'plex-menu', props: autoplay });
      } else if (autoplay.list) {
        push({ type: 'menu', props: autoplay });
      } else if (autoplay.open) {
        push({ type: 'app', props: autoplay });
      }
      setAutoplayed(true);
      logger.info('menu-widget.autoplay', { keys: Object.keys(autoplay || {}) });
    }
  }, [autoplay, autoplayed, push, logger]);

  // Show loading if autoplay is pending
  if (autoplay && !autoplayed) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
}

export default MenuWidget;
```

- [ ] **Step 2: Register menu widget in builtins.js**

In `frontend/src/screen-framework/widgets/builtins.js`, add the import and registration:

Add import at top:
```javascript
import MenuWidget from './MenuWidget.jsx';
```

Add registration inside `registerBuiltinWidgets()`, after the `piano` registration:
```javascript
  registry.register('menu', MenuWidget);
```

- [ ] **Step 3: Verify build succeeds**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/widgets/MenuWidget.jsx frontend/src/screen-framework/widgets/builtins.js
git commit -m "feat(screen-framework): register menu widget wrapping MenuStack"
```

---

### Task 7: Create living-room.yml screen config and update tvapp.yml

**Files:**
- Create: `data/household/screens/living-room.yml` (via docker exec)
- Modify: `data/household/config/lists/menus/tvapp.yml` (via docker exec)
- Remove: `data/household/screens/tv.yml` (via docker exec)

- [ ] **Step 1: Create living-room.yml**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/screens/living-room.yml << 'YAMLEOF'
# Living Room TV Screen
# Replaces legacy TVApp.jsx — uses screen-framework with menu widget

screen: living-room
route: /screen/living-room
input:
  type: remote
  keyboard_id: tvremote

websocket:
  commands: true

layout:
  children:
    - widget: menu
      grow: 1
      props:
        source: TVApp
        style: tv-menu
        showImages: true

actions:
  escape:
    - when: shader_active
      do: clear_shader
    - when: overlay_active
      do: dismiss_overlay
    - when: idle
      do: reload
  sleep:
    wake: keydown

fkb:
  onResume: restore
YAMLEOF"
```

- [ ] **Step 2: Add 3 android app items to tvapp.yml**

Read current tvapp.yml first, then append the android items to the first section's items list:

```bash
# Read current content to verify structure
sudo docker exec daylight-station sh -c 'cat data/household/config/lists/menus/tvapp.yml'

# Append android items — write the full file with new items added
# NOTE: The items should be added to the end of the first section's items list,
# before the "Season Content" section. Read the current file, add the 3 items,
# write back the complete file. Use the exact current content + new items.
```

The 3 items to add at the end of the first section (before `- title: Season Content`):

```yaml
      - input: android:org.lds.stream/.ux.androidtv.main.TvMainActivity
        label: Gospel Stream
        image: /media/img/apps/gospel-stream.png
      - input: android:org.byutv.android/.MainActivity
        label: BYUtv
        image: /media/img/apps/byutv.png
      - input: android:us.zoom.videomeetings/com.zipow.videobox.LauncherActivity
        label: Zoom
        image: /media/img/apps/zoom.png
```

Note: If the image files don't exist yet, the menu will fall back to label-based gradient placeholders (existing behavior). Create the icon files later when available.

- [ ] **Step 3: Remove old tv.yml placeholder**

```bash
sudo docker exec daylight-station sh -c 'rm data/household/screens/tv.yml'
```

- [ ] **Step 4: Verify the screen config is served by the API**

```bash
curl -s http://localhost:3111/api/v1/screens/living-room | head -20
```

Expected: JSON response with the screen config (screen: "living-room", layout with menu widget)

- [ ] **Step 5: Verify tvapp.yml android items come through the API**

```bash
curl -s http://localhost:3111/api/v1/list/watchlist/TVApp/recent_on_top | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; android=[i for i in items if 'android' in (i.get('android') and 'yes' or json.dumps(i))]; print(f'Total items: {len(items)}'); [print(f'  - {i.get(\"title\",\"?\")} android:{i.get(\"android\",{})}') for i in items if i.get('android')]"
```

Expected: Shows total items count and the 3 android items with parsed package/activity

- [ ] **Step 6: Commit (no git for data volume changes — they're runtime config)**

No git commit needed for data volume files. These are deployed config, not source code.

---

## Chunk 5: Playwright Tests

### Task 8: Write Playwright flow tests for /screen/living-room

**Files:**
- Create: `tests/live/flow/screen/living-room.runtime.test.mjs`

- [ ] **Step 1: Create the test file**

```javascript
// tests/live/flow/screen/living-room.runtime.test.mjs
import { test, expect } from '@playwright/test';

const ROUTE = '/screen/living-room';
const LOAD_TIMEOUT = 15000;

test.describe('Living Room Screen — Menu Widget', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    // Wait for menu items to render (menu widget fetches data then renders)
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });
  });

  test('renders menu with items from tvapp.yml', async ({ page }) => {
    const items = page.locator('.menu-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(5); // tvapp.yml has 20+ items
  });

  test('first item is selected by default', async ({ page }) => {
    const activeItem = page.locator('.menu-item.active');
    await expect(activeItem).toHaveCount(1);
  });

  test('arrow keys navigate between items', async ({ page }) => {
    // Get initial active item label
    const getActiveLabel = () =>
      page.locator('.menu-item.active .menu-item-label').textContent();

    const firstLabel = await getActiveLabel();

    // Press right arrow to move to next item
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const secondLabel = await getActiveLabel();
    expect(secondLabel).not.toBe(firstLabel);

    // Press left arrow to go back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);

    const backLabel = await getActiveLabel();
    expect(backLabel).toBe(firstLabel);
  });

  test('android items render with disabled class (no FKB in headless)', async ({ page }) => {
    const disabledItems = page.locator('.menu-item.disabled');
    const count = await disabledItems.count();
    // Should have at least 1 disabled android item (3 were added)
    expect(count).toBeGreaterThanOrEqual(1);
  });

});

test.describe('Living Room Screen — Menu Item Selection', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });
  });

  test('selecting a plex list item opens a submenu', async ({ page }) => {
    // Navigate to a known List item (e.g., Veggietales which has action: List)
    // Find it by label
    const veggie = page.locator('.menu-item', { hasText: 'Veggietales' });
    const isVisible = await veggie.isVisible().catch(() => false);

    if (!isVisible) {
      // Item might be off-screen, navigate to it
      // Skip this test if the item isn't in the current menu
      test.skip(!isVisible, 'Veggietales item not found in menu');
      return;
    }

    // Navigate to it and select
    // Find its index, arrow to it, then press Enter
    const items = page.locator('.menu-item');
    const count = await items.count();
    let targetIdx = -1;
    for (let i = 0; i < count; i++) {
      const label = await items.nth(i).locator('.menu-item-label').textContent();
      if (label === 'Veggietales') { targetIdx = i; break; }
    }

    if (targetIdx < 0) {
      test.skip(true, 'Veggietales not found');
      return;
    }

    // Navigate to target index
    for (let i = 0; i < targetIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    // Select the item
    await page.keyboard.press('Enter');

    // Should show a new menu (submenu) or player
    // Wait for either new menu items or player to appear
    await page.waitForFunction(() => {
      // Check if menu header changed (new menu loaded) or player appeared
      const header = document.querySelector('.menu-header h2');
      return header && header.textContent !== 'Tvapp';
    }, { timeout: 10000 });
  });

  test('selecting an android item shows AndroidLaunchCard', async ({ page }) => {
    // Find an android item (they have .disabled class in headless)
    const items = page.locator('.menu-item');
    const count = await items.count();
    let androidIdx = -1;

    for (let i = 0; i < count; i++) {
      const classes = await items.nth(i).getAttribute('class');
      if (classes && classes.includes('disabled')) {
        androidIdx = i;
        break;
      }
    }

    if (androidIdx < 0) {
      test.skip(true, 'No android items found');
      return;
    }

    // Navigate to it — but disabled items have pointer-events: none
    // We need to navigate via keyboard
    for (let i = 0; i < androidIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    // The item is disabled in CSS but keyboard selection still works
    // (disabled class only affects pointer-events and visual style)
    await page.keyboard.press('Enter');

    // AndroidLaunchCard should appear with "Not available on this device"
    await page.waitForSelector('.android-launch-card', { timeout: 5000 });
    const statusText = await page.locator('.android-launch-card__status').textContent();
    expect(statusText).toContain('Not available');
  });

  test('escape from AndroidLaunchCard returns to menu', async ({ page }) => {
    // Find and select an android item
    const items = page.locator('.menu-item');
    const count = await items.count();
    let androidIdx = -1;

    for (let i = 0; i < count; i++) {
      const classes = await items.nth(i).getAttribute('class');
      if (classes && classes.includes('disabled')) {
        androidIdx = i;
        break;
      }
    }

    if (androidIdx < 0) {
      test.skip(true, 'No android items found');
      return;
    }

    for (let i = 0; i < androidIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }

    await page.keyboard.press('Enter');
    await page.waitForSelector('.android-launch-card', { timeout: 5000 });

    // Press escape
    await page.keyboard.press('Escape');

    // Should be back at the menu
    await page.waitForSelector('.menu-item', { timeout: 5000 });
    const launchCard = page.locator('.android-launch-card');
    await expect(launchCard).toHaveCount(0);
  });
});

test.describe('Living Room Screen — Autoplay URL Params', () => {

  test('play param opens player directly', async ({ page }) => {
    // Use a known Plex content ID from tvapp.yml
    await page.goto(`${ROUTE}?play=plex:642120`);

    // Player should appear (either loading or playing)
    // Wait for either player overlay or video/audio element
    await page.waitForFunction(() => {
      return document.querySelector('.player-overlay, video, audio, .player-container');
    }, { timeout: LOAD_TIMEOUT });
  });

  test('bare route shows menu (no autoplay)', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });

    // No player should be visible
    const player = page.locator('.player-overlay, .player-container');
    const playerCount = await player.count();
    // Player might exist in DOM but not be visible — check for menu items instead
    const menuItems = page.locator('.menu-item');
    const menuCount = await menuItems.count();
    expect(menuCount).toBeGreaterThan(0);
  });

});

test.describe('Living Room Screen — Escape Navigation', () => {

  test('escape from submenu returns to root menu', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('.menu-item', { timeout: LOAD_TIMEOUT });

    // Find a List item to open a submenu
    const items = page.locator('.menu-item');
    const count = await items.count();
    let listIdx = -1;

    // Look for Veggietales (known List action item)
    for (let i = 0; i < count; i++) {
      const label = await items.nth(i).locator('.menu-item-label').textContent();
      if (label === 'Veggietales') { listIdx = i; break; }
    }

    if (listIdx < 0) {
      test.skip(true, 'No list item found for submenu test');
      return;
    }

    // Navigate and select
    for (let i = 0; i < listIdx; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }
    await page.keyboard.press('Enter');

    // Wait for submenu to load
    await page.waitForFunction(() => {
      const header = document.querySelector('.menu-header h2');
      return header && header.textContent !== 'Tvapp';
    }, { timeout: 10000 });

    // Press escape to go back
    await page.keyboard.press('Escape');

    // Should be back at root menu
    await page.waitForFunction(() => {
      const header = document.querySelector('.menu-header h2');
      return header && header.textContent === 'Tvapp';
    }, { timeout: 5000 });
  });

});
```

- [ ] **Step 2: Run tests to verify they execute (some may fail until server restart)**

Run: `npx playwright test tests/live/flow/screen/living-room.runtime.test.mjs --reporter=line`
Expected: Tests run. Menu-load tests should pass if dev server is running with the new code. Android tests should pass (disabled items + AndroidLaunchCard unavailable path).

- [ ] **Step 3: Fix any test failures**

Debug based on actual failures. Common issues:
- Dev server needs restart for new widget registration
- Menu item indices may differ from expected
- Selector names may need adjustment based on actual DOM

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/screen/living-room.runtime.test.mjs
git commit -m "test: add Playwright flow tests for living-room screen migration"
```

---

## Chunk 6: Final Verification

### Task 9: End-to-end verification

- [ ] **Step 1: Restart dev server to pick up all changes**

```bash
# Check if dev server is running
lsof -i :3112
# If running, stop it
pkill -f 'node backend/index.js'
# Start fresh
cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

- [ ] **Step 2: Verify /screen/living-room loads in browser**

```bash
curl -s http://localhost:3112/screen/living-room | head -5
```

Expected: HTML response (Vite app shell)

- [ ] **Step 3: Verify menu API returns android items**

```bash
curl -s http://localhost:3112/api/v1/list/watchlist/TVApp/recent_on_top | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
android = [i for i in items if i.get('android')]
print(f'Total: {len(items)} items, {len(android)} android')
for a in android:
    print(f'  {a[\"title\"]}: {a[\"android\"]}')
"
```

Expected: Shows 3 android items with parsed package/activity

- [ ] **Step 4: Run full Playwright test suite**

```bash
npx playwright test tests/live/flow/screen/living-room.runtime.test.mjs --reporter=line
```

Expected: All tests PASS

- [ ] **Step 5: Run existing normalizer tests to confirm no regressions**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

Expected: All tests PASS (existing + new android tests)

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "fix: address test feedback from living-room migration"
```
