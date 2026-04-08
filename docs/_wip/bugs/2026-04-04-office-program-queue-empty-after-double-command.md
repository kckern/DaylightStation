# Bug: Office Program Queue Resolves to 0 Items Despite Backend Returning 9

**Date:** 2026-04-04
**Severity:** Critical (total failure of office morning/evening program)
**Status:** Root cause confirmed, unfixed
**Component:** Frontend Player → useQueueController → module-level signature cache

---

## Symptom

Office program triggered at 07:34 PDT. The backend successfully resolved 9 queue items from `office-program.yml`, but the frontend Player reported `queueLength: 0` and timed out after 30 seconds. No content played.

## Evidence Timeline (all times UTC)

| Time | Source | Event | Detail |
|------|--------|-------|--------|
| 14:34:44 | Backend | `wake-and-load.power.start` | HA script `office_tv_on` fired |
| 14:34:53 | Backend | `wake-and-load.power.done` | Power verified after 9047ms |
| 14:34:53 | Backend | `wake-and-load.prewarm.start` | Prewarm phase begins, queue=office-program |
| 14:34:56 | Backend | WS broadcast | **FIRST command** sent on `homeline:office-tv` topic |
| 14:34:56 | Frontend | `commands.content` | Received `media:queue` → `office-program` (from prewarm WS) |
| 14:34:58 | Frontend | `transport-capability-missing` | `getMediaEl` not available after 2046ms |
| 14:35:00 | Backend | `wake-and-load.load.ws-failed` | WS ack timed out after 4000ms |
| 14:35:00 | Backend | `websocket.load` | **SECOND command** sent on `office` topic (fallback) |
| 14:35:00 | Frontend | `commands.content` | Received `media:queue` → `office-program` (from fallback) |
| 14:35:05 | Backend | `queue.resolve` | **9 items resolved**, totalDuration=10250s |
| 14:35:30 | Frontend | `player-no-source-timeout` | **queueLength: 0**, hasPlay: false → Player dismissed |

## Root Cause

A **poisoned module-level signature cache** in `useQueueController.js` causes the second Player mount to skip the queue API call, even though the first mount's API response was discarded.

### The Race Condition (Step by Step)

**Setup:** `_signatureCache` is a module-level `Map` (line 11) that persists across React component mounts. It's designed to prevent redundant API calls during resilience-recovery remounts.

#### T=14:34:56 — First WS command arrives

1. `ScreenActionHandler.handleMediaQueue` fires
2. `dismissOverlay()` clears any existing overlay
3. `showOverlay(Player, { queue: { contentId: "office-program" } })` mounts Player
4. `useQueueController` runs:
   - **Line 44:** `sourceSignatureRef.current = _signatureCache.get("office-program")` → `null` (first time)
   - **Line 76-79:** `previousSignature (null) !== nextSignature ("ref:office-program;shuffle:0")` → proceeds
   - **Line 84-85:** Sets `sourceSignatureRef.current = "ref:office-program;shuffle:0"` and **writes to `_signatureCache`** (module-level)
   - **Line 111:** Starts async API call: `GET /api/v1/queue/office-program`

#### T=14:35:00 — Second WS command arrives (4 seconds later)

5. `ScreenActionHandler.handleMediaQueue` fires again
6. `dismissOverlay()` **UNMOUNTS the first Player instance**
   - First mount's cleanup runs: `isCancelled = true` (line 182)
   - But `_signatureCache` still has `"office-program" → "ref:office-program;shuffle:0"`
7. `showOverlay(Player, { queue: { contentId: "office-program" } })` mounts **new** Player
8. `useQueueController` runs on the NEW instance:
   - **Line 44:** `sourceSignatureRef.current = _signatureCache.get("office-program")` → **`"ref:office-program;shuffle:0"`** (from step 4!)
   - **Line 76-79:** `previousSignature ("ref:office-program;shuffle:0") === nextSignature ("ref:office-program;shuffle:0")` → **TRUE**
   - **Line 80: `return;`** — **Effect exits early. No API call. No queue data.**

#### T=14:35:05 — Backend resolves the first API call

9. Backend returns 9 items for the first mount's request
10. But the first mount is gone. `isCancelled = true`. Response is discarded (line 164 never executes).

#### T=14:35:30 — 30-second timeout

11. `playQueue` state remains `[]` (initialized at line 31, never updated)
12. `activeSource` is null (Player.jsx line 125-133)
13. 30s timeout fires → `player-no-source-timeout` logged → Player dismissed

### The Fundamental Flaw

The `_signatureCache` is set **synchronously** at line 85 (before the async API call completes), but it's checked on remount to decide whether to skip the API call. This creates a window where:

- Cache says: "signature for office-program already processed"
- Reality: the API response was never stored (component unmounted mid-flight)

**The cache is an optimistic write with no rollback on cancellation.** The cleanup at line 181-183 sets `isCancelled = true` but does NOT clear `_signatureCache`.

---

## Why Two Commands Are Sent

The backend `WakeAndLoadService` has a three-phase fallback pattern:

1. **WS-first (prewarm):** Broadcasts queue command via WebSocket → waits 4s for ack
2. **FKB loadURL (fallback):** If WS ack fails, loads URL via device content control
3. **WS-fallback:** If FKB also fails, sends another WS command after page stabilizes

In this incident, the WS-first command was received by the frontend (logged at 14:34:56), but the backend's `waitForMessage` timed out after 4000ms because the Player was still initializing and couldn't send an ack. The backend then fell back to `device.loadContent`, which sent the second command at 14:35:00.

Both commands reached the frontend successfully. The 4-second gap is exactly the WS ack timeout.

---

## Contributing Factors

### 1. No Command Deduplication in ScreenActionHandler

`handleMediaQueue` (ScreenActionHandler.jsx:99-105) has **no deduplication**. Every `media:queue` event triggers `dismissOverlay()` + `showOverlay()`, even if the contentId is identical to what's already playing. Menu actions have a `duplicateMode` guard (line 73-84), but media actions do not.

### 2. WebSocket Connection Instability

The office screen's WebSocket connections were going stale every ~45 seconds throughout the incident window. Multiple clients showed this pattern simultaneously. While this didn't directly cause the queue failure (queue resolution uses HTTP), it indicates the office screen's network connection is fragile, which may have contributed to the WS ack timeout.

### 3. transport-capability-missing Warning

At T+2s (14:34:58), the Player logged `transport-capability-missing` for `getMediaEl`. This means the Player's media element wasn't ready 2 seconds after mount — the queue API call was still in flight, so no media element existed yet. This is expected for queue-based playback but indicates the Player attempts transport setup before content is available.

### 4. Historical Pattern

This is the **fifth** office-program failure documented since March 17:

| Date | Bug | Root Cause |
|------|-----|------------|
| 03-17 | Spinner audio plays | Phantom queue entry from load/API race |
| 03-22 | Autoplay broken | contentId wrapped in string array |
| 03-23 | Wrong video file | freshvideo prefix mismatch |
| 03-24 | Video never loads | Audio→video format switch race |
| **04-04** | **Queue empty** | **Signature cache poisoned by double command** |

All five bugs are in the Player → queue initialization pipeline. The system has no resilience to the multi-command pattern that `WakeAndLoadService` routinely produces.

---

## Affected Code

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Player/hooks/useQueueController.js` | 11, 44, 79-85, 164, 181-183 | **Primary:** Signature cache poisoning |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | 99-105 | **Contributing:** No media:queue deduplication |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | 250-337 | **Trigger:** Sends multiple WS commands in sequence |
| `frontend/src/modules/Player/Player.jsx` | 125-148 | **Symptom:** 30s no-source timeout |

---

## Fix Vectors (Not Prioritized)

### A. Clear signature cache on cancellation (useQueueController)

In the cleanup function (line 181-183), delete the cache entry if the API call hasn't completed:

```javascript
return () => {
  isCancelled = true;
  // If API hasn't responded yet, the cache entry is stale — remove it
  // so remounts will re-fetch
  if (contentRef) _signatureCache.delete(contentRef);
};
```

**Risk:** This would also clear the cache during resilience-recovery remounts, which the cache was designed to protect. Need to distinguish "remount due to duplicate command" from "remount due to resilience recovery."

### B. Move cache write to after API success (useQueueController)

Move `_signatureCache.set()` from line 85 (synchronous, before API call) to inside the `if (!isCancelled)` block at line 164-168:

```javascript
if (!isCancelled) {
  _signatureCache.set(contentRef, nextSignature);  // ← moved here
  setQueue(validQueue);
  setOriginalQueue(validQueue);
  setQueueAudio(fetchedAudio);
}
```

**Risk:** Multiple concurrent API calls for the same content during rapid remounts. But this is safer than the current behavior of zero API calls.

### C. Add deduplication to ScreenActionHandler

Debounce or deduplicate `media:queue` with same contentId within a short window (2-3s):

```javascript
const lastQueueRef = useRef({ contentId: null, ts: 0 });

const handleMediaQueue = useCallback((payload) => {
  const now = Date.now();
  if (payload.contentId === lastQueueRef.current.contentId
      && now - lastQueueRef.current.ts < 3000) {
    return; // Suppress duplicate within 3s
  }
  lastQueueRef.current = { contentId: payload.contentId, ts: now };
  dismissOverlay();
  showOverlay(Player, { ... });
}, [showOverlay, dismissOverlay]);
```

### D. Backend: Suppress redundant WS commands in WakeAndLoadService

If the WS-first broadcast was received (subscriber count > 0 and message delivered), skip the WS-fallback phase even if the ack timed out. The ack timeout doesn't mean the message wasn't received — it means the frontend didn't respond within 4s (which is expected during Player initialization).

### E. Combine fixes B + C

Fix B prevents the cache from being poisoned. Fix C prevents the double-command from reaching the Player at all. Together they address both the trigger and the vulnerability.

---

## Reproduction

This bug is **deterministic** whenever:
1. WakeAndLoadService sends a prewarm WS command
2. The WS ack times out (4s — common during Player initialization)
3. The fallback sends a second command with the same queue name
4. The office screen receives both commands

This happens every time the office program triggers via wake-and-load, which is the **primary** activation path. Manual queue selection (via menu or URL) sends only one command and is not affected.

---

## Additional Context: WebSocket Stale Connections

The office screen showed repeated "Connection stale (no data in 45s)" warnings across all three connected clients during the incident window. The frontend checks for data every 15s and forces reconnect if no data in 45s. The backend sends pings every 30s. This pattern suggests either:
- Network-level idle timeout (firewall/proxy) dropping WS connections
- Backend ping/pong mismatch (pong lost → backend terminates → frontend detects stale)

While this didn't directly cause the queue failure, it indicates the office screen's WS connection is unreliable, which contributed to the WS ack timeout that triggers the double-command pattern.
