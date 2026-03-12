# Audit: Fitness Video DASH Playback Failure

**Date:** 2026-03-11
**Severity:** High — blocks fitness session video playback
**Symptom:** Video shows "Tap to Retry" indefinitely for specific Plex content; other videos play fine
**Affected item:** `plex:649319` (4h38m video, resumed at offset 7397s)

---

## Incident Timeline

| Time (UTC) | Event |
|------------|-------|
| 02:41:23 | Previous video (`plex:606442`, Mario Kart 8) finishes normally |
| 02:41:26 | New video starts: `dash.api-ready` with `src=/api/v1/proxy/plex/stream/649319?offset=7397` |
| 02:41:26 | `playback.start-time-decision`: `requestedStart=7397`, `effectiveStart=7397`, `duration=16725` |
| 02:41:27–39 | DASH fragments load but return **0 bytes** — both audio (`startTime: 7380-7390`) and video (`startTime: 6685-6695`) |
| 02:41:39 | `proxy.timeout` — backend Plex proxy times out after 60s (transcode not ready) |
| 02:41:41 | `resilience-recovery-exhausted`: 3/3 attempts failed, `startup-deadline-exceeded` |
| 02:41:41 | `stall_threshold_exceeded`: 15159ms with `playheadPosition: null`, `status: exhausted` |
| 02:41:42+ | Overlay shows "Tap to Retry" — player is dead, no auto-recovery |
| 02:43:39 | Fragments **start returning real data** (186KB, 72KB, 6.4MB) — Plex transcoder is now ready |
| 02:43:39 | But player already declared exhausted — data goes nowhere |

## Root Cause

**The Plex transcoder takes time to prepare segments when seeking deep into a long video.** For a 4h38m video seeking to offset 7397s (2h3m), Plex needs to transcode from that position. During the ~70s preparation window, all fragment requests return 0-byte responses (HTTP 200, empty body).

The resilience system:
1. Starts a 15s startup deadline timer
2. Sees no progress (0 bytes → buffer stays at 0.00)
3. Triggers recovery → `hardReset()` → reloads manifest → same empty fragments
4. After 3 attempts (all within the transcoder prep window), declares `exhausted`
5. Shows "Tap to Retry" and **stops all recovery attempts**

By the time Plex finishes transcoding (~02:43:39, about 2 minutes later), the player has already given up.

**The video plays fine on the Plex client** because Plex's own player handles transcode warmup with a loading spinner and doesn't give up after 15 seconds.

## Why Only This Video?

- **Short videos or videos starting from 0:** Plex can direct-play or transcode quickly
- **This video:** 4h38m, seeking to 2h3m — Plex must transcode from a keyframe near that position, which takes ~60-90s for large files
- **Mario Kart 8 (previous video):** 2h42m but was playing from a cached transcode session at 9460s — already warm

## Architecture Analysis

### The 0-Byte Fragment Gap

```
[Request]  offset=7397s
[Manifest] Plex returns manifest with segments starting from 0s (full timeline)
[Fetch]    dash.js requests segments near 7397s
[Response] Plex returns 200 OK with 0 bytes (transcoder still preparing)
[Player]   Buffer stays at 0.00 — no data to play
```

The `BufferResilienceManager` handles **404 responses** (segment not found → suppress, wait, skip), but does NOT handle **0-byte 200 responses**. These propagate as "loaded successfully" events with no data.

### The Exhaustion Trap

```
useMediaResilience.js flow:
  startup → arm 15s deadline
  → deadline fires → triggerRecovery('startup-deadline-exceeded')
  → attempt 1: hardReset() → reload manifest → same 0-byte fragments
  → attempt 2: same
  → attempt 3: maxAttempts reached → STATUS.exhausted → "Tap to Retry"

No further automatic recovery. Player is dead.
```

The problem: **all 3 recovery attempts happen within the first ~45s**, but Plex needs ~90s. The recovery system exhausts itself before the transcoder is ready.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Backend proxy | `backend/src/4_api/v1/routers/proxy.mjs:56-69` | Redirects to Plex transcode URL with offset |
| Plex adapter | `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1475-1604` | Builds transcode decision + manifest URL |
| DASH element | `frontend/src/modules/Player/renderers/VideoPlayer.jsx:460-468` | `<dash-video>` web component wrapping dash.js |
| Hard reset | `frontend/src/modules/Player/renderers/VideoPlayer.jsx:128-143` | Reload manifest + seek on recovery |
| Resilience | `frontend/src/modules/Player/hooks/useMediaResilience.js:132-165` | Recovery tracking, max attempts, exhaustion |
| Startup deadline | `frontend/src/modules/Player/hooks/useMediaResilience.js:211-218` | 15s timer → triggers recovery |
| Buffer mgr | `frontend/src/modules/Player/lib/BufferResilienceManager.js:24-68` | Handles 404s but NOT 0-byte responses |
| Overlay | `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx:243` | "Tap to Retry" display |

---

## Issues Found

### Issue 1: No handling for 0-byte fragment responses (Critical)

**Location:** `BufferResilienceManager.js:24-68`

The buffer resilience manager intercepts 404 responses and suppresses them (waits for transcoder, then retries or skips). But **0-byte 200 responses are not intercepted** — they appear as successful loads with no data. dash.js treats these as empty segments and the buffer stays at 0.

**Impact:** The player never detects that fragments are empty — it just sees "no progress" and eventually declares exhaustion.

### Issue 2: Recovery exhausts too fast for slow transcoders (High)

**Location:** `useMediaResilience.js:132-165`

The startup deadline is ~15s, max attempts is 3. Total recovery window: ~45s. For long videos with deep seeks, Plex can take 60-90s to prepare the transcode. All 3 recovery attempts fire and exhaust before the transcoder is ready.

**Impact:** Player permanently gives up while the transcoder is still warming up.

### Issue 3: No awareness of "transcoder warming up" state (Medium)

**Location:** Entire playback pipeline

Neither the backend proxy nor the frontend player distinguishes between "transcoder is preparing" and "transcode failed." The proxy returns a redirect to the manifest URL immediately, and the player starts fetching fragments. There's no mechanism to:
- Poll the transcode session status
- Detect that fragments are consistently 0-byte (as opposed to a network error)
- Back off and retry with increasing delays while the transcoder catches up

### Issue 4: Recovery attempts don't increase delays (Medium)

**Location:** `useMediaResilience.js:132-165`

All 3 recovery attempts happen in rapid succession (cooldown between them is short). For slow-start scenarios, the recovery system should use exponential backoff — wait 5s, then 15s, then 30s — rather than burning through all attempts in ~45s.

### Issue 5: `retryFromExhausted()` seeks to 0 instead of original offset (Low)

**Location:** `useMediaResilience.js:166-174`

When the user taps "Tap to Retry", `retryFromExhausted()` calls `onReload({ seekToIntentMs: 0 })`. This restarts from the beginning instead of the original offset (7397s). For a 4h38m video, this is terrible UX.

---

## Recommended Fixes

### Fix 1: Detect and handle 0-byte fragments

In `BufferResilienceManager.js`, add detection for fragments that load with 0 bytes:

- Track consecutive 0-byte fragments
- After N consecutive 0-byte loads (e.g., 5), treat as "transcoder not ready"
- Pause fragment fetching, wait 5-10s, retry
- Log: `dash.zero-byte-detected` with fragment details

### Fix 2: Extend recovery window for long-seek scenarios

In `useMediaResilience.js`:

- If the seek offset is deep (e.g., >300s into the video), increase `maxAttempts` or `hardRecoverLoadingGraceMs`
- Use exponential backoff between attempts: 5s → 15s → 30s → 60s
- Consider a separate "transcode warmup" state that is more patient than the general startup deadline

### Fix 3: Add transcode readiness check

In the backend proxy (`proxy.mjs`):

- Before redirecting to the manifest, call Plex's transcode session status API
- If the transcode is still initializing, return a 202 (Accepted) or hold the connection with a loading indicator
- Alternatively, expose a `/api/v1/proxy/plex/stream/:id/status` endpoint that the frontend can poll

### Fix 4: Fix `retryFromExhausted()` to preserve seek intent

In `useMediaResilience.js:166-174`:

- Store the original `targetTimeSeconds` when entering recovery
- Pass `seekToIntentMs: originalTarget * 1000` on retry instead of `0`

### Fix 5: Distinguish 0-byte from real data in DASH diagnostics

Currently, `fragment-loaded` logs `bytes: 0` at `info` level. This should be:

- `warn` level when `bytes === 0`
- Distinct event: `dash.fragment-empty` instead of mixing with successful loads
- Track a "consecutive empty fragments" counter for alerting

---

## Priority Order

1. **Fix 2** (extend recovery window / backoff) — quickest impact, no new detection logic
2. **Fix 1** (0-byte fragment detection) — proper root cause handling
3. **Fix 4** (preserve seek on retry) — small fix, prevents UX regression
4. **Fix 5** (diagnostics) — better observability for future incidents
5. **Fix 3** (transcode readiness) — most robust but biggest change
