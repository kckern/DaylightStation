# Fix Dual Autoplay Spinner Overlay

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the stale spinner overlay caused by two independent autoplay systems both firing on screen page load.

**Architecture:** Remove autoplay logic from `MenuWidget` entirely. `ScreenAutoplay` becomes the single owner of URL-based autoplay, emitting on the ActionBus for all supported action types. MenuWidget becomes a pure menu renderer with no autoplay awareness. The two "early loading" spinner guards in MenuWidget (`!list && isQueueOrPlay` and `autoplay && !autoplayed`) are removed — the overlay system handles the player spinner.

**Tech Stack:** React, ActionBus event system, ScreenOverlayProvider

---

## Context: The Bug

When the Shield TV loads `/screen/living-room?queue=plex:663324`, two independent systems both parse the URL params:

1. **`ScreenAutoplay`** (ScreenRenderer.jsx) — waits 500ms, emits `bus.emit('media:queue', ...)` → `ScreenActionHandler` → `showOverlay(Player, {queue})`
2. **`MenuWidget`** (MenuWidget.jsx) — immediately calls `push({type: 'player', props: autoplay})` on the nav stack

MenuWidget fires first (synchronous), video plays fine. ScreenAutoplay fires 500ms later, creates a SECOND Player overlay with empty queue, spinner sits on top for 30 seconds until the no-source timeout kills it.

## Design Decision

**`ScreenAutoplay` is the correct owner** because:
- It lives at the ScreenRenderer level, outside any specific widget — always present
- It uses the ActionBus → overlay system, which is the canonical way to launch players
- It already handles URL cleanup (`history.replaceState`)
- It handles path-based navigation (`/screen/living-room/fhe`) that MenuWidget can't

**MenuWidget should NOT parse autoplay params at all.** It's a menu renderer, not an autoplay dispatcher.

## Gap Analysis

`ScreenAutoplay` currently emits for: `queue`, `play`, `open`, `list`

`MenuWidget` handles (via nav push): `compose`, `queue`, `play`, `display`, `read`, `launch`, `list` (with `contentId` variant), `app`/`open`

Missing from `ScreenAutoplay`: `compose`, `display`, `read`, `launch`

These must be added to `ScreenAutoplay` before removing MenuWidget's autoplay.

---

### Task 1: Extend ScreenAutoplay to handle all action types

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx:76-86`

**Step 1: Add missing action emissions to ScreenAutoplay**

In `ScreenAutoplay`, the `setTimeout` block (lines 76-86) currently handles `queue`, `play`, `open`, and `list`. Extend it to also handle `compose`, `display`, `read`, and `launch` — all via ActionBus:

```javascript
    // Emit appropriate action after a brief delay to let the screen framework mount
    setTimeout(() => {
      if (autoplay.compose) {
        bus.emit('media:queue', { compose: true, sources: autoplay.compose.sources, ...autoplay.compose });
      } else if (autoplay.queue) {
        bus.emit('media:queue', { contentId: autoplay.queue.contentId, ...autoplay.queue });
      } else if (autoplay.play) {
        bus.emit('media:play', { contentId: autoplay.play.contentId, ...autoplay.play });
      } else if (autoplay.display) {
        bus.emit('display:content', autoplay.display);
      } else if (autoplay.read) {
        bus.emit('display:content', { ...autoplay.read, mode: 'reader' });
      } else if (autoplay.launch) {
        bus.emit('media:play', { contentId: autoplay.launch.contentId, ...autoplay.launch });
      } else if (autoplay.open) {
        bus.emit('menu:open', { menuId: autoplay.open.app });
      } else if (autoplay.list) {
        bus.emit('menu:open', { menuId: autoplay.list.contentId });
      }
    }, 500);
```

**Note:** `compose`, `display`, `read`, and `launch` may not have corresponding `ScreenActionHandler` listeners yet. That's acceptable — these are rare autoplay cases and can be wired in a follow-up if needed. The critical fix is preventing the duplicate `queue`/`play` firing, which is what causes the spinner bug.

**Step 2: Verify no regressions with a manual test**

Load `https://daylightlocal.kckern.net/screen/living-room?queue=plex:663324` in a browser. Verify:
- Only ONE player overlay appears
- Video plays without a stale spinner on top
- Escape dismisses the player

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen): extend ScreenAutoplay to handle all action types"
```

---

### Task 2: Remove autoplay logic from MenuWidget

**Files:**
- Modify: `frontend/src/screen-framework/widgets/MenuWidget.jsx`

**Step 1: Strip all autoplay code from MenuWidget**

Remove these elements:
1. The `parseAutoplayParams` import (line 8)
2. The `PlayerOverlayLoading` import (line 7)
3. The `TV_ACTIONS` constant (line 12)
4. The `autoplay` useMemo in `MenuWidget` (lines 37-40)
5. The `isQueueOrPlay` useMemo (lines 42-46)
6. The early-return spinner guard `if (!list && isQueueOrPlay)` (lines 58-60)
7. The `autoplay` prop passed to `MenuWidgetContent` (line 69)
8. In `MenuWidgetContent`: the `autoplay` prop, `autoplayed` state, the autoplay useEffect (lines 101-124), and the loading guard (lines 127-129)

The resulting `MenuWidget` should be:

```jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import { MenuSkeleton } from '../../modules/Menu/MenuSkeleton.jsx';
import { usePlaybackBroadcast } from '../../hooks/media/usePlaybackBroadcast.js';
import { getChildLogger } from '../../lib/logging/singleton.js';

function MenuWidget({ source }) {
  const [list, setList] = useState(null);
  const logger = useMemo(() => getChildLogger({ widget: 'menu' }), []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI(`api/v1/list/watchlist/${source}/recent_on_top`);
      setList(data);
      logger.info('menu-widget.data-loaded', { source, count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [source, logger]);

  if (!list) {
    return <MenuSkeleton />;
  }

  return <MenuWidgetContent rootMenu={list} logger={logger} />;
}

function MenuWidgetContent({ rootMenu, logger }) {
  const { currentContent } = useMenuNavigationContext();
  const playerRef = useRef(null);

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

  return <MenuStack rootMenu={rootMenu} playerRef={playerRef} />;
}

export default MenuWidget;
```

**Step 2: Verify the cleanup compiles**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/widgets/MenuWidget.jsx
git commit -m "fix(screen): remove duplicate autoplay from MenuWidget — ScreenAutoplay is sole owner"
```

---

### Task 3: Reduce overlay-summary log spam

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`

The `playback.overlay-summary` event fires every 1 second unconditionally. When video is playing normally (`vis:n/a/0ms`, `status:playing`), this generates ~60 log lines per minute with no diagnostic value — it drowned out the actual bug signal in the logs.

**Step 1: Find the overlay-summary logging interval**

```bash
grep -n 'overlay-summary' frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
```

**Step 2: Suppress logging when overlay is invisible and status is playing**

Add a condition: only emit the summary when the overlay is visible OR the status is not `playing`. When invisible and playing, skip the log. This preserves diagnostics during actual overlay events (startup, stall, seek) while eliminating the noise during normal playback.

The exact implementation depends on the current code structure — find where the 1-second interval emits and add the guard.

**Step 3: Verify logs are quieter during normal playback**

Start a video, check prod logs for `overlay-summary`. Should see logs during startup/transition, then silence during normal playback.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
git commit -m "fix(player): suppress overlay-summary log spam during normal playback"
```

---

### Task 4: Manual smoke test on Shield TV

**Step 1: Deploy to prod**

User runs `deploy.sh` manually.

**Step 2: Force-reload FKB**

```bash
FULLY_PW='<rotated-fkb-password-urlencoded>'
curl -s "http://10.0.0.11:2323/?cmd=loadStartURL&password=${FULLY_PW}"
```

**Step 3: Verify no spinner overlay during autoplay**

Watch the TV. Video should start playing without a 30-second stale spinner on top.

**Step 4: Check prod logs**

```bash
ssh homeserver.local 'docker logs daylight-station 2>&1' | grep -E 'autoplay|overlay-summary|player-no-source' | tail -20
```

Expected:
- `screen-autoplay.parsed` appears once
- `menu-widget.autoplay` does NOT appear (removed)
- No `player-no-source-timeout` errors
- `overlay-summary` logs only during startup, not during normal playback
