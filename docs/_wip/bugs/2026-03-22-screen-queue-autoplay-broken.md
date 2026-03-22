# Bug: Screen queue autoplay passes wrong type to Player, bypassing day-filtered programs

**Date:** 2026-03-22
**Severity:** Medium — autoplay silently fails; screen falls back to menu display
**Area:** Screen Framework → Player

## Symptom

Kitchen button 2 triggers `automation.kitchen_button_2_music`, which loads:
```
/tv?queue=music-queue&shader=dark&volume=10&shuffle=1
```

Expected: the `program:music-queue` resolves through the backend queue API, applies day-of-week filtering (Sunday → Inspirational, M/W/F → Classical, etc.), and plays the correct playlist.

Actual: day filtering never runs. The screen falls back to its menu, where a `menus/music.yml` entry gets selected (via `menu-selection` source), playing from the static 3-item music menu (이루마, Classical, Tab Choir) regardless of day.

## Root Cause

**`ScreenActionHandler.jsx:89`** wraps `contentId` in a **string array**:

```jsx
// ScreenActionHandler.jsx:87-92
const handleMediaQueue = useCallback((payload) => {
    showOverlay(Player, {
      queue: [payload.contentId],   // ← BUG: ["music-queue"] (string array)
      clear: () => dismissOverlay(),
    });
}, [showOverlay, dismissOverlay]);
```

**`useQueueController.js:38`** tries to extract `contentRef` from the queue prop:

```js
const contentRef = play?.contentId || queue?.contentId   // array has no .contentId → undefined
    || play?.plex || queue?.plex                          // undefined
    || play?.playlist || play?.queue                      // undefined
    || queue?.playlist || queue?.queue || queue?.media     // undefined
    || null;                                              // → null
```

Since `queue` is `["music-queue"]` (array of strings), none of the property accesses match. `contentRef` = `null`.

At line 106, the API call is guarded by `if (contentRef)` — so the queue API (`GET /api/v1/queue/music-queue`) is **never called**. The backend's `ListAdapter._matchesToday()` day filtering never runs.

Instead, the code hits line 103:
```js
} else if (Array.isArray(queue)) {
    newQueue = queue.map(item => ({ ...item, guid: guid() }));
}
```

Spreading a string (`"music-queue"`) into an object produces `{ 0: "m", 1: "u", 2: "s", ... }` — a garbage queue item. The Player has nothing valid to play, so the screen shows its default menu. The `menus/music.yml` (3 static items, no day filter) is visible and gets selected.

## Call Chain

```
HA automation → kitchen_button_2.yaml
  → script.livingroom_tv_sequence(query="queue=music-queue&shader=dark&volume=10&shuffle=1")
    → WakeAndLoadService → FullyKioskContentAdapter.load("/tv", query)
      → FullyKiosk navigates to: https://daylightlocal.kckern.net/tv?queue=music-queue&shader=dark&volume=10&shuffle=1

Frontend:
  ScreenAutoplay.parseAutoplayParams → { queue: { contentId: "music-queue", shader: "dark", ... } }
    → ActionBus.emit("media:queue", { contentId: "music-queue", ... })
      → ScreenActionHandler.handleMediaQueue
        → showOverlay(Player, { queue: ["music-queue"] })    ← string array, loses all config
          → useQueueController({ queue: ["music-queue"] })
            → contentRef = null                               ← can't extract from string array
            → API never called                                ← day filter never runs
            → queue = [{ 0:"m", 1:"u", ... }]               ← garbage from string spread
```

## Fix

`ScreenActionHandler.jsx:89` — pass the full payload as an object instead of wrapping contentId in an array:

```jsx
// Before (broken)
queue: [payload.contentId],

// After (fixed)
queue: { contentId: payload.contentId, ...payload },
```

This lets `useQueueController` extract `contentRef` from `queue.contentId`, call the backend queue API, and get day-filtered results from `program:music-queue`.

## Files

| File | Line | Role |
|------|------|------|
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | 89 | **Bug site** — wraps contentId in array |
| `frontend/src/modules/Player/hooks/useQueueController.js` | 38, 103-108 | Expects object, gets string array |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | 78 | Emits correct object payload to ActionBus |
| `backend/src/1_adapters/content/list/ListAdapter.mjs` | 1210-1216 | Day filter logic (never reached) |

## Data Files

| File | Purpose |
|------|---------|
| `data/household/config/lists/programs/music-queue.yml` | Day-filtered program (4 entries by day) |
| `data/household/config/lists/menus/music.yml` | Static menu (3 entries, no day filter) — fallback that plays instead |

## Notes

- The `media:play` path in ScreenActionHandler (line 82) has the same pattern but passes `play: payload.contentId` (a string), which `useQueueController` also can't extract `contentRef` from — likely the same bug for single-play autoplay.
- The config modifiers (`shader`, `volume`, `shuffle`) from the URL params are also lost because `handleMediaQueue` only passes `payload.contentId` into the array, discarding the rest of the payload object.
