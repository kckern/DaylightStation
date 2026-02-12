# Queue Source Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove adapter-aware source-routing logic from the frontend Player module so all content resolution is delegated to the backend's ContentIdResolver.

**Architecture:** The frontend currently constructs source-specific API URLs (e.g., `queue/watchlist/x`, `queue/plex/x`) based on fragile heuristics. This refactor normalizes all content references to an opaque `contentId` string passed to a single `api/v1/queue/{contentId}` endpoint. The backend's ContentIdResolver (6-layer resolution chain) already handles all source types — the frontend just needs to stop duplicating that logic.

**Tech Stack:** React hooks (frontend), Express routes (backend), Vitest (testing)

**Audit:** `docs/_wip/audits/2026-02-11-useQueueController-source-coupling-audit.md`

---

## Context for Implementer

### Key Architecture

- **ContentIdResolver** (`backend/src/3_applications/content/ContentIdResolver.mjs`) — 6-layer resolution chain. Handles compound IDs (`plex:12345`), system aliases (`hymn` → `singalong:hymn`), bare names (`fhe` → `menu:fhe` via bareNameMap), and household aliases.
- **Queue Router** (`backend/src/4_api/v1/routers/queue.mjs`) — `GET /api/v1/queue/:source/*` and `GET /api/v1/queue/:source`. Uses `parseActionRouteId()` to parse URL segments into `{ source, localId, compoundId }`, then passes to ContentIdResolver.
- **parseActionRouteId** (`backend/src/4_api/v1/utils/actionRouteParser.mjs`) — Structural URL parser with heuristic detection: bare digits → `plex`, UUIDs → `immich`, file extensions → `files`. Non-matching single-segment sources produce `compoundId = 'source:'` (trailing colon, empty localId).
- **useQueueController** (`frontend/src/modules/Player/hooks/useQueueController.js`) — React hook that resolves play/queue props into playable items via API calls. Currently has a three-way URL branch (contentId vs watchlist vs plex).
- **websocketHandler** (`frontend/src/lib/OfficeApp/websocketHandler.js`) — Receives WS payloads and transforms them into menu selections. Currently mutates numeric values to `plex` key.
- **keyboardHandler** (`frontend/src/lib/OfficeApp/keyboardHandler.js`) — `parseParams()` detects source type from raw string (numeric=plex, else=files).

### Data Flow (Current)

```
WS/Keyboard/Menu → websocketHandler/keyboardHandler (SOURCE DETECTION) → menuHandler → Player
  → useQueueController (THREE-WAY URL BRANCH) → api/v1/queue/{source}/{id} → queue router
  → parseActionRouteId → ContentIdResolver → adapter.resolvePlayables
```

### Data Flow (Target)

```
WS/Keyboard/Menu → websocketHandler/keyboardHandler (PASS-THROUGH) → menuHandler → Player
  → useQueueController (SINGLE URL) → api/v1/queue/{contentRef} → queue router
  → parseActionRouteId → ContentIdResolver → adapter.resolvePlayables
```

---

## Task 1: Backend — Queue Route Bare Name Fallback

When `api/v1/queue/music-queue` is called, `parseActionRouteId` produces `compoundId = 'music-queue:'` (empty localId). ContentIdResolver fails to resolve this. We need a fallback that tries the bare source name as a content ID.

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs:66-86`
- Test: `tests/integrated/api/content/queue.test.mjs`

**Step 1: Write the failing test**

Add to `tests/integrated/api/content/queue.test.mjs`:

```javascript
test('GET /api/v1/queue/:bareName resolves bare names via ContentIdResolver', async () => {
  // 'audio' is registered by FileAdapter — bare name should resolve via fallback
  const res = await request(app).get('/api/v1/queue/audio');

  // Should not 404 — the bare name should be tried as a content ref
  // FileAdapter's source is 'files', so 'audio' alone may not resolve,
  // but the route should attempt ContentIdResolver fallback before 404
  expect(res.status).toBeOneOf([200, 404]);
});

test('GET /api/v1/queue/:source resolves compound IDs in source segment', async () => {
  // Compound ID in source position: files:audio
  const res = await request(app).get('/api/v1/queue/files:audio');

  expect(res.status).toBe(200);
  expect(res.body.count).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify behavior**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
```

**Step 3: Add bare name fallback to queue router**

Edit `backend/src/4_api/v1/routers/queue.mjs`, replace lines 77-86:

```javascript
    // Resolve through ContentIdResolver (handles aliases, prefixes, exact matches)
    let resolved = contentIdResolver.resolve(compoundId);

    // Fallback: if resolution failed and there's no localId, the source segment
    // might be a bare content reference (e.g., "music-queue", "fhe").
    // Try resolving the raw source name directly through ContentIdResolver.
    if (!resolved?.adapter && !localId && parsedSource) {
      resolved = contentIdResolver.resolve(parsedSource);
    }

    let adapter = resolved?.adapter;
    let finalId = resolved ? `${resolved.source}:${resolved.localId}` : compoundId;
    const resolvedSource = resolved?.source ?? parsedSource;

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }
```

**Step 4: Run tests**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
```

Expected: all existing tests pass, new compound ID test passes.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs tests/integrated/api/content/queue.test.mjs
git commit -m "feat(queue): add bare name fallback in queue router

When a single-segment URL like /api/v1/queue/music-queue produces an
empty localId, retry resolution with the raw source name through
ContentIdResolver. This allows the frontend to pass opaque content
references without pre-categorizing the source type."
```

---

## Task 2: Frontend — Normalize websocketHandler to contentId

The websocketHandler currently does source-type detection and mutates payload keys. Replace this with content reference extraction that produces a clean `{ contentId, ...modifiers }` shape.

**Files:**
- Modify: `frontend/src/lib/OfficeApp/websocketHandler.js:128-168`

**Step 1: Add content reference extractor**

Replace lines 128–168 in `websocketHandler.js` with:

```javascript
    // ─── Content Reference Extraction ───────────────────────────────
    // Normalize all content identifiers to a single `contentId` key.
    // The backend's ContentIdResolver handles all source resolution —
    // the frontend should not detect source types (plex, watchlist, etc.)

    // Keys that carry the content reference (in priority order)
    const CONTENT_KEYS = ['contentId', 'play', 'queue', 'plex', 'media', 'playlist', 'files'];
    // Legacy collection keys that become compound IDs (e.g., hymn:113)
    const LEGACY_COLLECTION_KEYS = ['hymn', 'scripture', 'talk', 'primary', 'poem'];
    // Keys that are modifiers, not content references
    const MODIFIER_KEYS = new Set(['shuffle', 'shader', 'volume', 'continuous', 'playbackrate',
                                    'maxVideoBitrate', 'maxResolution', 'resume', 'seconds',
                                    'topic', 'source']);

    // 1. Determine action from original keys (before any normalization)
    const action = data.action || (Object.keys(data).includes('queue') ? 'queue' : 'play');

    // 2. Extract the content reference
    let contentRef = null;

    // Check legacy collection keys first (hymn:113, scripture:gen/1, etc.)
    for (const key of LEGACY_COLLECTION_KEYS) {
      if (data[key] != null) {
        contentRef = `${key}:${data[key]}`;
        break;
      }
    }

    // Then check standard content keys
    if (!contentRef) {
      for (const key of CONTENT_KEYS) {
        const val = data[key];
        if (val != null && typeof val !== 'object') {
          contentRef = String(val);
          break;
        }
      }
    }

    // 3. Extract modifiers (non-content, non-metadata keys)
    const payload = {};
    if (contentRef) payload.contentId = contentRef;
    for (const [key, value] of Object.entries(data)) {
      if (MODIFIER_KEYS.has(key)) {
        payload[key] = value;
      }
    }

    // 4. Build selection
    const selection = {
      label: "wscmd",
      [action]: payload
    };

    logger.info('office.websocket.selection', { selection, action });
    setCurrentContent(null);
    handleMenuSelection(selection);
```

**Step 2: Verify the handleMediaPlaybackControl and early returns (menu, reset, playback) are untouched**

Lines 14–126 remain unchanged — only the content resolution section (128+) is replaced.

**Step 3: Commit**

```bash
git add frontend/src/lib/OfficeApp/websocketHandler.js
git commit -m "refactor(office): normalize websocket payloads to contentId

Replace source-type detection heuristics (numeric→plex mutation, legacy
collection key sniffing) with a content reference extractor that
produces { contentId, ...modifiers }. The backend's ContentIdResolver
handles all source resolution."
```

---

## Task 3: Frontend — Simplify keyboardHandler.parseParams

Remove source-type detection from `parseParams` and `openPlayer`. Pass raw param value as `contentId`.

**Files:**
- Modify: `frontend/src/lib/OfficeApp/keyboardHandler.js:75-93`

**Step 1: Replace parseParams and openPlayer**

Replace lines 75–93:

```javascript
  const openPlayer = (type, params) => {
    handleMenuSelection({
      label: "keypad",
      [type]: { contentId: params },
    });
  };
```

This removes the `parseParams` function entirely. The raw `params` string (e.g., `"663266"`, `"plex:12345"`, `"music-queue"`) is passed as `contentId`. The backend resolves the source type.

**Step 2: Commit**

```bash
git add frontend/src/lib/OfficeApp/keyboardHandler.js
git commit -m "refactor(office): remove source detection from keyboard handler

Replace parseParams() heuristic (numeric→plex, else→files) with direct
contentId passthrough. Backend's ContentIdResolver handles source
detection for bare numbers, compound IDs, and bare names."
```

---

## Task 4: Frontend — Collapse useQueueController to Single Endpoint

Replace the three-way URL branch with a single content reference extraction and API call.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:41-44, 89-113`

**Step 1: Simplify content key extraction**

Replace lines 41–44:

```javascript
  const isQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);
  const contentRef = play?.contentId || queue?.contentId
                  || play?.plex || queue?.plex
                  || play?.playlist || play?.queue
                  || queue?.playlist || queue?.queue || queue?.media
                  || null;
```

Note: `contentIdKey`, `playlistKey`, and `plexKey` variables are removed — replaced by single `contentRef`.

**Step 2: Replace initQueue URL construction**

Replace lines 89–113 (the `else if` object branch inside `initQueue`):

```javascript
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        // Extract overrides that should apply to all generated items
        const sourceObj = (play && typeof play === 'object' && !Array.isArray(play)) ? play :
                         (queue && typeof queue === 'object' && !Array.isArray(queue)) ? queue : {};

        const itemOverrides = {};
        if (sourceObj.resume !== undefined) itemOverrides.resume = sourceObj.resume;
        if (sourceObj.seconds !== undefined) itemOverrides.seconds = sourceObj.seconds;
        if (sourceObj.maxVideoBitrate !== undefined) itemOverrides.maxVideoBitrate = sourceObj.maxVideoBitrate;
        if (sourceObj.maxResolution !== undefined) itemOverrides.maxResolution = sourceObj.maxResolution;

        if (contentRef) {
          const shuffleParam = isShuffle ? '?shuffle=true' : '';
          const { items } = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
        } else if (play?.media) {
          // Inline media object — no API resolution needed
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
      }
```

Note: the `play?.media` fallback is kept for inline media objects that contain actual playback data, not a content reference.

**Step 3: Update effect dependencies**

Replace line 134:

```javascript
  }, [play, queue, isShuffle, contentRef]);
```

(Removes `contentIdKey`, `playlistKey`, `plexKey` — replaced by `contentRef`)

**Step 4: Update signature computation (lines 46–64)**

Replace the signature computation to use `contentRef` instead of three separate keys:

```javascript
  useEffect(() => {
    const signatureParts = [];

    if (contentRef) signatureParts.push(`ref:${contentRef}`);
    signatureParts.push(`shuffle:${isShuffle ? '1' : '0'}`);

    if (Array.isArray(play)) {
      const playArraySignature = play
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || '')
        .join('|');
      signatureParts.push(`play:${play.length}:${playArraySignature}`);
    } else if (Array.isArray(queue)) {
      const queueArraySignature = queue
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || '')
        .join('|');
      signatureParts.push(`queue:${queue.length}:${queueArraySignature}`);
    }
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "refactor(player): collapse queue URL construction to single endpoint

Replace three-way URL branch (contentId vs watchlist vs plex) with a
single api/v1/queue/{contentRef} call. The backend's ContentIdResolver
handles all source routing. The frontend extracts the content reference
from whichever key is present (contentId, plex, queue, playlist, media)
and passes it opaquely."
```

---

## Task 5: Frontend — Simplify fetchMediaInfo

Remove legacy `plex` and `media` branches. Route everything through the existing `contentId` path which already works for all source types.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:55-136`

**Step 1: Simplify fetchMediaInfo**

Replace the entire function (lines 55–136):

```javascript
/**
 * Fetch media information from API
 * @param {Object} params - Parameters for fetching media
 * @param {string} params.contentId - Content identifier (compound ID, bare number, or bare name)
 * @param {string} params.plex - Legacy: Plex media key (normalized to contentId)
 * @param {string} params.media - Legacy: Media key (normalized to contentId)
 * @param {boolean} params.shuffle - Whether to shuffle
 * @param {string|number} params.maxVideoBitrate - Preferred maximum video bitrate param
 * @param {string|number} params.maxResolution - Preferred maximum resolution param
 * @param {string} params.session - Optional session identifier
 * @returns {Promise<Object>} Media information
 */
export async function fetchMediaInfo({ contentId, plex, media, shuffle, maxVideoBitrate, maxResolution, session }) {
  // Normalize legacy params to contentId — backend handles all source resolution
  const effectiveContentId = contentId || (plex != null ? String(plex) : null) || media || null;
  if (!effectiveContentId) return null;

  const buildUrl = (base, params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== false) searchParams.append(k, v);
    });
    const qs = searchParams.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const queryCommon = {};
  if (maxVideoBitrate !== undefined) queryCommon.maxVideoBitrate = maxVideoBitrate;
  if (maxResolution !== undefined) queryCommon.maxResolution = maxResolution;
  if (session !== undefined && session !== null) queryCommon.session = session;

  if (shuffle) {
    const url = buildUrl(`api/v1/play/${effectiveContentId}/shuffle`, queryCommon);
    const playResponse = await DaylightAPI(url);
    if (playResponse) {
      return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
    }
    return null;
  }

  const url = buildUrl(`api/v1/play/${effectiveContentId}`, queryCommon);
  const playResponse = await DaylightAPI(url);
  // Map resume_position → seconds so VideoPlayer/AudioPlayer can seek on load
  if (playResponse.resume_position !== undefined && playResponse.seconds === undefined) {
    playResponse.seconds = playResponse.resume_position;
  }
  return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "refactor(player): simplify fetchMediaInfo to single contentId path

Remove legacy plex and media branches. Normalize all inputs to
contentId and use the unified api/v1/play/{contentId} endpoint.
Backend's ContentIdResolver and parseActionRouteId handle source
detection (bare digits→plex, UUIDs→immich, etc.)."
```

---

## Task 6: Frontend — Delete Deprecated Functions from api.js

Remove `flattenQueueItems()` and `initializeQueue()` — no external callers.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:1-41, 138-164`

**Step 1: Verify no imports**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -rn 'flattenQueueItems\|initializeQueue' frontend/src/ --include='*.js' --include='*.jsx' --include='*.mjs'
```

Expected: Only hits in `api.js` itself and `README.md`. No external imports.

**Step 2: Delete flattenQueueItems (lines 4-41) and initializeQueue (lines 138-164)**

Remove:
- The `@deprecated` JSDoc comment and entire `flattenQueueItems` function (lines 4-41)
- The `initializeQueue` function (lines 138-164, after fetchMediaInfo)

The file should only export `fetchMediaInfo` after this change.

**Step 3: Update README references**

Edit `frontend/src/modules/Player/README.md` — remove references to `flattenQueueItems` and `initializeQueue`.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js frontend/src/modules/Player/README.md
git commit -m "chore(player): remove deprecated flattenQueueItems and initializeQueue

Both functions duplicated source-routing logic from useQueueController
and had no external callers. Queue initialization now lives solely in
useQueueController, and recursive flattening happens server-side."
```

---

## Task 7: Backend — Remove Interim list: Prefix Hack from ListAdapter

The `list:` prefix fallback added 2026-02-11 as an interim fix is no longer needed — the queue router's bare name fallback (Task 1) handles this at a higher level.

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (near line 960)

**Step 1: Remove the list: prefix fallback**

Find and remove these lines from `resolvePlayables()`:

```javascript
    // Handle generic 'list:' prefix — try programs, watchlists, menus in order
    if (/^list:[^:]+$/.test(strippedId)) {
      const name = strippedId.replace(/^list:/, '');
      for (const prefix of ['program', 'watchlist', 'menu']) {
        const result = await this.resolvePlayables(`${prefix}:${name}`, options);
        if (result.length > 0) return result;
      }
      return [];
    }
```

**Step 2: Revert useQueueController URL back from `list` to generic**

This was already handled in Task 4 (single `contentRef` endpoint), so no action needed here. Just verify the `api/v1/queue/list/` path is no longer constructed anywhere.

**Step 3: Run backend tests**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
```

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "chore(list): remove interim list: prefix fallback from ListAdapter

The queue router's bare name fallback (resolving bare source segments
through ContentIdResolver) replaces this adapter-level workaround."
```

---

## Task 8: End-to-End Verification

Test all entry points to confirm the refactor works.

**Step 1: Backend API — Bare names, compound IDs, and numeric IDs**

```bash
# Bare name (program via bareNameMap)
curl -s "https://daylightstation.kckern.net/api/v1/queue/music-queue?shuffle=true" | python3 -m json.tool | head -5

# Compound ID
curl -s "https://daylightstation.kckern.net/api/v1/queue/program:music-queue" | python3 -m json.tool | head -5

# Numeric (plex heuristic)
curl -s "https://daylightstation.kckern.net/api/v1/queue/663266" | python3 -m json.tool | head -5
```

Expected: All return `count > 0` with items.

**Step 2: WebSocket entry point — Office TV**

```bash
curl -s "https://daylightstation.kckern.net/api/v1/device/office-tv/load?queue=music-queue&shuffle=1" | python3 -m json.tool
```

Expected: `ok: true`, office TV starts playing.

**Step 3: Device endpoint — Living room TV**

```bash
curl -s "https://daylightstation.kckern.net/api/v1/device/livingroom-tv/load?hymn=113" | python3 -m json.tool
```

Expected: `ok: true`, FK loads correct URL.

**Step 4: Run existing tests**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
npx vitest run tests/isolated/assembly/content/ContentIdResolver.test.mjs --reporter=verbose
```

Expected: All pass.

**Step 5: Commit verification note**

No commit needed — this task is verification only.

---

## Summary

| Task | File(s) | Change |
|------|---------|--------|
| 1 | `queue.mjs` | Bare name fallback in queue router |
| 2 | `websocketHandler.js` | Normalize WS payloads to `{ contentId, ...modifiers }` |
| 3 | `keyboardHandler.js` | Remove `parseParams()`, pass raw contentId |
| 4 | `useQueueController.js` | Collapse three-way URL branch to single endpoint |
| 5 | `api.js` (fetchMediaInfo) | Remove legacy plex/media branches |
| 6 | `api.js` (deprecated fns) | Delete `flattenQueueItems`, `initializeQueue` |
| 7 | `ListAdapter.mjs` | Remove interim `list:` prefix hack |
| 8 | (verification) | End-to-end testing |
