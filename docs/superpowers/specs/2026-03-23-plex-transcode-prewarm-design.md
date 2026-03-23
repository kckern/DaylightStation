# Plex Transcode Pre-Warming for Device Load

**Date:** 2026-03-23
**Status:** Draft
**Trigger:** Slow TV loading on Shield TV showed 15s stall + player remount + overlay flickering

## Problem

When loading Plex DASH content via the device load API (`GET /device/:id/load?queue=slow-tv`), the first video stalls for ~15 seconds while Plex cold-starts the transcode session. The resilience system detects the stall, remounts the player, and the second attempt succeeds — but the user sees three distinct loading overlays and a visible flash during the remount.

**Timeline from logs (2026-03-23):**
1. `15:45:37` — device load triggered
2. `15:45:49` — prepare done, FKB loads URL
3. `15:45:53` — first overlay appears, immediately replaced by second (queue resolves)
4. `15:45:54–15:46:09` — 15s stuck at "Starting..." (DASH manifest loaded, no playable segments)
5. `15:46:09` — startup-deadline fires, player remounts (third overlay)
6. `15:46:14` — video finally plays on second attempt

**Root cause:** Plex transcode session doesn't start until the browser's DASH player requests `start.mpd`. By that point, the page has already spent 3-5s loading. Plex then needs time to begin producing segments, during which the player sits idle until the 15s deadline fires.

## Solution

Pre-warm the Plex transcode session on the backend during the wake-and-load flow, in parallel with the FKB page load. By the time the frontend DASH player mounts, segments are already available.

## Design

### Backend: TranscodePrewarmService

New service in `backend/src/3_applications/devices/services/`. Responsibilities:

1. **Resolve the queue** — reuse the same queue resolution path as `/api/v1/queue/:source` (content ID resolver + adapter + QueueService)
2. **Identify the first Plex item** — check `source === 'plex'` on item [0]; if not Plex, skip pre-warming
3. **Get watch state** — if the item has a playhead (partially watched), extract `resumePosition` for the transcode offset
4. **Call `PlexAdapter.loadMediaUrl()`** — creates the transcode session (decision API + session ID generation), returns the full DASH URL with session IDs baked in
5. **Fetch `start.mpd`** — a single GET to the MPD URL via the Plex proxy, forcing Plex to begin transcoding. Fire-and-forget; we don't need the response body.

**Interface:**
```javascript
class TranscodePrewarmService {
  /**
   * @param {string} contentRef - Queue content reference (e.g., "slow-tv", "plex:642120")
   * @param {Object} opts - { shuffle: boolean }
   * @returns {Promise<{ url: string, contentId: string } | null>}
   */
  async prewarm(contentRef, opts = {}) { ... }
}
```

Returns `{ url, contentId }` on success, `null` on failure or non-Plex content.

### Backend: WakeAndLoadService Changes

After step 4 (prepare) completes, run pre-warm **then** load sequentially:

```javascript
// --- Step 5: Pre-warm (best-effort) ---
const prewarm = await this.#prewarmIfPlex(contentQuery).catch(() => null);

// --- Step 6: Load Content (with prewarm params if available) ---
if (prewarm) {
  contentQuery.prewarmToken = prewarm.token;
  contentQuery.prewarmContentId = prewarm.contentId;
}
const loadResult = await device.loadContent(screenPath, contentQuery);
```

The pre-warm result is passed to the frontend via a **short token** (not the raw URL — see URL length section below):
- `prewarmToken=<short cache key>`
- `prewarmContentId=<e.g., plex:663135>`

**Sequence:**

1. Await pre-warm (3-5s for queue resolve + loadMediaUrl + MPD fetch)
2. Fire `loadURL` with prewarm params appended
3. FKB loads the page (3-5s) — during which Plex continues transcoding

This adds the pre-warm duration (~3-5s) to wall time before `loadURL`, but the total time-to-video is still shorter because the player won't stall for 15s + remount. Net savings: ~10-12s.

**Alternative (fire concurrently, pass via WebSocket):** Could fire `loadURL` immediately and send the prewarm URL to the frontend via WebSocket after it resolves. This avoids adding any latency to the load step but requires WebSocket coordination on the frontend. More complex, less reliable. Not recommended for v1.

### Backend: URL Length and Token-Based Transport

The Plex transcode URL is long (~500+ characters due to `X-Plex-Client-Profile-Extra` and other encoded params). Double-encoding it as a query param in the FKB `loadURL` could exceed practical URL length limits in FKB's REST API or Android WebView.

**Solution:** `TranscodePrewarmService` stores the pre-warmed URL in a server-side cache (in-memory Map with TTL ~60s) keyed by a short random token. Only the token is passed as a query param. The frontend redeems the token via a lightweight API call (`GET /api/v1/prewarm/:token`) to retrieve the full DASH URL.

This keeps the FKB URL short and avoids encoding issues. The token is single-use and expires quickly.

### Backend: FullyKioskContentAdapter Changes

The `load()` method already builds URL from path + query params. No changes needed — `prewarmToken` and `prewarmContentId` are just additional query params that pass through.

### Backend: DDD Layer Boundary

`TranscodePrewarmService` lives in `3_applications/devices/` but needs access to `PlexAdapter` in `1_adapters/content/`. This is resolved via dependency injection: the service receives a `mediaAdapter` (or specifically a `plexAdapter`) reference through its constructor, injected at bootstrap time by the DI container or service factory. The service depends on the adapter's public interface (`loadMediaUrl`), not its internals.

### Frontend: Extracting Pre-warm Params

At the page/screen level (where URL params are parsed and passed to the Player), extract `prewarm` and `prewarmContentId` from the URL search params and pass them down as props or context.

### Frontend: useQueueController Changes

After the queue resolves from the API (41 items with guids), check if `prewarmContentId` matches the first item's `contentId`. If so, inject:

1. If `prewarmToken` is present in URL params, call `GET /api/v1/prewarm/:token` to redeem the full DASH URL
2. Match `prewarmContentId` against the first queue item's `contentId`
3. If matched, inject onto the item:

```javascript
if (prewarmContentId && newQueue[0]?.contentId === prewarmContentId && prewarmUrl) {
  newQueue[0].mediaUrl = prewarmUrl;
  newQueue[0].format = 'dash_video';   // "format" triggers the direct-play bypass
  newQueue[0].mediaType = 'dash_video'; // for downstream consumers
}
```

If the contentId doesn't match (e.g., shuffle race condition), ignore the prewarm — fall back to normal flow.

**Note:** Queue items from `/api/v1/queue/` use the `plex:` prefixed format for `contentId` (e.g., `plex:663135`). The `prewarmContentId` must use the same format for matching.

### Frontend: SinglePlayer (no changes needed)

The existing direct-play bypass at lines 225-230 of `SinglePlayer.jsx` checks `play?.format` and `play?.mediaUrl`. When both are present and `format` is not a content renderer (readalong, singalong, etc.), it skips the `/play` API call and uses the URL directly.

**Edge case — recovery remounts:** The bypass is intentionally skipped when `isRecoveryRemount` is true (line 230). This means if the resilience system fires a remount even after pre-warming, the remount will call the `/play` API and create a new Plex session. This is correct behavior — a remount means the pre-warmed session failed, so a fresh session is appropriate.

### Session ID Handling

Plex session IDs (`X-Plex-Client-Identifier`, `X-Plex-Session-Identifier`) are generated by `PlexAdapter._generateSessionIds()` and baked into the transcode URL. The same URL used for pre-warming is passed to the frontend — so the DASH player uses the same session. No separate session token management needed.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Non-Plex content (filesystem, hymn, etc.) | `prewarm()` returns null, no prewarm params added, frontend uses normal flow |
| Plex unreachable / decision API fails | `prewarm()` returns null, logged as `prewarm.failed`, normal flow |
| MPD fetch fails | Pre-warm still returns the URL (session was created), DASH player retries on its own |
| Shuffle order mismatch | Frontend can't match `prewarmContentId` to queue[0], ignores prewarm |
| Stale transcode session (~120s idle) | Extremely unlikely (page loads in 3-5s), resilience system recovers as today |
| Resume position needed | Pre-warm passes `startOffset` from watch state to `loadMediaUrl()`. The offset is handled at the Plex decision API level — the transcode starts at the resume position. The frontend should **not** also seek on the pre-warmed stream. |

All failures are silent — pre-warm is best-effort. The existing resilience system (startup deadline, remount, stall recovery) remains as a safety net.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs` | **New.** Queue resolution + Plex session creation + MPD fetch + token cache |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Add pre-warm step, pass token + contentId as query params to loadURL |
| `backend/src/4_api/v1/routers/prewarm.mjs` | **New.** `GET /api/v1/prewarm/:token` — redeem token for DASH URL |
| `frontend/src/screen-framework/ScreenRenderer.jsx` (or equivalent) | Extract `prewarmToken` + `prewarmContentId` from URL, pass to Player |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Redeem token via API, match to first queue item, inject `mediaUrl` + `format` |

## What Doesn't Change

- Player resilience system (startup deadline, remount, stall recovery)
- PlayerOverlayLoading component
- DASH player initialization (dash.js)
- Queue resolution API (`/api/v1/queue/`)
- Play API (`/api/v1/play/`)
- All non-first-track playback
- Non-device-load playback (direct URL, phone control, etc.)

## Validation Signals

After implementation, these log events confirm pre-warming is working:

- **`prewarm.success`** in backend logs — session created and MPD fetched
- **No `resilience-transcode-warming`** on device-loaded Plex items — if the existing `transcodewarming` event (6 consecutive 0-byte fragments) still fires, the pre-warm failed to work
- **No `player-remount` with reason `startup-deadline-exceeded`** for the first track
- **Single `playback.overlay-summary` wait key** — one overlay from start to playback, not three
- **`playback.video-ready`** within ~5s of page load instead of ~20s

## Expected Outcome

For Plex DASH content loaded via device load API:
- First track starts on first attempt, no remount
- Single loading overlay (no flickering between three overlays)
- Time-to-video: ~5-8s after page load (down from ~20s with remount)
- Total time from trigger to video: ~20-25s (same prepare cycle, but no 15s stall)
