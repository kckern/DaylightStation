# TVApp → Screen-Framework Migration + Android App Launching

## Goal

Migrate the living room TV experience from the legacy `TVApp.jsx` (`/tv`) to the screen-framework (`/screen/living-room`). As part of this migration, add native Android app launching via FKB's JavaScript API. The result: TVApp.jsx is fully deprecated and can be removed.

---

## Architecture

```
living-room.yml
    └── ScreenRenderer (existing)
        ├── MenuNavigationProvider (existing — ScreenRenderer already provides this)
        ├── ScreenOverlayProvider (existing — WS-triggered playback)
        ├── ScreenActionHandler (existing — escape, shader, volume, sleep)
        ├── ScreenCommandHandler (existing — WS → ActionBus)
        └── PanelRenderer
            └── widget: menu (NEW registration)
                └── MenuWidget (NO own MenuNavigationProvider — uses ScreenRenderer's)
                    └── MenuStack (existing)
                        ├── TVMenu (existing)
                        ├── Player (existing, internal push)
                        ├── LaunchCard (existing)
                        ├── AndroidLaunchCard (NEW — client-side FKB launch)
                        └── PlexMenuRouter, Displayer, AppContainer (existing)
```

### Two Player Entry Points

1. **Menu selection** → MenuStack internal push → Player rendered by MenuStack
2. **WS command / ActionBus** → ScreenActionHandler → Player as overlay

Both are valid. Escape chain handles either (overlay dismiss for #2, MenuStack pop for #1).

### Autoplay URL Params

Handled by the menu widget on mount (same as TVApp today). The widget calls `parseAutoplayParams()` and pushes into MenuStack. Not routed through ActionBus. The `open` action is already supported by `parseAutoplayParams`, so the legacy `/tv/app/:app` route is replaced by `/screen/living-room?open=appName`.

### MenuNavigationProvider

ScreenRenderer already wraps content in `MenuNavigationProvider`. MenuWidget does **not** create its own — it uses the existing one from ScreenRenderer. This means MenuStack's navigation state is visible to ScreenActionHandler's escape chain, which can detect overlay vs menu-internal navigation.

---

## Layer 1: Config

### living-room.yml (replaces existing tv.yml placeholder)

The existing `data/household/screens/tv.yml` is a placeholder with unregistered widgets. Replace it with `living-room.yml`. Delete `tv.yml` to avoid confusion.

```yaml
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
```

### tvapp.yml (3 new items)

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

Icons must be provided manually via `image:` field — FKB does not expose app icons. Falls back to label-based gradient placeholder (existing Menu behavior when no image).

---

## Layer 2: Backend — Normalizer

**File:** `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`

Detect `android:` prefix in the input string before the action switch. Android items are client-side only — no ContentIdResolver registration, no backend adapter.

**Parsing:** `android:org.lds.stream/.ux.androidtv.main.TvMainActivity`
- Split on first `:` → source = `android`
- Remainder = `org.lds.stream/.ux.androidtv.main.TvMainActivity`
- Split on first `/` → package = `org.lds.stream`, activity = `.ux.androidtv.main.TvMainActivity`

**In `normalizeListItem()`**, inside the `else if (item.input)` block, add prefix detection with an explicit guard to prevent fall-through to the action switch:

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
      // ... existing cases unchanged
    }
  }
}
```

**Also update:**

`extractContentId()`:
```javascript
|| (item.android ? `android:${item.android.package}/${item.android.activity}` : '')
```

`extractActionName()`:
```javascript
if (item.android) return 'Android';
```

`denormalizeItem()`:
```javascript
delete result.android;
```

---

## Layer 3: Frontend Lib — `frontend/src/lib/fkb.js`

Standalone, optional module. No dependencies on screen-framework or React. No-ops when FKB isn't present. Includes structured logging per project convention.

```javascript
import getLogger from './logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fkb' });
  return _logger;
}

export function isFKBAvailable() {
  return typeof fully !== 'undefined';
}

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
// to avoid stale handler accumulation (FKB has no unbind API)
let _onResumeCallback = null;
let _bound = false;

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

---

## Layer 4: Menu Widget — `frontend/src/screen-framework/widgets/MenuWidget.jsx`

Thin wrapper that provides what TVApp.jsx provides today. Does **not** create its own `MenuNavigationProvider` — uses the one already provided by `ScreenRenderer`.

`TV_ACTIONS` constant defined here (moved from TVApp.jsx):

```javascript
const TV_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];
```

**MenuWidget** (outer component):

```jsx
function MenuWidget({ source, style, showImages }) {
  const [list, setList] = useState(null);
  const autoplay = useMemo(
    () => parseAutoplayParams(window.location.search, TV_ACTIONS),
    []
  );
  const playerRef = useRef(null);

  useEffect(() => {
    DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`).then(setList);
  }, [source]);

  if (!list) return <MenuSkeleton />;

  return (
    <MenuWidgetContent
      rootMenu={list}
      autoplay={autoplay}
      playerRef={playerRef}
    />
  );
}
```

**MenuWidgetContent** (inner component, uses navigation context from ScreenRenderer's provider):

```jsx
function MenuWidgetContent({ rootMenu, autoplay, playerRef }) {
  const { push, currentContent } = useMenuNavigationContext();
  const [autoplayed, setAutoplayed] = useState(false);

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

  // Handle autoplay on mount (same logic as TVAppContent)
  useEffect(() => {
    if (!autoplayed && autoplay) {
      // ... same push logic as TVApp (compose, queue, play, display, read, launch, list, open)
      setAutoplayed(true);
    }
  }, [autoplay, autoplayed, push]);

  return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
}
```

**Loading behavior note:** TVApp fetches root menu data before rendering MenuNavigationProvider, showing `PlayerOverlayLoading` or `MenuSkeleton`. MenuWidget fetches data in the outer component and shows `MenuSkeleton` while loading, then renders `MenuWidgetContent` only after data arrives. This preserves the same UX of not rendering the menu until data is ready.

Registered in `builtins.js` as `'menu'`.

---

## Layer 5: Menu Module — Android Launch Support

### MenuStack.jsx

**handleSelect** — new case:

```javascript
} else if (selection.android) {
  const logger = getLogger();
  logger.info('android-launch.intent', {
    package: selection.android.package,
    activity: selection.android.activity,
    title: selection.title || selection.label,
    source: 'menu-selection',
  });
  push({ type: 'android-launch', props: selection });
}
```

**Render switch** — new case:

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

### Menu.jsx — Card Rendering

In `MenuItems`, detect android items and apply disabled styling when FKB unavailable:

```javascript
const isAndroid = !!item.android;
const fkbAvailable = isFKBAvailable(); // static check from fkb.js, no hook

// In the className:
className={`menu-item ${isActive ? 'active' : ''} ${isAndroid && !fkbAvailable ? 'disabled' : ''}`}
```

Also update:
- `findKeyForItem` — add `item?.android` to the action key chain so android items get stable keys (fall back to `android:${item.android.package}`)
- `logMenuSelection` — add `item?.android` so android selections are logged

### AndroidLaunchCard.jsx (new)

Simpler than LaunchCard — no backend API call, no progress bar, no schedule check:

1. On mount: check `isFKBAvailable()`
2. If unavailable → show "Not available on this device" message, escape to dismiss
3. If available → show app icon + label + "Launching..." state, call `launchApp(package, activity)`
4. Bind `onResume()` → call `onClose()` (pops back to menu)
5. Escape key always dismisses (returns to menu without waiting for onResume)

---

## Layer 6: FKB onResume Screen Config

The `fkb.onResume` field in living-room.yml controls what happens when FKB returns to foreground after an external app:

| Value | Behavior |
|-------|----------|
| `restore` (default) | AndroidLaunchCard's onResume calls `onClose()` → MenuStack pops back to menu |
| `reload` (deferred) | `window.location.reload()` — requires ScreenRenderer to read `config.fkb.onResume` and bind a top-level handler. Not in initial implementation. |

**Initial implementation:** Only `restore` mode is supported. The `fkb.onResume` config field is accepted but `reload` mode is not wired up. AndroidLaunchCard always restores to menu.

---

## Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| No FKB (desktop browser, office screen) | `android:` menu items rendered with `.disabled` class (greyed out, reduced opacity). Selecting shows "Not available on this device" within AndroidLaunchCard. |
| FKB present, app installed | `fully.startApplication()` fires, app launches, `onResume` returns to menu |
| FKB present, app NOT installed | `fully.startApplication()` is fire-and-forget. FKB handles "app not found" natively. User presses back → `onResume` fires → returns to menu |

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/lib/fkb.js` | FKB detection + launch + onResume helpers (standalone, no React) |
| `frontend/src/screen-framework/widgets/MenuWidget.jsx` | Menu widget wrapper (autoplay + playback broadcast + MenuStack) |
| `frontend/src/modules/Menu/AndroidLaunchCard.jsx` | Client-side FKB app launch overlay |
| `frontend/src/modules/Menu/AndroidLaunchCard.scss` | Styles for launch card + disabled menu item state |
| `data/household/screens/living-room.yml` | Screen config for living room TV |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/screen-framework/widgets/builtins.js` | Register `menu` → MenuWidget |
| `frontend/src/modules/Menu/MenuStack.jsx` | Add `android-launch` case to handleSelect + render switch |
| `frontend/src/modules/Menu/Menu.jsx` | Import `isFKBAvailable`, add `.disabled` class to android items, update `findKeyForItem` and `logMenuSelection` |
| `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` | Detect `android:` prefix with guard, update `extractContentId`, `extractActionName`, `denormalizeItem` |
| `data/household/config/lists/menus/tvapp.yml` | Add 3 android app items |

### Removed Files

| File | Reason |
|------|--------|
| `data/household/screens/tv.yml` | Placeholder with unregistered widgets. Replaced by `living-room.yml`. |

### Not Modified

| File | Why |
|------|-----|
| `ScreenRenderer.jsx` | Works as-is — already provides MenuNavigationProvider |
| `ScreenActionHandler.jsx` | Already handles menu/player/escape/shader/volume/sleep |
| `useScreenCommands.js` | Already translates WS → ActionBus |
| `Player.jsx` | Works both inside MenuStack and as overlay |
| `parseAutoplayParams.js` | Reused as-is by MenuWidget |
| `LaunchCard.jsx` | Unchanged — handles retroarch/content launches (backend API) |

---

## Exit Criteria

Playwright tests confirming:

1. **Menu loads** — `/screen/living-room` renders the menu with items from tvapp.yml
2. **Menu item selection coverage** — selecting various item types routes correctly:
   - `plex:` items → Player or submenu
   - `app:` items → AppContainer
   - `scripture:` / `talk:` items → appropriate content view
   - `android:` items → AndroidLaunchCard renders (with "Not available" message in headless browser since no FKB)
3. **Autoplay URL params** — `/screen/living-room?play=plex:642120` opens Player directly
4. **Escape navigation** — escape from Player/submenu returns to root menu
5. **Disabled state** — android items render with `.disabled` class in non-FKB environments

**Skip:** Actual Android app launching (requires FKB on real Android hardware). The AndroidLaunchCard's "unavailable" path is testable in headless.

Test location: `tests/live/flow/screen/living-room.runtime.test.mjs`

---

## Out of Scope

- **App icon fetching from FKB** — API doesn't support it. Manual image config only.
- **Installed app detection** — No FKB API. Optimistic launch only.
- **Backend adapter for android:** — No ContentIdResolver registration. Client-side only.
- **ADB-based app management** — Excluded per requirement.
- **Removing TVApp.jsx** — Left in place for now. Deprecation means the living room kiosk points to `/screen/living-room` instead of `/tv`. TVApp.jsx removal is a separate cleanup task once migration is validated.
- **FKB REST API probing** — Future enhancement for detecting app availability on repeated failures.
- **`fkb.onResume: reload` mode** — Config field accepted but only `restore` mode is implemented initially.
