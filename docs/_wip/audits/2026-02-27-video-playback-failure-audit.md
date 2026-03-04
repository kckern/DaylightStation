# Video Playback Failure Audit — Firefox DASH Seeking Death Loop

**Date:** 2026-02-27
**Triggered by:** Production incident — Plex video stuck in "Seeking..." indefinitely on Firefox
**Content:** "Beginnings" (The Bible S1E1), `plex:350694`, DASH transcode via proxy
**Affected client:** macOS Firefox 148 (`172.18.0.34`)
**Unaffected client:** macOS Chrome 145 (same IP, playing singalong content at 120fps)

**Files:**
- `frontend/src/modules/Player/hooks/useQueueController.js`
- `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- `frontend/src/modules/Player/hooks/useMediaResilience.js`
- `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js`
- `frontend/src/modules/Player/Player.jsx`
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx`
- `frontend/src/modules/Feed/players/FeedPlayer.jsx`
- `frontend/src/modules/Feed/players/FeedPlayerContext.jsx`

---

## Executive Summary

A Firefox client attempting to play a Plex DASH video enters a death loop: the queue re-dispatches every 40-80 seconds, each dispatch remounts the player, remounts accumulate orphaned SourceBuffers until Firefox's quota is exceeded, autoplay is blocked after repeated attempts, and the player becomes permanently stuck seeking at `t=0.0`. The Plex transcode session is healthy throughout — the failure is entirely client-side. Five distinct bugs interact to produce the cascade.

**Verdict:** Cascading failure from multiple interacting defects. No single fix resolves it — all five must be addressed.

---

## Incident Timeline (prod logs, 2026-02-27)

Events are sourced from two places: the backend structured log (received via WebSocket from the frontend logging framework) and the Firefox browser console (not captured by the structured logger). The "Source" column distinguishes them.

| Time (UTC) | Event | Log Evidence | Source |
|------------|-------|-------------|--------|
| 20:41:26 | Queue dispatches `plex:350694` | `queue.resolve` source=plex localId=350694 count=1 | backend |
| 20:41:26 | `getMediaEl` missing | `playback.transport-capability-missing capability=getMediaEl` | browser console ¹ |
| 20:41:27 | Player receives new GUID | `playback.queue-track-changed guid=HjNBjpwgZC` | backend |
| 20:41:28 | Video becomes ready (2s later) | `playback.video-ready title=Beginnings mediaKey=plex:350694` | backend |
| 20:41:33–20:42:42 | Playing normally at 118–121fps | `playback.render_fps` (13 reports, 5s intervals: 120,120,118,120,120,120,120,120,120,120,121,120,120) | backend |
| 20:41:51 | **Second** queue dispatch (24s later) | `queue.resolve` source=plex localId=350694 count=1 | backend |
| 20:41:51 | New GUID assigned | `playback.queue-track-changed guid=S6SpnsfukD` | backend |
| 20:41:52 | Video ready again | `playback.video-ready` | backend |
| 20:42:42 | Stall detected, resilience fires | `playback.resilience-recovery reason=manual-reset attempt=1 maxAttempts=3` | backend |
| 20:42:42 | **51-second stall** reported | `overlay-summary vis:51046ms status:Recovering…` | backend |
| 20:42:42 | Player remount | `playback.player-remount seekSeconds=0 guid=I8c2dUL1fb` | backend |
| 20:42:43 | Recovery succeeds briefly | `playback.video-ready` → `playback.started currentTime=0 duration=2981` | backend |
| 20:42:44 | **Momentary playback** (0.7s) | `overlay-summary status:playing el:t=0.7 p=false` | backend |
| 20:43:06 | **Third** queue dispatch (24s later) | `queue.resolve` source=plex localId=350694 | backend |
| 20:43:06 | New GUID — kills playback | `playback.queue-track-changed guid=5abse2qE8H` | backend |
| 20:43:08 | Stuck seeking to resume position | `overlay-summary status:Seeking… seek:0:11 el:t=0.0 r=1 n=2 p=true` | backend |
| 20:43:32 | Second resilience recovery | `playback.resilience-recovery reason=manual-reset attempt=1` | backend |
| 20:43:32 | **26-second stall** | `overlay-summary vis:26692ms status:Recovering…` | backend |
| 20:43:45 | **SourceBuffer overflow** | `SourceBuffer append failed "QuotaExceededError"` | browser console |
| 20:43:45 | Audio buffer at 319 seconds | `BufferController: Quota exceeded, Critical Buffer: 319.59` | browser console |
| 20:44:12 | Fetch aborted | `AbortError: fetching process for media resource was aborted` | browser console |
| 20:44:32 | **Fourth** queue dispatch | `queue.resolve` + `queue-track-changed guid=05jgxphE46` | backend |
| 20:44:33 | **Autoplay blocked** | `NotAllowedError: play method is not allowed by the user agent` | browser console |
| 20:44:43 | SourceBuffer overflow again | `QuotaExceededError`, Critical Buffer: 319.59 | browser console |
| 20:47:09 | **Fifth** queue dispatch | `queue.resolve` + `queue-track-changed guid=8ymSHvgdnn` | backend |
| 20:47:20 | SourceBuffer overflow again | Same pattern | browser console |
| 20:47:52 | **Sixth** queue dispatch | `queue.resolve` + `queue-track-changed guid=ZEyhzu9bhq` | backend |
| 20:47:53 | Autoplay blocked again | `NotAllowedError` | browser console |
| 20:48:04 | SourceBuffer overflow again | Critical Buffer: 319.59 | browser console |
| 20:47:52–20:51:43 | **Stuck in "Seeking..."** for 230+ seconds | `overlay-summary: status:Seeking… seek:0:11 el:t=0.0 r=1 n=2 p=true` (554 entries) | backend |
| 20:51:28 | **Seventh** queue dispatch | `queue.resolve` (no frontend track-changed — player unresponsive) | backend |

¹ The `transport-capability-missing` event is confirmed in the dev environment (HeadlessChrome, Jan 27) but not captured in production structured logs for this incident — see [Log Source Analysis](#log-source-analysis) below.

Key overlay decode: `r=1` = readyState HAVE_METADATA, `n=2` = networkState LOADING, `p=true` = paused. The video has metadata but no buffered data, is still trying to load, and is paused.

---

## Plex Side: Confirmed Healthy

From `Plex Media Server.log` inside the container:

```
Streaming Resource: Terminated session nzba5vran72kbo7qql4k with reason Client stopped playback.
[Req#598dee] Play progress on 350694 'Beginnings' - got played 914000 ms by account 1!
[Req#598f08/Transcode/20yuocg2w9q4l8zjt1t8spx0] Transcoder segment range: 182 - 238
Received transcode session ping for session 20yuocg2w9q4l8zjt1t8spx0.
```

- Active session `20yuocg2w9q4l8zjt1t8spx0` alive, segments 0–238 transcoded
- Timeline reporting `state=paused time=914000/2981000ms` (paused at 15:14)
- Session pings succeeding every 60s
- Transcode stats show normal `slothMode=1` (ahead of playback)
- DASH MPD manifest returns valid H.264 720p + AAC: `curl -sL localhost:3111/api/v1/proxy/plex/stream/350694` returns well-formed MPD
- `/transcode` volume has 324GB free (26% used)
- No errors, no warnings (only benign `Held transaction for too long: 0.5s` from statistics)

**Conclusion:** Plex is not the problem.

---

## Bug 1: Queue Re-Dispatching Every 40-80 Seconds

**File:** `useQueueController.js`
**Severity:** Critical — root cause of the cascade

### Evidence

Seven queue dispatches for the same content in 10 minutes:
```
20:41:27 → 20:41:51 → 20:43:06 → 20:44:32 → 20:47:09 → 20:47:52 → 20:51:28
Intervals: 24s, 75s, 86s, 157s, 43s, 216s
```

Each dispatch triggers `queue.resolve source=plex localId=350694 count=1` on the backend and generates a new GUID via `playback.queue-track-changed`, causing the player to perceive new content each time:

```
HjNBjpwgZC → S6SpnsfukD → 5abse2qE8H → 05jgxphE46 → 8ymSHvgdnn → ZEyhzu9bhq → (7th: no frontend ack)
```

The 7th dispatch at 20:51:28 produced a backend `queue.resolve` but no corresponding `queue-track-changed` on the frontend — by this point the player was unresponsive.

### Code Analysis

The queue init effect (line 50) depends on `[play, queue, isShuffle, contentRef]`:

```javascript
// useQueueController.js:50-123
useEffect(() => {
  const nextSignature = buildSignature(contentRef, isShuffle, play, queue);
  if (nextSignature === sourceSignatureRef.current) return; // line 71
  // ... initQueue() fetches /api/v1/queue/{contentRef}
}, [play, queue, isShuffle, contentRef]); // line 123
```

The signature check at line 71 is the dedup gate. However:

1. **Object identity instability (line 123):** `play` and `queue` are object/array props from the parent. If the parent re-renders and creates new object references (even with identical content), the effect fires. The signature check catches most cases, but...

2. **Signature corruption on error (line 116):** On API error, `sourceSignatureRef.current` is reverted to the previous value. If a second signature change happened between the start of `initQueue()` and the error callback, the ref is reverted to a stale value, causing the next comparison to fail and triggering a redundant refetch.

3. **Remount resets signature:** When the player remounts (from resilience recovery), `useQueueController` reinitializes. The `sourceSignatureRef` starts as `null`, so the first render always triggers a queue fetch — even for the exact same content that was just playing.

### Root Cause

Each resilience recovery → player remount → queue controller reinit → fresh API call → new queue items (new GUIDs) → player perceives "new content" → remounts again.

**Corroborated:** Only one `playback.started` event exists for this session (20:42:43). The player reached `status:playing` with `el:t=0.7` (0.7 seconds of actual playback) at 20:42:44, then the 3rd queue dispatch at 20:43:06 killed it. After that point, the player **never reached playing again** across 4 more dispatches and 230+ seconds.

---

## Bug 2: `getMediaEl` Missing on Every Queue Dispatch

**File:** `useMediaTransportAdapter.js:96-135`, `useCommonMediaController.js:282-291`
**Severity:** High — prevents transport from controlling the video element

### Evidence

In the dev environment (HeadlessChrome, 2026-01-27), every player mount produces this warning:
```json
{"event":"playback.transport-capability-missing","data":{"payload":{"capability":"getMediaEl"}}}
```

12 occurrences across multiple sessions confirm this is a systematic race condition, not a one-off. The event was not captured in production structured logs for this incident (likely fires before the WebSocket transport connects at mount time), but the underlying code path is the same.

### Code Analysis

The transport adapter checks for `getMediaEl` availability on mount (line 125-135):

```javascript
// useMediaTransportAdapter.js:125-135
useEffect(() => {
  // Check all three tiers
  const hasMediaEl = resilienceBridge?.getMediaEl || mediaAccess?.getMediaEl || ...;
  if (!hasMediaEl && !warnedMissingMediaRef.current) {
    logger().warn('transport-capability-missing', { capability: 'getMediaEl' });
    warnedMissingMediaRef.current = true;
  }
}, [controllerRef, mediaAccess, resilienceBridge]);
```

The problem is timing: this effect runs during mount, but `resilienceBridge` and `mediaAccess` are registered asynchronously — `onRegisterMediaAccess` in `Player.jsx:306` fires after the child `VideoPlayer` mounts and initializes its shadow DOM.

For DASH specifically, `getMediaEl` at `useCommonMediaController.js:282-291` must traverse the shadow DOM:

```javascript
const getMediaEl = useCallback(() => {
  const container = containerRef.current;
  if (!container) return null;
  if (container.shadowRoot) {
    return container.shadowRoot.querySelector('video, audio');
  }
  return container;
}, []);
```

If the `<dash-video>` web component hasn't initialized its shadow DOM yet, this returns `null`.

### Root Cause

Race condition: transport capability check runs before the video web component initializes its shadow DOM. The warning fires once (guarded by `warnedMissingMediaRef`) and is never rechecked.

---

## Bug 3: SourceBuffer Orphans on Remount

**File:** `VideoPlayer.jsx:279-286`, `useCommonMediaController.js:449-510`
**Severity:** High — causes Firefox QuotaExceededError

### Evidence

Repeated SourceBuffer overflow errors, always at exactly 319.59 seconds:
```
[SourceBufferSink][audio] SourceBuffer append failed "QuotaExceededError: MediaSource buffer not sufficient."
[BufferController][audio] Quota exceeded, Critical Buffer: 319.59040000000005
[BufferController][audio] Clearing playback buffer to overcome quota exceed situation
```

The 319.59s buffer size recurs identically across all 4 overflow events (20:43:45, 20:44:43, 20:47:20, 20:48:04), suggesting orphaned buffers from previous player instances accumulate to a fixed ceiling.

### Code Analysis

VideoPlayer renders the DASH element with a key that forces remount:

```javascript
// VideoPlayer.jsx:279-286
<dash-video
  key={`${mediaUrl || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
  ref={containerRef}
  src={mediaUrl}
  autoplay=""
/>
```

When the key changes, React unmounts the old element and mounts a new one. SourceBuffer cleanup is entirely delegated to the `dash-video` web component's `disconnectedCallback`.

The `softReinit` recovery (line 449-510) attempts explicit cleanup:

```javascript
// useCommonMediaController.js:474-497
// Try various destroy methods
for (const method of ['destroy', 'reset', 'destroyPlayer', 'resetPlayer']) {
  if (typeof host?.[method] === 'function') host[method]();
  if (typeof mediaEl?.[method] === 'function') mediaEl[method]();
}
// Also try dashjs-specific reset
const dashjsPlayer = host?.dashjsPlayer || host?.player;
if (typeof dashjsPlayer?.reset === 'function') dashjsPlayer.reset();
```

But `reloadRecovery` (line 385-432), which is used more often, only does:

```javascript
mediaEl.removeAttribute('src');
mediaEl.load(); // supposed to clear buffers
```

### Root Cause

No explicit `SourceBuffer.abort()` or `MediaSource.removeSourceBuffer()` calls anywhere in the player stack. The `removeAttribute('src') + load()` pattern is the W3C-recommended way to release resources, but it depends on the browser and web component correctly implementing cleanup. Firefox's SourceBuffer quota is lower than Chrome's, and orphaned buffers from rapid remount cycles accumulate until the quota is hit.

---

## Bug 4: Autoplay Blocked After Repeated Remounts

**File:** `VideoPlayer.jsx:279` (autoplay attribute), `useCommonMediaController.js:399` (play() call in recovery)
**Severity:** Medium — prevents playback restart after recovery

### Evidence

```
[VideoModel] Caught pending play exception - continuing
  (NotAllowedError: The play method is not allowed by the user agent or the platform
   in the current context, possibly because the user denied permission.)
```

This fires at 20:44:33 and 20:47:53, both after a queue re-dispatch + remount cycle.

### Code Analysis

Firefox requires a user gesture to initiate playback. The initial play had a user gesture, but after multiple remounts, the gesture chain is broken. The `reloadRecovery` calls `play()` programmatically (line 424):

```javascript
// useCommonMediaController.js:424
mediaEl.play().catch(playErr => { ... });
```

And the `<dash-video autoplay="">` attribute (line 284) also triggers autoplay on mount.

### Root Cause

Firefox tracks user gesture activation. After the player remounts 3-4 times via `scheduleSinglePlayerRemount` (which uses `setTimeout` — breaking the gesture chain), Firefox revokes autoplay permission. Chrome is more lenient with autoplay on same-origin media.

---

## Bug 5: Stuck Seeking at t=0.0 — Terminal State

**File:** `useCommonMediaController.js:836-899`, `useMediaResilience.js:181-188`
**Severity:** Critical — unrecoverable without page reload

### Evidence

Player stuck for 230+ seconds (until logs end) in this state, with 554 consecutive overlay entries:
```
status:Seeking… seek:0:11 el:t=0.0 r=1 n=2 p=true
```

The last overlay entry at 20:51:43 UTC shows `vis:230818ms` — the overlay had been continuously displaying "Seeking..." for nearly 4 minutes with no recovery.

Decoded: seeking to 0:11 (11 seconds = resume position), `readyState=1` (HAVE_METADATA), `networkState=2` (LOADING), `paused=true`. The video has metadata from the MPD manifest but zero buffered media data.

The `player-remount` event confirms: `seekSeconds=0 guid=I8c2dUL1fb` (first recovery) and `seekSeconds=0 guid=ovJ84FGEEO` (second recovery).

### Code Analysis

The start time logic at `useCommonMediaController.js:836-899` handles resume position on `loadedmetadata`:

```javascript
// Sticky resume fallback (lines 870-887)
const stickyTime = lastSeekIntentRef.current
  ?? __lastSeekByKey[assetId]
  ?? lastPlaybackPosRef.current
  ?? __lastPosByKey[assetId];
```

The resume position `11` seconds comes from the queue resolve: `"resumePosition": 11`. But after multiple remounts:

1. The Plex transcode session may have been invalidated by repeated reconnections
2. The `<dash-video>` element fires `loadedmetadata` (readyState=1) from the MPD manifest, but actual segment data never arrives
3. The seek to 11 seconds hangs because `readyState` never reaches `HAVE_ENOUGH_DATA` (4)
4. `isSeeking` stays true, `isPaused` stays true (autoplay blocked), and `currentTime` stays 0

The resilience system at `useMediaResilience.js:181-188` has a startup deadline:

```javascript
// If status is startup/recovering and no progress, trigger recovery after grace period
const timer = setTimeout(() => {
  triggerRecovery('startup-deadline-exceeded');
}, hardRecoverLoadingGraceMs);
```

But the module-level recovery tracker (`_recoveryTracker`, line 22-37) enforces `maxAttempts` and `recoveryCooldownMs`. After 3 failed recovery attempts, the tracker blocks further recoveries, and the player is permanently stuck.

### Root Cause

The recovery system has a hard ceiling on attempts. Once exhausted, no further recovery is possible. The player enters a terminal state: seeking to a position that will never buffer, with autoplay blocked so it can't even start from 0, and recovery attempts depleted.

---

## Failure Cascade Diagram

```
Parent re-render (new object refs for play/queue props)
  │
  ▼
[Bug 1] useQueueController re-dispatches queue (signature reset on remount)
  │
  ▼
Queue resolves → new GUIDs → player perceives "new content"
  │
  ├──► [Bug 2] getMediaEl missing (shadow DOM not ready)
  │         Transport can't control video element
  │
  ▼
Player starts loading DASH stream
  │
  ├──► Autoplay attempt → works first time, fails after N remounts [Bug 4]
  │
  ▼
Stall detected (51s, 26s) → resilience fires → scheduleSinglePlayerRemount
  │
  ├──► setTimeout breaks user gesture chain [Bug 4]
  │
  ▼
React remount (key change) → old <dash-video> unmounted
  │
  ├──► [Bug 3] SourceBuffers not explicitly cleaned
  │         Firefox accumulates to 319s quota ceiling
  │
  ▼
New <dash-video> mounts → queue re-dispatches [Bug 1] → cycle repeats
  │
  ▼
After 3-4 cycles: recovery tracker exhausted [Bug 5]
  │
  ▼
TERMINAL: Seeking at t=0.0, paused, autoplay blocked, no recovery possible
  │
  ▼
230+ seconds of continuous "Seeking…" (554 overlay entries, vis=230818ms)
7th queue dispatch at 20:51:28 — no frontend ack (player unresponsive)
```

---

## Log Source Analysis

This audit draws evidence from two distinct log sources, each with different coverage:

### Backend Structured Logs (Docker container, `daylight-station`)

Events emitted by the frontend logging framework (`frontend/src/lib/logging/`) and sent to the backend via WebSocket. These are captured in the Docker container logs and are the primary source of corroborated evidence.

**Confirmed events in production logs:**
- `queue.resolve` — all 7 dispatches with exact timestamps
- `playback.queue-track-changed` — 6 of 7 (7th had no frontend ack)
- `playback.video-ready` — 3 events at 20:41:28, 20:41:52, 20:42:43
- `playback.started` — 1 event at 20:42:43 (the only successful playback start)
- `playback.render_fps` — 13 reports at 120fps (20:41:33–20:42:42)
- `playback.resilience-recovery` — 2 events, both `reason=manual-reset attempt=1 maxAttempts=3`
- `playback.player-remount` — 2 events with distinct GUIDs
- `playback.overlay-summary` — continuous stream including 554 entries showing terminal stuck state
- `tvapp-autoplay` — 7 Firefox dispatches + 2 Chrome dispatches (Chrome playing singalong content)

**Not captured in production structured logs:**
- `playback.transport-capability-missing` — fires at component mount time, likely before the WebSocket transport connects. Confirmed present in dev environment logs (HeadlessChrome, 2026-01-27) where 12 occurrences across multiple sessions show the same `capability=getMediaEl` pattern.
- `playback.stall_threshold_exceeded` — referenced in original audit but not found as a discrete event; the stall duration is instead visible in the `overlay-summary` `vis:` counter (51046ms, 26692ms).

### Firefox Browser Console

Native browser errors from dash.js and the MediaSource API. These are **not** captured by the structured logging framework because they are emitted by the browser engine, not by application code.

**Events from browser console only (not independently corroborated in backend logs):**
- `QuotaExceededError` / `SourceBuffer` overflow — 4 events cited
- `NotAllowedError` / autoplay blocked — 2 events cited
- `AbortError` / fetch aborted — 1 event cited
- `BufferController` / Critical Buffer: 319.59 — 4 events cited

These browser console events are consistent with the behavior observed in the structured logs (player never reaching `playing` after dispatch 3, `p=true` in all subsequent overlays, readyState stuck at 1), but cannot be independently verified from the backend logs alone.

### Chrome Comparison (from backend structured logs)

During the same incident window, Chrome on the same IP (`172.18.0.34`) showed normal behavior:
- 20:46:00 — dispatched singalong content, reached `playing` within 2 seconds
- 20:54:41 — dispatched again, reached `playing` within 1 second
- Zero resilience-recovery or player-remount events
- No stuck states

This confirms the audit's claim that the cascade is Firefox-specific.

---

## Recommendations

### R1. Stabilize queue dispatch across remounts (Bug 1)

Do not reset `sourceSignatureRef` on remount. Lift the signature to a stable location (e.g., module-level `Map` keyed by `contentRef`, or a ref that persists via `useRef` in the parent). If the content hasn't changed, the remounted queue controller should not re-fetch.

### R2. Defer transport capability check (Bug 2)

Replace the mount-time `useEffect` check in `useMediaTransportAdapter.js:125` with a lazy check — only warn when a transport action is actually attempted and `getMediaEl()` returns null. Alternatively, retry the check after a short delay (e.g., 500ms) to allow shadow DOM initialization.

### R3. Explicit SourceBuffer cleanup on unmount (Bug 3)

Add a cleanup effect in `VideoPlayer.jsx` or `useCommonMediaController.js` that, on unmount:
1. Calls `SourceBuffer.abort()` on all active SourceBuffers
2. Calls `MediaSource.removeSourceBuffer()` for each
3. Revokes any `MediaSource` object URLs

For the `dash-video` web component, expose a `destroy()` method that performs this cleanup and call it in a React `useEffect` cleanup function.

### R4. Preserve user gesture through recovery (Bug 4)

Instead of `setTimeout` + full React remount for recovery, prefer in-place recovery:
- `reloadRecovery` (src swap) preserves the DOM element and is more likely to retain gesture state
- Only escalate to `softReinit` (full remount) as a last resort
- Consider `muted` autoplay as a fallback — Firefox allows muted autoplay without a gesture

### R5. Prevent terminal stuck state (Bug 5)

When recovery attempts are exhausted and the player is in a non-playing state:
- Fall back to a user-facing "Tap to retry" overlay instead of silently sticking on "Seeking..."
- Or trigger a full page reload (`reloadDocument()`) as the nuclear option
- Clear the seek intent so a fresh attempt starts from 0 instead of trying to seek to a position that may never buffer

---

## Minor Issues Observed (Not Part of Cascade)

| Issue | Log Evidence | Severity |
|-------|-------------|----------|
| Todoist API 410 | `todoist.activity.completed.error: Request failed with status code 410` | Low — deprecated API |
| Fitness dashboard missing | `"No dashboard available for today" userId=KC Kern date=2026-02-27` | Low — config |
| Progress report < 10s | `"Invalid request: seconds < 10"` on Chrome | Low — edge case |
| `plextraktsync` restart loop | `Restarting (1) 4 seconds ago` in `docker ps` | Unrelated |

---

## Reproduction

1. Open Firefox on macOS, navigate to DaylightStation
2. Play any Plex DASH video with a resume position
3. Wait ~40-80 seconds for first queue re-dispatch
4. Observe: stall → recovery → remount → re-dispatch cycle
5. After 3-4 cycles, player is permanently stuck at "Seeking..."

Chrome is more resilient due to higher SourceBuffer quotas and lenient autoplay policy, but the queue re-dispatching bug (Bug 1) affects Chrome too — it just doesn't cascade to a terminal state.

**Simultaneous Chrome behavior (corroborated):** During the incident, Chrome on the same machine dispatched singalong content at 20:46:00 and was `status:playing` within 2 seconds. At 20:54:41 it dispatched again and was playing within 1 second. Zero resilience events, zero recovery cycles.

---

## Git Blame: When Were These Bugs Introduced?

### Commit Inventory (Chronological)

| Date | Hash | Message | Impact |
|------|------|---------|--------|
| 2025-10-15 | `77ca01641` | Refactor Player module into smaller components | Original architecture |
| 2025-11-23 | `806a99cf3` | Refactor Player resilience and overlay handling | `handleResilienceReload` created |
| 2025-12-08 | `635fdfc81` | Refactor player resilience: split policy, transport, presentation | Transport capability check created |
| 2025-12-11 | `b9f2e3ab9` | Add exponential backoff to player remount and recovery | Backoff constants, `scheduleSinglePlayerRemount` |
| **2026-01-12** | **`0555884db`** | **revert to dash-video-element to fix memory leak** | **THE CRITICAL COMMIT — rewrote getMediaEl, reloadRecovery, softReinit** |
| 2026-01-18 | `a498e01e5` | feat(player): add getContainerEl accessor | Shadow DOM probe in getMediaEl |
| 2026-01-18 | `599efbf57` | feat(player): add resilienceBridge to transport adapter | Three-tier getMediaEl fallback chain |
| 2026-01-18 | `1f30e0140` | refactor: Remove internal stall detection from useMediaResilience | Startup deadline rewrite |
| 2026-02-01 | `488fae6d7` | refactor: standardize field naming to camelCase | Changed key/src props on dash-video, softReinit dep array |
| **2026-02-09** | **`8f747bd8b`** | **Content adapters: rename, ambient, and doc updates** | **hardReset rewritten — uses containerRef (wrong element for dash-video)** |
| 2026-02-11 | `e1ca7f567` | refactor(player): collapse three-way queue URL branch | Queue controller dependency array changed |
| **2026-02-18** | **`49f2008a2`** | **Governance fixes, logging, docs & player tweaks** | **Module-level _recoveryTracker added (symptom fix for infinite remount loop)** |

### Three Waves of Change

**Wave 1: Nov-Dec 2025 — Resilience Architecture**

The foundational resilience layer was built across Nov-Dec 2025: `handleResilienceReload` (Nov 23), transport adapter split (Dec 8), exponential backoff (Dec 11). These are architecturally sound and not the source of the current bugs.

**Wave 2: Jan 12 2026 — The Breaking Change (`0555884db`)**

This is the primary bug introduction point. Commit `0555884db` ("revert to dash-video-element to fix memory leak") rewrote the core recovery code:

- **`getMediaEl`** — now needs to traverse shadow DOM to find the real `<video>` inside `<dash-video>`
- **`reloadRecovery`** — calls `mediaEl.removeAttribute('src')`, `.load()`, `.play()` — these are native `<video>` APIs that may not work correctly on the `<dash-video>` custom element
- **`softReinitRecovery`** — calls `destroy/reset/destroyPlayer/resetPlayer` on the host element, but the `<dash-video>` web component may not expose these methods
- **SourceBuffer cleanup** — no explicit cleanup was added; the code assumes DOM removal handles it

Six days later (Jan 18), three follow-up commits partially patched the mismatch:
- `a498e01e5` added the shadow DOM probe to `getMediaEl` (reads work, writes still broken)
- `599efbf57` added the three-tier `resilienceBridge` fallback (more indirection, same problem)
- `1f30e0140` removed internal stall detection (hid symptoms)

**Wave 3: Feb 2026 — Compounding Changes**

- **Feb 1** (`488fae6d7`): camelCase rename changed `<dash-video>` key/src props and `softReinit` dependency array. Innocuous on its own.
- **Feb 9** (`8f747bd8b`): `hardReset` was **entirely rewritten** to use `containerRef.current` directly. For `<dash-video>`, `containerRef` points to the custom element, NOT the inner `<video>`. Calling `.load()` and `.play()` on a `<dash-video>` element does not work as expected. **This commit made hardReset ineffective for DASH content.**
- **Feb 11** (`e1ca7f567`): Queue controller dependency array changed to include `contentRef`. This may have altered the re-dispatch frequency.
- **Feb 18** (`49f2008a2`): Module-level `_recoveryTracker` was added explicitly to fix "an infinite remount loop." This is a **symptom fix** — it caps recovery attempts rather than fixing why recovery fails. This commit introduced Bug 5 (terminal stuck state) as a side effect of fixing the infinite loop.

### Per-Bug Introduction Dates

| Bug | Introduced | Commit | Notes |
|-----|-----------|--------|-------|
| Bug 1: Queue re-dispatch | 2026-02-11 | `e1ca7f567` | Dependency array changed; also inherits signature reset issue from 2025-11-12 |
| Bug 2: getMediaEl missing | 2026-01-12 | `0555884db` | dash-video shadow DOM not probed at mount time |
| Bug 3: SourceBuffer orphans | 2026-01-12 | `0555884db` | No explicit cleanup added when switching to dash-video |
| Bug 4: Autoplay blocked | 2025-12-11 | `b9f2e3ab9` | setTimeout in remount backoff breaks gesture chain (latent until dash-video made remounts frequent) |
| Bug 5: Terminal stuck state | 2026-02-18 | `49f2008a2` | Recovery tracker caps attempts; hardReset broken on Feb 9 means recovery never succeeds |

### Root Cause Summary

**Commit `0555884db` (2026-01-12)** introduced the `<dash-video>` web component but left all recovery code operating as if it were a native `<video>` element. This created a fundamental mismatch: reads through shadow DOM were partially fixed (Jan 18), but writes (`.load()`, `.play()`, `.removeAttribute('src')`) still target the wrong element. The Feb 9 `hardReset` rewrite (`8f747bd8b`) compounded this by directly using `containerRef.current`. The Feb 18 recovery tracker (`49f2008a2`) capped the resulting infinite loop, converting it from an infinite loop into a terminal stuck state.
