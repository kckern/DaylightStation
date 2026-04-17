# Playback Logging & CFM Scripture Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `scripture:cfm_kc` playback failure and add structured logging to the playback resolution pipeline so failures are diagnosable from logs alone.

**Architecture:** Two independent fixes: (1) The `cfm_kc` content is a reading plan, not a scripture volume — it can't be resolved by the ReadalongAdapter. The watchlist item needs a valid action type. (2) The playback pipeline has three logging gaps: `playback.intent` doesn't log the content ID, queue/play API errors aren't logged structurally, and the player doesn't emit a `playback.error` event when resolution fails.

**Tech Stack:** React (frontend), Express (backend), structured logging framework (`frontend/src/lib/logging/`)

---

## Problem Analysis

### CFM Playback Failure

The `scripture:cfm_kc` item in the scripture watchlist resolves through this chain:

1. Watchlist `data/household/config/lists/watchlists/scripture.yml` has `input: 'scripture: cfm_kc'`
2. The list router returns it with `id: "scripture:cfm_kc"` and a `play` action
3. Frontend auto-selects it (3s timeout), calls `api/v1/queue/scripture:cfm_kc`
4. `ContentIdResolver` Layer 2 matches `scripture` prefix via `content-prefixes.yml` alias: `scripture: readalong:scripture`
5. This routes to `ReadalongAdapter` with `localId: "scripture/cfm_kc"`
6. `ReadalongAdapter.getItem('scripture/cfm_kc')` → 404 (no such volume — only `bom`, `nt`, `ot`, `dc`, `pgp` exist)

**Root cause:** `cfm_kc` is a "Come Follow Me" reading plan, not a scripture volume. It maps to `CFMScripture_KC` in `data/household/config/media-app.yml` under the `scripture:` config key. This was likely a legacy content type that hasn't been wired into the new content adapter system.

**Fix options:**
- **(A) Remove `cfm_kc` from the scripture watchlist** if it's no longer functional
- **(B) Create a `cfm_kc` resolver** in the readalong adapter that maps it to an actual reading plan
- **(C) Change the watchlist item to point to a valid content ID** (e.g., a Plex library or a different list)

**Recommended: Option A** — remove the broken item from the watchlist. If CFM needs to come back, it should be wired up properly as its own adapter or reading plan feature. The other scripture items (bom, nt) work because they're actual volume directories.

### Logging Gaps

Three specific gaps made this failure hard to diagnose:

1. **`playback.intent` missing content ID** — `MenuStack.jsx:109` logs `title`, `mediaKey`, etc. from the selection object, but for auto-timeout selections from watchlist items, these fields are undefined. The item's `play.contentId` or `queue.contentId` is never logged.

2. **No structured `playback.error` on API failure** — When `fetchMediaInfo` or `useQueueController.initQueue()` gets a 404, it falls through to an unhandled rejection. The only trace is a raw `console.error` and `unhandledrejection` event — no structured event with the content ID, source, and error.

3. **Backend `queue.resolve` logs success but not the content ID on failure** — The queue router logs `queue.resolve` with count=0 but the item router's 404 response isn't logged as a structured event (only the HTTP response body).

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `data/household/config/lists/watchlists/scripture.yml` | Modify (container) | Remove broken `cfm_kc` item |
| `frontend/src/modules/Menu/MenuStack.jsx` | Modify | Add `contentId` to `playback.intent` log |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Modify | Add structured `playback.resolve-failed` log on API error |
| `frontend/src/modules/Player/lib/api.js` | Modify | Add structured `playback.fetch-failed` log on fetchMediaInfo error |
| `backend/src/4_api/v1/routers/play.mjs` | Modify | Add structured `play.item.not_found` log on 404 |
| `backend/src/4_api/v1/routers/queue.mjs` | Modify | Add structured `queue.item.not_found` log on 404 |

---

### Task 1: Remove broken `cfm_kc` from scripture watchlist

**Files:**
- Modify: `data/household/config/lists/watchlists/scripture.yml` (inside Docker container)

- [ ] **Step 1: Read current watchlist**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/lists/watchlists/scripture.yml'
```

- [ ] **Step 2: Write updated watchlist without `cfm_kc` entry**

Remove the item with `input: 'scripture: cfm_kc'`. Write the full file via heredoc:

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/lists/watchlists/scripture.yml << 'WATCHEOF'
- first: true
  label: Commentary
  playbackrate: 2
  input: 'plex: 177777'
  action: List
  uid: ab83f5d1-5924-440f-ad45-de5870c33e4d
- shuffle: true
  playable: true
  playbackrate: 2
  input: 'plex: 242567'
  label: BoM Theology
  uid: 294ba59f-a820-46cf-834d-6e2668a184a0
- label: Book of Mormon
  image: <keep existing image URL>
  input: 'scripture: bom'
  uid: 93fbaf31-efc9-46da-a726-f3f0c1f31e6a
- label: New Testament
  image: <keep existing image URL>
  input: 'scripture: nt'
  uid: 2cd931c9-9511-4f3b-9cba-4ada7359c7f1
- label: Sermon on the Mount
  input: 'plex: 649053'
  playbackrate: 2
  uid: 675bca3e-fddb-4b23-81c0-312f8972a19f
- label: Historical Jesus
  playbackrate: 2
  input: 'plex: 454091'
  uid: c0981018-9b84-484c-aca1-f24c1d6c34ef
- playbackrate: 2
  input: 'plex: 47229'
  action: List
  label: Zondervan
  uid: 855cc636-19a4-4352-b0c4-817a3eb09585
- shuffle: true
  input: 'plex: 418112'
  label: Chuck Smith
  playbackrate: 2
  uid: 55013f63-92d2-4387-9586-c378d6470b27
- label: Hyrum Andrus
  input: 'plex: 438291'
  playbackrate: 2
  uid: ef7eab56-06a8-4a87-a3c1-7ff5d751efc1
WATCHEOF"
```

**Note:** Preserve the exact image URLs from the original file — the URLs above are placeholders. Copy the full base64-encoded Infinity image URLs from the current file.

- [ ] **Step 3: Verify the file was written correctly**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/lists/watchlists/scripture.yml'
```

Confirm: 9 items (was 10), no `cfm_kc` entry.

- [ ] **Step 4: Test the watchlist loads correctly**

```bash
curl -s http://localhost:3111/api/v1/list/watchlist/scripture | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Items: {len(d[\"items\"])}'); [print(f'  {i[\"id\"]} - {i[\"title\"]}') for i in d['items']]"
```

Expected: 9 items, no `scripture:cfm_kc`.

---

### Task 2: Add content ID to `playback.intent` log

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx:105-121`

- [ ] **Step 1: Read the current logging code**

Read `frontend/src/modules/Menu/MenuStack.jsx` lines 105-125 to confirm the current `playback.intent` log structure.

- [ ] **Step 2: Add contentId extraction to the playback.intent log**

The issue is that `media.title`, `media.assetId`, etc. are undefined for watchlist items. The content ID lives in `selection.play.contentId` or `selection.queue.contentId` (or the first array element). Add it:

In `frontend/src/modules/Menu/MenuStack.jsx`, replace the `playback.intent` logging block:

```javascript
    } else if (selection.play || selection.queue) {
      // Log playback intent - user initiated playback from menu
      const logger = getLogger();
      const media = selection.play || selection.queue?.[0] || selection;
      const contentId = media.contentId || media.plex || media.media || media.assetId || media.key || media.id;
      logger.info('playback.intent', {
        contentId,
        title: media.title || media.name || media.label || selection.label,
        artist: media.artist,
        album: media.album,
        grandparentTitle: media.grandparentTitle,
        parentTitle: media.parentTitle,
        mediaKey: media.assetId || media.key || media.plex || media.id,
        mediaType: media.type || media.mediaType,
        isQueue: !!selection.queue,
        queueLength: selection.queue?.length || 1,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'player', props: selection });
```

Key changes:
- Extract `contentId` explicitly (first priority: `media.contentId`)
- Add `contentId` as a top-level field in the log
- Add `selection.label` as fallback for title (watchlist items have label on the outer selection, not on the play object)

- [ ] **Step 3: Verify build**

```bash
cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx
git commit -m "fix(logging): add contentId to playback.intent event

The playback.intent log was missing the content ID for watchlist items
because it extracted fields from the play object (title, assetId) which
are undefined for watchlist selections. Add explicit contentId extraction
and use selection.label as title fallback."
```

---

### Task 3: Add structured error logging to `useQueueController`

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:173-179`

- [ ] **Step 1: Read the current error handling**

Read `frontend/src/modules/Player/hooks/useQueueController.js` lines 170-185.

The current code:
```javascript
    initQueue().catch((error) => {
      playbackLog('queue-init-failed', {
        contentRef,
        error: error?.message
      }, { level: 'error' });
```

This already logs `queue-init-failed` but the error message is the raw HTTP error string. It doesn't parse the structured error body from the API response.

- [ ] **Step 2: Enhance the error log with parsed API error details**

Replace the catch block in `useQueueController.js`:

```javascript
    initQueue().catch((error) => {
      // Parse structured error from API response (format: "HTTP 404: Not Found - {json}")
      let apiError = null;
      const dashIdx = error?.message?.indexOf(' - ');
      if (dashIdx > -1) {
        try { apiError = JSON.parse(error.message.slice(dashIdx + 3)); } catch {}
      }
      playbackLog('queue-init-failed', {
        contentRef,
        error: error?.message,
        apiSource: apiError?.source,
        apiLocalId: apiError?.localId,
        apiDetail: apiError?.error,
        httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1],
      }, { level: 'error' });
```

- [ ] **Step 3: Verify build**

```bash
cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "fix(logging): parse API error details in queue-init-failed event

When queue initialization fails with an API error, parse the structured
error body (source, localId, error message) so the failure reason is
visible in logs without needing to correlate with backend logs."
```

---

### Task 4: Add structured 404 logging to backend play router

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:263-265`

- [ ] **Step 1: Read the current 404 response**

Read `backend/src/4_api/v1/routers/play.mjs` lines 260-270. The current code:

```javascript
      const item = await adapter.getItem(finalLocalId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source: finalSource, localId: finalLocalId });
      }
```

- [ ] **Step 2: Add structured log before the 404 response**

```javascript
      const item = await adapter.getItem(finalLocalId);
      if (!item) {
        logger.warn?.('play.item.not_found', {
          compoundId,
          resolvedSource: finalSource,
          resolvedLocalId: finalLocalId,
          adapterSource: adapter.source,
          ip: req.ip
        });
        return res.status(404).json({ error: 'Item not found', source: finalSource, localId: finalLocalId });
      }
```

- [ ] **Step 3: Do the same for the "Unknown source" 404 at line 222-224**

```javascript
      if (!resolved?.adapter) {
        logger.warn?.('play.source.unknown', { compoundId, source, rawPath, ip: req.ip });
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "fix(logging): add structured play.item.not_found log on 404

The play router returned 404s without logging them, making playback
failures invisible in backend logs. Add warn-level structured events
for both unknown source and item-not-found cases."
```

---

### Task 5: Add structured 404 logging to backend queue router

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs:114-116`

- [ ] **Step 1: Read the current 404 responses in the queue router**

Read `backend/src/4_api/v1/routers/queue.mjs` lines 110-125.

- [ ] **Step 2: Add structured log before each 404 response**

For the "Unknown source" 404:
```javascript
    if (!adapter) {
      logger.warn?.('queue.source.unknown', { compoundId, source: resolvedSource, rawPath, ip: req.ip });
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }
```

For the "does not support queue resolution" 400:
```javascript
    if (!adapter.resolvePlayables) {
      logger.warn?.('queue.source.no_playables', { compoundId, source: resolvedSource, ip: req.ip });
      return res.status(400).json({
        error: 'Source does not support queue resolution',
        source: resolvedSource
      });
    }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs
git commit -m "fix(logging): add structured queue.source.unknown log on 404

The queue router returned 404/400 errors without logging them. Add
warn-level structured events so content resolution failures are visible
in backend logs."
```

---

### Task 6: Add structured error logging to `fetchMediaInfo`

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:15-51`

- [ ] **Step 1: Read the current code**

Read `frontend/src/modules/Player/lib/api.js`. Currently `fetchMediaInfo` has no error handling — errors propagate as unhandled rejections.

- [ ] **Step 2: Add try/catch with structured logging**

```javascript
import { DaylightAPI } from '../../../lib/api.mjs';
import { playbackLog } from './playbackLogger.js';

export async function fetchMediaInfo({ contentId, plex, media, shuffle, maxVideoBitrate, maxResolution, session, resume }) {
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
  if (resume === false) queryCommon.resume = 'false';

  try {
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
    if (playResponse.resume_position !== undefined && playResponse.seconds === undefined) {
      playResponse.seconds = playResponse.resume_position;
    }
    return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
  } catch (error) {
    playbackLog('fetch-media-failed', {
      contentId: effectiveContentId,
      shuffle: !!shuffle,
      error: error?.message,
      httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1],
    }, { level: 'error' });
    throw error; // re-throw so caller still handles it
  }
}
```

- [ ] **Step 3: Verify build**

```bash
cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "fix(logging): add structured fetch-media-failed log on API error

fetchMediaInfo had no error logging — failures only appeared as
unhandled rejections with raw error strings. Add a structured
playback log event with the content ID and HTTP status before
re-throwing."
```

---

## Verification

After all tasks:

1. **CFM fix:** Open the office screen menu, navigate to scripture — `Come Follow Me (KC)` should no longer appear.

2. **Logging coverage:** To verify the new logs work, intentionally trigger a 404 by requesting a nonexistent content ID:
```bash
curl -s http://localhost:3111/api/v1/play/readalong/scripture/nonexistent
```
Check backend logs for `play.item.not_found` event.

3. **No regressions:** Verify working scripture items still play:
```bash
curl -s http://localhost:3111/api/v1/queue/scripture:bom | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Queue items: {len(d[\"items\"])}')"
```
