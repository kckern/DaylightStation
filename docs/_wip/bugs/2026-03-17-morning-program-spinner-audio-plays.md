# Morning Program: Spinner Visible While Audio Plays

**Date:** 2026-03-17
**Severity:** High — total failure of morning program visual content
**Device:** livingroom-tv (Shield TV, FKB 1.60.1)
**Reported by:** Household users
**Symptom:** Audio plays, but screen shows only a loading spinner on black background

---

## Summary

The morning program triggered at 08:39 UTC on the living room TV. The intro SFX ("Good Morning") played and completed successfully. When the queue advanced to the second track (10 Min News, `query:dailynews`), the player entered a `startup-deadline-exceeded` remount loop and never recovered. The screen remains stuck on a spinner with `playerType: null` and `mediaElementPresent: false`. The FKB screenshot confirms a centered circular spinner on a black background — no video, no cover art, no controls.

---

## Evidence

### 1. FKB Screenshot (captured 08:43 UTC)

FKB `getScreenshot` command returned a 1920x1080 PNG showing a single loading spinner centered on a solid black background. No UI elements, no video frame, no error message visible. FKB reports:
- Current page: `https://daylightlocal.kckern.net/screen/living-room`
- Screen status: on
- App RAM: 188MB/196MB (near capacity)
- FKB version: 1.60.1-play
- Last app start: 2025-10-06 (FKB has not been restarted in ~5 months)

### 2. Backend Timeline (UTC)

| Time | Event | Details |
|------|-------|---------|
| 08:39:39.120 | `device.router.load.start` | `deviceId: livingroom-tv`, `queue: morning-program` |
| 08:39:39.121 | `wake-and-load.power.start` | Power-on cycle begins |
| 08:39:43.680 | `wake-and-load.power.done` | Verified in 4558ms |
| 08:39:43.681 | `wake-and-load.prepare.start` | FKB foreground prep |
| 08:39:54.983 | `wake-and-load.prepare.done` | 11.3s prepare cycle |
| 08:39:54.984 | `fullykiosk.load.builtUrl` | `https://daylightlocal.kckern.net/screen/living-room?queue=morning-program` |
| 08:39:55.833 | `fullykiosk.load.success` | FKB accepted URL in 849ms |
| 08:39:55.834 | `wake-and-load.complete` | Total: 16.7s |
| 08:40:09.723 | `play.log.request_received` | SFX "Good Morning" logged at 92.3% (10.25s) |
| 08:40:10.593 | `play.log.request_received` | SFX "Good Morning" logged at 100% (11.1s) |

Backend load pipeline worked correctly. No errors.

### 3. Frontend Timeline (UTC, Shield TV user-agent)

| Time | Event | Key Data |
|------|-------|----------|
| 15:39:55.551 | `frontend-start` | Page load begins on Shield |
| 15:39:55.765 | `screen-autoplay.parsed` | Autoplay keys: `["queue"]` |
| 15:39:55.771 | `overlay-summary` | Status: "Loading…", `el:none`, `startup:idle` |
| 15:39:55.868 | `nav.push` | `type: "player"` — player view pushed |
| **15:39:55.903** | **overlay-summary [00090f6f25]** | **First Player instance — "Starting…", no media element** |
| **15:39:56.296** | **overlay-summary [005de2c8a7]** | **Second Player instance — "Starting…", no media element** |
| **15:39:56.300** | **queue-track-changed** | **Phantom: guid `O2ExbkfR8M`, queueLength: 1, NO TITLE** |
| **15:39:57.926** | **transport-capability-missing** | **`getMediaEl` missing after 2040ms** |
| 15:39:58.026 | overlay-summary [00dc1d2a6e] | Third Player instance — "Starting…" |
| 15:39:58.027 | queue-track-changed | Real queue: "Good Morning" `jv2oyqLGRN`, queueLength: 7 |
| 15:39:58.447 | start-time-decision | `files:sfx/intro`, effectiveStart: 0 |
| 15:39:58.579 | **playback.started** | "Good Morning" plays on instance `00dc1d2a6e` |
| 15:39:59.027 | overlay-summary [00dc1d2a6e] | Status: "playing", `el:t=0.2 r=4 n=1` — working! |
| 15:39:58.297 | **overlay-summary [005de2c8a7]** | **Still "Starting…" — stale instance persists** |
| 15:40:09.804 | queue-track-changed | Track 2: "20260317" `OouUIkfK9S`, queueLength: 6 |
| **15:40:11.308** | **resilience-recovery** | **`startup-deadline-exceeded`, waitKey `005de2c8a7`, attempt 1/5** |
| **15:40:11.311** | **player-remount** | **guid: `O2ExbkfR8M`, `playerType: null`, `mediaElementPresent: false`** |
| 15:40:26.338 | resilience-recovery | attempt 2/5, cooldown 12000ms |
| **15:40:27.340** | **player-remount** | **guid: `O2ExbkfR8M`, nonce: 1, still `playerType: null`** |

### 4. Morning Program Queue Definition

Source: `data/household/config/lists/programs/morning-program.yml`

```yaml
- input: 'media: sfx/intro'         # ← Track 1: audio SFX (PLAYED OK)
  label: Intro
- input: 'query: dailynews'          # ← Track 2: video (SPINNER)
  label: 10 Min News
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025'
- label: Crash Course Kids
  input: 'plex: 375839'
- input: 'freshvideo: teded'
  label: Ted Ed
- label: Doctrine & Covenants
  input: 'watchlist: cfmscripture'
- label: General Conference
  input: 'talk: ldsgc'
- input: 'app: wrapup'
  action: Open
  label: Wrap Up
```

9 items defined (1 inactive: KidNuz). Backend resolved 7 items into the queue. Track 2 title "20260317" matches dailynews date pattern.

---

## Root Cause Analysis

### The Race: Three Player Instances, One Phantom

The frontend creates **three separate Player overlay instances** during the ~2s window between page load and queue API response:

1. **`00090f6f25`** — mounts at T+0.35s, status "Starting…", never gets media element
2. **`005de2c8a7`** — mounts at T+0.74s, status "Starting…", never gets media element
3. **`00dc1d2a6e`** — mounts at T+2.47s (after real queue arrives), successfully plays SFX

The phantom entry (guid `O2ExbkfR8M`, queueLength: 1, no title) is emitted at T+0.75s — **before** the queue API response arrives with the real 7-item queue at T+2.47s. This phantom triggers Player instances #1 and #2.

### The Stale Timer

Instance `005de2c8a7` starts a `startupDeadlineRef` timer in `useMediaResilience.js:216-224`. This timer fires after `hardRecoverLoadingGraceMs` (default 15s). The timer is only cleared when `progressToken > 0` (line 198-204), which never happens for this stale instance because real playback occurs in instance `00dc1d2a6e`.

### The Kill Shot

At T+15.75s (15:40:11), the stale timer fires `triggerRecovery('startup-deadline-exceeded')`. This calls `handleResilienceReload` in `Player.jsx:505-577`, which:

1. Checks `transportAdapter.getMediaEl()` → returns `null` (no container ref in stale instance)
2. Logs `mediaElementPresent: false`, `playerType: null`
3. Increments `remountState.nonce` via `setRemountState` (Player.jsx:386-391)
4. Changes `singlePlayerKey` (Player.jsx:421-428), forcing a **full SinglePlayer remount**
5. The remount destroys the working player and replaces it with a new instance that tries to play guid `O2ExbkfR8M` — which has no media URL, no type, nothing

### Why It Never Recovers

The remount loop targets `O2ExbkfR8M` (the phantom), not `OouUIkfK9S` (the real track 2). Since `O2ExbkfR8M` has `playerType: null`, no renderer (VideoPlayer/AudioPlayer) is selected, so `containerRef` is never set, so `getMediaEl()` always returns null, so every recovery attempt fails the same way.

Max attempts is 5, with exponential backoff. After 5 failures, the player gives up and remains in the spinner state permanently.

---

## Code Paths Involved

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Player/Player.jsx` | 134-138 | `currentMediaGuid` — tracks active source |
| `frontend/src/modules/Player/Player.jsx` | 212-218 | Effect that resets `mediaAccess` on guid change |
| `frontend/src/modules/Player/Player.jsx` | 325-329 | `resolvedWaitKey` generation |
| `frontend/src/modules/Player/Player.jsx` | 386-391 | `remountState.nonce` increment on recovery |
| `frontend/src/modules/Player/Player.jsx` | 421-428 | `singlePlayerKey` — forces component remount |
| `frontend/src/modules/Player/Player.jsx` | 505-577 | `handleResilienceReload` — recovery handler |
| `frontend/src/modules/Player/Player.jsx` | 543-548 | `mediaElementPresent` diagnostic check |
| `frontend/src/modules/Player/Player.jsx` | 873 | `<SinglePlayer key={singlePlayerKey}>` |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | 198-204 | Progress detection (clears deadline) |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | 216-224 | Startup deadline timer (15s) |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | 135-169 | `triggerRecovery()` |
| `frontend/src/modules/Player/hooks/useQueueController.js` | 137-197 | Queue advance logic |
| `frontend/src/modules/Player/hooks/useQueueController.js` | 205-217 | Track change detection |
| `frontend/src/modules/Player/hooks/useMediaTransportAdapter.js` | 96-116 | `getMediaEl()` — 3-path fallback |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 301-310 | `getMediaEl()` concrete impl |
| `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` | 46, 247 | Spinner render conditions |

---

## Contributing Factors

1. **Queue fetch latency:** 2.5s between page load and queue API response creates a window for phantom entries
2. **FKB RAM near capacity:** 188MB/196MB — possible GC pressure on Shield TV (Android 11, Chrome 145)
3. **FKB not restarted in 5 months:** Last app start 2025-10-06 — memory fragmentation, WebView staleness
4. **No keyboard config:** `tvremote` keyboard_id returns 404 (non-critical but indicates config gap)
5. **Multiple Player instances:** The overlay-summary logs show three distinct waitKeys mounting in rapid succession — suggests the Player component hierarchy re-renders during the queue loading transition

---

## Recommended Fixes

### P0: Cancel stale resilience timers on guid change
When `currentMediaGuid` changes (Player.jsx:212-218), the effect must also cancel any pending `startupDeadlineRef` timer from the previous guid. Currently it resets `mediaAccess` and `remountState` but does not signal the resilience hook to abort its timer.

### P1: Don't start resilience monitoring until playerType is resolved
`useMediaResilience` should not arm the startup deadline when `playerType === null`. If the content type is unknown, there's nothing to recover — the correct action is to wait for metadata resolution or fail immediately.

### P1: Guard remount against phantom/untitled entries
`handleResilienceReload` should check that the current `activeSource` has a valid `mediaUrl` or `mediaType` before attempting recovery. Remounting a phantom entry with no media URL will always fail.

### P2: Suppress phantom queue-track-changed emissions
The initial `queue-track-changed` for `O2ExbkfR8M` (queueLength: 1, no title) should not be emitted if the queue is still loading. The queue controller should wait for the fetch to complete before setting the initial track.

### P2: Log staleness markers on overlay-summary
When an overlay-summary's waitKey doesn't match the current `resolvedWaitKey`, log a `stale-overlay-instance` warning. This makes it trivial to spot orphaned Player instances in production logs.
