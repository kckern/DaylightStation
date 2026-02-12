# useQueueController Source-Coupling Audit

**Date:** 2026-02-11
**Scope:** Frontend queue/play resolution logic in Player module
**Severity:** Medium — causes silent content resolution failures for non-watchlist sources

---

## Problem Statement

The frontend Player module contains adapter-aware routing logic that duplicates, contradicts, and circumvents the backend's ContentIdResolver. The frontend decides which backend source to query (plex, watchlist, files, etc.) based on fragile heuristics, when it should simply pass an opaque content identifier and let the backend resolve it.

This creates a class of bugs where valid content IDs silently fail because the frontend routes them to the wrong backend adapter. The `music-queue` program bug (routed to `watchlist:music-queue` instead of `program:music-queue`) is one example. Any new content source added to the backend requires parallel frontend changes in multiple files.

---

## Affected Files

| File | Lines | Issue |
|------|-------|-------|
| `frontend/src/modules/Player/hooks/useQueueController.js` | 93–106 | Hardcoded source routing: `contentId` vs `watchlist` vs `plex` |
| `frontend/src/modules/Player/lib/api.js` | 144–164 | Duplicate `initializeQueue()` with identical hardcoded `watchlist` source |
| `frontend/src/modules/Player/lib/api.js` | 8–41 | Deprecated `flattenQueueItems()` still hardcodes `watchlist` and `plex` paths |
| `frontend/src/modules/Player/lib/api.js` | 55–136 | `fetchMediaInfo()` branches on `contentId` vs `plex` vs `media` |
| `frontend/src/lib/OfficeApp/websocketHandler.js` | 128–156 | Source-type detection heuristics (numeric=plex, legacy keys=content) |
| `frontend/src/lib/OfficeApp/keyboardHandler.js` | 75–85 | `parseParams()` duplicates numeric=plex heuristic |

---

## Detailed Findings

### 1. Three-Way Branch in useQueueController (Critical)

**Location:** `useQueueController.js:93-106`

```javascript
if (queue_contentId && !queue_assetId && !plexKey) {
  queueUrl = `api/v1/queue/${queue_contentId}${shuffleParam}`;          // Path A
} else if (queue_assetId) {
  queueUrl = `api/v1/queue/list/${queue_assetId}${shuffleParam}`;       // Path B (was watchlist)
} else if (queue?.plex || play?.plex) {
  queueUrl = `api/v1/queue/plex/${plexId}${shuffleParam}`;             // Path C
}
```

The frontend extracts keys from the play/queue object and maps them to specific API paths:
- `contentId` → generic `/queue/{contentId}` (Path A — actually works)
- `playlist`/`queue`/`media` → `/queue/list/{name}` (Path B — was `watchlist`, patched today)
- `plex` → `/queue/plex/{id}` (Path C)

**Why this is wrong:** The backend's queue router already runs `contentIdResolver.resolve(compoundId)` on every request. It handles plex IDs, watchlists, programs, menus, content IDs, and bare names. The frontend's three-way branch is redundant and can produce wrong compound IDs.

**Bug caused:** `queue: 'music-queue'` was extracted as `queue_assetId` and sent to `api/v1/queue/watchlist/music-queue`, producing `watchlist:music-queue`. The backend faithfully looked in the watchlists directory and found nothing. The correct resolution (`program:music-queue`) was never attempted.

### 2. Duplicated initializeQueue in api.js

**Location:** `api.js:144-164`

```javascript
export async function initializeQueue(play, queue) {
  // ...nearly identical logic to useQueueController's initQueue()...
  const { items } = await DaylightAPI(`api/v1/queue/watchlist/${queueAssetId}${shuffleParam}`);
  // ...
}
```

This function contains the **same** `watchlist` hardcoding as `useQueueController` but was NOT patched today. It's marked as used elsewhere (unclear where), meaning the same bug class exists in a second code path. Any fix to `useQueueController` must be duplicated here.

### 3. Deprecated flattenQueueItems Still Referenced

**Location:** `api.js:8-41`

Marked `@deprecated` but still exported. Contains hardcoded `watchlist` and `plex` routing. If any code path still calls this, it has the same source-coupling bugs.

### 4. fetchMediaInfo Source Branching

**Location:** `api.js:55-136`

Three separate code paths:
- `contentId` → `/api/v1/play/{contentId}` (generic, correct approach)
- `plex` → `/api/v1/info/plex/{plex}` or `/api/v1/queue/plex/{plex}`
- `media` → manually parses compound ID, extracts source, calls `/api/v1/info/{source}/{localId}`

The `contentId` path already works generically. The `plex` and `media` paths are legacy duplications of what the backend already handles through the `contentId` path.

### 5. WebSocket Handler Source Detection

**Location:** `websocketHandler.js:128-156`

```javascript
const isPlaylistItem = (/^\d+$/.test(Object.values(data)[0]) || data.plex) && !isContentItem;
// ...
if (/^\d+$/.test(data.play || data.queue)) {
  data.plex = data.play || data.queue;
  delete data.play;
  delete data.queue;
}
```

The WebSocket handler sniffs payload values to determine source type:
- Numeric values → mutated to `plex` key
- Legacy keys (`hymn`, `scripture`, `talk`) → treated as content items
- Everything else → falls through as `queue`

This means the WS handler is doing content ID classification that the backend's ContentIdResolver already handles. A numeric Plex ID sent as `queue: '663266'` gets rewritten to `plex: '663266'`, which then goes to the `plex`-specific code path in `useQueueController`.

### 6. Keyboard Handler parseParams

**Location:** `keyboardHandler.js:75-85`

```javascript
const parseParams = (p) => {
  if (p?.includes?.(":")) {
    return p.split(":").map(s => s.trim());
  }
  if (/^\d+$/.test(p)) {
    return ["plex", p ?? ""];
  }
  return ["files", p ?? ""];
};
```

Duplicates the "numeric = plex" heuristic from the WS handler. Also defaults unknown values to `files`, which is another assumption about backend adapter types.

---

## Root Cause

The frontend was written before the backend's ContentIdResolver existed. Each entry point (keyboard, WebSocket, menu) independently implemented source-detection heuristics and URL-building logic. When ContentIdResolver was added to the backend, the frontend was never refactored to delegate resolution to it.

---

## Proposed Fix: Single Generic Queue Endpoint

### Principle

The frontend should treat content identifiers as **opaque strings**. It should pass them to a single backend endpoint and receive back resolved, playable items. No source detection, no URL branching, no adapter awareness.

### Target State

```javascript
// useQueueController.js — all three branches collapse to one
async function initQueue() {
  const contentRef = play?.contentId || play?.queue || play?.playlist || play?.plex
                  || queue?.contentId || queue?.queue || queue?.playlist || queue?.plex
                  || queue?.media;

  if (!contentRef && !Array.isArray(play) && !Array.isArray(queue)) return;

  if (Array.isArray(play)) {
    newQueue = play.map(item => ({ ...item, guid: guid() }));
  } else if (Array.isArray(queue)) {
    newQueue = queue.map(item => ({ ...item, guid: guid() }));
  } else {
    const params = new URLSearchParams();
    if (isShuffle) params.set('shuffle', 'true');
    const qs = params.toString();
    const { items } = await DaylightAPI(`api/v1/queue/${contentRef}${qs ? `?${qs}` : ''}`);
    newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
  }
}
```

### Backend Requirement

The queue route (`api/v1/queue/:source/*`) already uses ContentIdResolver. The only gap: bare names like `music-queue` need the `/:source` pattern to detect them as content IDs rather than source names. This is already handled by Layer 4a (bareNameMap) in ContentIdResolver — the issue is only that the queue route's `parseActionRouteId` doesn't invoke it for single-segment paths.

Options:
1. **Add a `/api/v1/queue/resolve/:id` route** that always passes through ContentIdResolver (cleanest)
2. **Modify `parseActionRouteId`** to treat unknown single-segment sources as bare content IDs
3. **Keep `list/` prefix** as a generic "search all list types" passthrough (today's interim fix)

### Migration Path

1. Add the generic queue resolution endpoint (backend)
2. Refactor `useQueueController` to use single endpoint (frontend)
3. Refactor `websocketHandler` to stop mutating payload keys (frontend)
4. Refactor `keyboardHandler.parseParams` to stop source detection (frontend)
5. Delete `initializeQueue()` and `flattenQueueItems()` from `api.js` (frontend)
6. Simplify `fetchMediaInfo()` to use `contentId` path only (frontend)

### Risk

- Low: all changes are in the frontend Player module
- The backend queue route + ContentIdResolver already handle all source types
- Migration can be incremental (one entry point at a time)

---

## Interim Fix Applied (2026-02-11)

Two changes made to unblock `music-queue` playback on office TV:

1. **`useQueueController.js:102`** — Changed `watchlist` to `list`
2. **`ListAdapter.mjs:resolvePlayables()`** — Added `list:` prefix fallback that tries program → watchlist → menu in order

This fixes the immediate bug but does not address the structural issue. `api.js:initializeQueue()` line 156 still hardcodes `watchlist` and will fail for programs if called.

---

## Files NOT Needing Changes

- `backend/src/4_api/v1/routers/queue.mjs` — Already delegates to ContentIdResolver
- `backend/src/3_applications/content/ContentIdResolver.mjs` — Already resolves all source types
- `frontend/src/modules/Player/Player.jsx` — Correctly delegates to useQueueController
- `frontend/src/lib/OfficeApp/menuHandler.js` — Just passes selections through, no source awareness
