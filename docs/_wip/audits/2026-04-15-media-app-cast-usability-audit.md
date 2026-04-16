# Media App Cast Usability Audit — 2026-04-15

## Context

A user attempted a simple task: search for "Bluey", cast it to the living room TV with shuffle and repeat. The task failed completely — the TV powered on but showed an infinite spinner. The session also exposed multiple UX gaps in search, cast control, and remote management.

**User device:** macOS Chrome 147 (phone/laptop)
**Cast target:** Shield TV (livingroom-tv) via FKB WebView
**Session window:** ~23:50:00 – 23:55:00 UTC
**Objective:** Play Bluey on the living room TV, shuffled, on repeat
**Outcome:** Total failure — TV powered on, video never played

---

## Issue 1: Search Default Scope Misses TV Content

**Severity:** High — core discovery broken for the most common use case
**User experience:** Searched "Bluey", got no results. Had to manually switch scopes.

### What happened (logs)

| Time | Event | Detail |
|------|-------|--------|
| 23:50:28 | `search.completed` | query="bluey", default scope — no useful results |
| 23:50:37 | `search-home.scope-changed` | Switched to `all` — got 250 Immich photos, 1 Plex result |
| 23:50:48 | `search-home.scope-changed` | Switched to `video-tv` — got 3 Plex results |

### Root cause

The default search scope uses `capability=playable&take=25`. Plex TV shows are containers (`itemType: container`) without a `mediaUrl`, so they fail the `playable` capability check in `ContentQueryService.mjs:672`:

```javascript
capMap.playable: () => !!item.mediaUrl
```

TV shows, seasons, and collections are all filtered out by default.

### Fix needed

- Default scope should use `capability=listable` or omit the capability filter entirely
- The "All" scope should not return 250 photo results when searching for a TV show name — needs source weighting or media-type prioritization

### Files

- `frontend/src/modules/Media/SearchHomePanel.jsx:59` — hardcoded default `capability=playable&take=25`
- `backend/src/3_applications/content/ContentQueryService.mjs:672` — capability check

---

## Issue 2: Duplicate Search Results (Bluey x3)

**Severity:** Medium — confusing, undermines confidence
**User experience:** "Bluey 2018. Looks like it's showing up three times. Why is it there three times?"

### What happened (logs)

```
search.results-received  source=plex  newItems=3
```

The TV Shows scope queries Plex with `plex.libraryId=8,13,24` — three library sections. If Bluey exists in multiple libraries (or the same library returns duplicates via hub search), all results are returned without deduplication.

### Root cause

No deduplication exists at any layer:

1. **Backend** (`ContentQueryService.mjs:292-297`): Streaming yields results per adapter as-is
2. **Backend** (`PlexAdapter.mjs:1790`): `Promise.all(libraryIds.map(...))` results are flatMapped without dedup
3. **Frontend** (`useStreamingSearch.js:79`): `setResults(prev => [...prev, ...data.items])` — blind append

### Fix needed

- Deduplicate by item ID in `ContentQueryService.searchStream()` before yielding
- Or deduplicate in the Plex adapter when merging multi-library results

### Files

- `frontend/src/hooks/useStreamingSearch.js:79`
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1790`
- `backend/src/3_applications/content/ContentQueryService.mjs:292-297, 439, 640`

---

## Issue 3: Infinite Spinner on Shield TV (Playback Never Starts)

**Severity:** Critical — the primary task completely failed
**User experience:** TV powered on, showed a spinner forever. "Can't hear it. I don't know."

### What happened (logs)

| Time | Shield Status | Detail |
|------|---------------|--------|
| 23:51:39 | Cast complete | `wake-and-load.complete` in 22.7s — backend reports success |
| 23:52:05 | `Recovering...` | Player already failing at 27s visible |
| 23:52:06 | `Loading...` | Trying to load `plex:266169` ("Chickenrat", Bluey S1) |
| 23:52:17 | `Recovering...` | First recovery attempt |
| 23:52:20 | Recovery #2/5 | `startup-deadline-exceeded` — video never started |
| 23:52:21 | **`Seeking...`** | Stuck here permanently. `t=0.0`, `duration=null`, `paused=true` |
| 23:54:56 | Recovery #4/5 | Hard reset + player remount — still fails |
| 23:54:57 | **`playback.stalled`** | `stallDurationMs: 111,224ms` — nearly 2 minutes stalled |
| 23:55:03+ | Still `Seeking...` | 205+ seconds visible. Never recovers. |

### Root cause chain

1. **Video element gets `duration: null`** — the media URL never successfully loads content
2. **`playback.start-time-applied`** fires for `plex:266169` with seek to 0, but the video element never transitions to playing state
3. **Resilience system detects no progress** → fires `startup-deadline-exceeded` → remounts player
4. **Remount hits the same failure** → infinite recovery loop (Recovering → Loading → Seeking → Recovering...)
5. **After 5 recovery attempts**, the system gives up but the overlay stays showing "Seeking..."

### Probable causes (needs investigation)

- `PlexAdapter.loadMediaUrl()` may return null (Plex transcode decision failure, network issue, auth issue)
- The `/api/v1/proxy/plex/stream/:ratingKey` endpoint returns 404 when `loadMediaUrl()` fails — video element gets no content
- `duration` is derived from Plex metadata (`item.duration ? Math.floor(item.duration / 1000) : null`) — if Plex metadata fetch is incomplete, duration is null
- The resilience system has no circuit breaker — it retries the same broken content indefinitely with exponential cooldown but no skip-to-next behavior

### Fix needed

- **Immediate:** If playback fails N times for the same item, auto-advance to the next queue item instead of retrying forever
- **Diagnostic:** Add logging to the proxy stream endpoint to capture when `loadMediaUrl()` returns null and why
- **UX:** Show an error message to the user instead of an infinite spinner — "Could not play [title], skipping..."

### Files

- `frontend/src/modules/Player/hooks/useMediaResilience.js:225` — startup deadline logic
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx` — video element src binding
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:907-987` — `loadMediaUrl()`
- `backend/src/4_api/v1/routers/proxy.mjs:56-69` — stream proxy endpoint

---

## Issue 4: No "Now Playing" Info for Cast Targets

**Severity:** High — user has no visibility into what they just started
**User experience:** "If I click living room TV, it doesn't tell me what's playing. I wish it did."

### What exists

- `useDeviceMonitor.js` maintains a `playbackStates` Map with `contentId`, `title`, `position`, `duration`, `state`, `thumbnail`
- `DevicePicker.jsx` shows current title for devices (lines 62-64)
- `usePlaybackBroadcast.js` broadcasts playback state every 5s

### What's missing

- **`CastTargetChip.jsx`** — shows device name and connection status only, no now-playing info
- **`CastTargetPanel.jsx`** — shows shader/volume controls only, no now-playing info
- The playback data exists in the system but the cast UI components don't consume it

### Fix needed

- `CastTargetChip.jsx` should show the currently playing title and playback state (playing/paused/stalled)
- `CastTargetPanel.jsx` should show a now-playing card with title, thumbnail, and progress

---

## Issue 5: No Remote Playback Control (Pause/Stop)

**Severity:** High — user cannot control content they just started
**User experience:** "Can I stop it from here? No, I don't think I can."

### What exists

- Backend has device power control: `/api/v1/device/:deviceId/on`, `/off`, `/toggle`
- Backend has volume control: `/api/v1/device/:deviceId/volume/:level` (used by frontend)
- Frontend `useCastTarget.jsx` has `castToTarget()` and `setDeviceVolume()`

### What's missing

- **No pause/stop/play API endpoints** for devices
- **No `pause()` or `stop()` methods** on `Device.mjs`
- **`IContentControl.mjs`** interface only defines `load()` and `getStatus()` — no playback control
- **No UI controls** in `CastTargetChip.jsx` or `CastTargetPanel.jsx` for pause/stop/play

### Fix needed

- Add `/api/v1/device/:deviceId/pause`, `/play`, `/stop` endpoints
- These would send WebSocket commands to the target device's player
- Add transport controls (play/pause/stop/skip) to the cast panel UI

### Files

- `backend/src/3_applications/devices/services/Device.mjs` — needs pause/stop methods
- `backend/src/3_applications/devices/ports/IContentControl.mjs` — interface needs expanding
- `backend/src/4_api/v1/routers/device.mjs` — needs new endpoints
- `frontend/src/modules/Media/CastTargetPanel.jsx` — needs transport controls

---

## Issue 6: No Remote Power Control from Media App

**Severity:** Medium — user cannot turn off what they turned on
**User experience:** "Can I turn the TV off from here? Nope. Don't think I can."

### What exists

- Backend endpoints exist: `GET /api/v1/device/:deviceId/off` (with videocall guard)
- `Device.powerOff()` method exists
- HA integration works (used during power-on)

### What's missing

- **No power-off button in the cast UI** — the API exists but there's no UI to call it
- User has to physically find a remote or use a different app to turn off the TV they just turned on via cast

### Fix needed

- Add a power toggle button to `CastTargetPanel.jsx`
- Should call existing `/api/v1/device/:deviceId/off` endpoint

---

## Issue 7: "Had to Press Play Twice"

**Severity:** Low-Medium — confusing interaction
**User experience:** "I press play. Press it twice."

### Analysis

The user had to press the play/cast button twice before the action triggered. This could indicate:
- First press opened the cast panel, second press initiated the cast
- Or a UI responsiveness issue where the first tap didn't register
- No logs show a failed first attempt, so this is likely a UI flow issue (tap to open cast panel, then tap to confirm)

### Fix needed

- Investigate whether the cast flow requires too many taps
- Consider a single "Cast to [device]" button that combines target selection and action

---

## Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Default search scope misses TV content | High | Needs fix |
| 2 | Duplicate search results | Medium | Needs fix |
| 3 | Infinite spinner — playback never starts | **Critical** | Needs fix + investigation |
| 4 | No now-playing info for cast targets | High | Needs implementation |
| 5 | No remote pause/stop control | High | Needs implementation |
| 6 | No remote power-off control | Medium | Needs UI (API exists) |
| 7 | Double-tap to cast | Low-Medium | Needs investigation |

### Bottom line

A user tried to do the most basic thing the media app should do — find a show and play it on the TV. Every step of that journey had friction: search didn't find it by default, results had duplicates, and when they finally cast it, the TV turned on but the video never played. Then they had no way to see what happened, stop it, or turn the TV off. The primary objective was not achieved.
