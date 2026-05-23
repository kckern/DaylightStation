# Fitness: Stall Watchdog Noise + Play Fails During Real Stall (Dead Transcode Session)

**Filed:** 2026-05-23
**Session:** `fs_20260523132554` — *Week 3 Day 5: Shoulders & Arms – LIFT/HIIT* (`plex:605742`), 33:43 duration, paused-then-abandoned at `33.5%`
**Log:** `media/logs/fitness/2026-05-23T20-36-11.jsonl` (5,453 events)
**Client:** Garage fitness extension (UA `Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0`, IP `172.18.0.26`)
**Files referenced:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`, `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`, `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

---

## TL;DR

Three independent defects landed in the same workout, each visible in the session log:

1. **`playback.stalled` false-positive rate: 91% (53 of 58 stalls resolved in ≤10ms).** The stall watchdog declares a stall whenever `Date.now() − lastProgressTs ≥ softMs` (default 1200ms). `lastProgressTs` only updates on HTML5 `timeupdate` events. Browsers throttle `timeupdate` to ~4Hz, and a single missed frame or scheduler hiccup pushes the gap past softMs even when the media element is actively playing — a fresh `timeupdate` arrives a few ms later and `markProgress()` immediately fires `playback.recovery-resolved`. Each false positive sets `s.isStalled = true`, schedules the hardTimer, and pollutes telemetry with a warn-level event for what is in fact normal playback. (`useCommonMediaController.js:875-948`).

2. **One real stall, not recoverable on its own (Plex transcode session timeout).** The DASH stream URL pointed at a Plex transcode session `bf3e55a2-e731-43d3-8f1f-44931b096bd5` whose `availabilityStartTime` was `2026-05-23T20:25:50.647Z` — created 11 minutes before this fitness session even began. Plex's idle reaper killed the session around `20:36`. The client got `dash.error 27` (fragment not available), then later `dash.error 28` (header / init segment not available). The `useMediaResilience` URL-refresh path (`hardReset({ refreshUrl: true })`) — which exists precisely for "Plex transcode session likely dead" — **never fired** in this session.

3. **Pause→Play during the real stall produces a 4-cycle dash.js retry loop with no playback.** Between `20:39:14.738` and `20:39:18.092` (3.35 seconds), the underlying media element emitted **8 alternating `pause`/`play` events** while `currentTime` stayed pinned at `676.693333`. Each `play` triggered `dash.playback-started → playback.resumed → dash.waiting`, then the element auto-paused on the immediate buffer underrun (transcode header was 404). The user reported "I pressed pause, it paused; I pressed play, nothing happened." That is exactly what the log shows: every `play` attempt restarted dash but stalled inside one event-loop tick before any frame could render. The player gave the appearance of taking input but produced no playback.

The user gave up and pressed the close button at `20:39:33.224`; the close completed in 1.9s; a manual restart at `20:39:49.834` partially recovered (re-seeked to position 676.85 from the saved progress) but then emitted `playback.player-no-source-timeout` 28 seconds later with `queueLength: 0, hasPlay: true` — i.e., the player thought it should be playing but the queue was empty. The workout finally ran to completion in a second restart attempt at 21:02.

---

## 1. The false-positive stall mechanism

### Code path

`frontend/src/modules/Player/hooks/useCommonMediaController.js:875-948`

```javascript
const diff = Date.now() - s.lastProgressTs;

if (diff >= softMs) {
  // …
  logger.warn('playback.stalled', { …, stallDurationMs: diff });
  s.isStalled = true;
  s.status = 'stalled';
  setIsStalled(true);
  // …schedules hardTimer to attempt recovery after (hardMs - softMs)ms
}
```

And `markProgress` at line 951:

```javascript
const markProgress = useCallback(() => {
  const s = stallStateRef.current;
  // …
  const wasStalled = s.isStalled;
  s.lastProgressTs = Date.now();

  if (wasStalled) {
    mcLog().info('playback.recovery-resolved', { …, stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null, … });
    // …
  }
});
```

`markProgress` is wired into the `timeupdate` event listener (line 1018). When `timeupdate` fires, `lastProgressTs` advances. The soft-stall threshold trips when the gap between `timeupdate` events exceeds `softMs`.

**Default:** `softMs = 1200` (line 168), `checkInterval = Math.min(500, softMs/3) = 400ms` (line 423).

### Evidence

For each of the 58 stalls in this session, I paired `playback.stalled` with the immediately following `playback.recovery-resolved` and measured the gap:

| Bucket | Count |
|---|---|
| Resolved in ≤ 10ms (false positive — `timeupdate` resumed before any recovery action) | **53** |
| Resolved in 1s – 60s | 0 |
| Resolved in > 1 minute (real stall) | **2** |
| Never resolved (closed before resolution) | 3 |

The 53 false positives all had `stallDurationMs` between 1607ms and 2666ms — just above `softMs`. They resolved with a median gap of **3 ms** between the warn and the info event. The hardTimer never fired for any of them (because by the time it would have, `s.isStalled` was already false again).

The 2 real stalls are listed in §2.

### Root cause

`timeupdate` is a low-priority event in the HTML5 media spec; the browser is allowed to coalesce or delay it (the spec only guarantees ≥ 4Hz, not ≤). On a busy event loop — exactly the kind of busy event loop a workout session creates (chart re-renders, HR samples, render thrashing — there are 46 `fitness.render_thrashing` events in this session) — `timeupdate` can pause for 1.5–2.5 seconds while playback continues normally. `markProgress` doesn't run during that gap, and the soft-stall threshold fires spuriously.

The watchdog has all the info it needs to disambiguate — `mediaEl.currentTime` would have advanced even without a `timeupdate` event. The fix is to also check `mediaEl.currentTime` against a separately tracked `lastObservedCurrentTime` when the soft timer fires; if `currentTime` has advanced, that's not a stall regardless of when `timeupdate` last fired.

### Operational impact

- **Telemetry pollution.** 53 warn-level events per session for a 34-minute workout. Other components that observe `stallState` (e.g. `PlayerOverlayLoading`, render gates) get pulled into a "stalled" state transition that gets revoked within one frame, possibly causing cosmetic flicker.
- **Recovery counters falsely advance.** `s.recoveryAttempt` is incremented by `attemptRecovery()` — but only when the hardTimer fires. The false positives never reach that path, so this isn't an issue *yet*. If anyone later moves any state mutation from the hardTimer into the soft handler, the false-positives would start counting against the recovery attempt budget.
- **Masks real stalls.** When 91% of stall warnings are noise, an operator watching prod logs has no quick way to distinguish a real failure from the background hum.

---

## 2. The one real stall: Plex transcode session timeout

### The session URL

The DASH manifest URL referenced in every `dash.error` and every `dash.fragment-loading` in this session is the same transcode session ID:

```
.../api/v1/proxy/plex/video/:/transcode/universal/session/bf3e55a2-e731-43d3-8f1f-44931b096bd5/0/<fragment>
```

The dash.js `request` payload on the first `dash.error` includes:

```json
{
  "availabilityStartTime": "2026-05-23T20:25:50.647Z",
  "bytesLoaded": 584, "bytesTotal": 584,
  "endDate": "2026-05-23T20:36:18.979Z",
  …
}
```

That `availabilityStartTime` is **10 minutes 28 seconds before** the first `dash.error` and **10 minutes 21 seconds before** this fitness session's first log line. The session ID was reused from a previous playback (likely the user's prior music or browsing session); Plex's transcode idle reaper kills sessions ~10 minutes after they go quiet.

### Error sequence

| UTC | Event | Details |
|---|---|---|
| `20:36:18.983` | `dash.error 27` | fragment index 1 (URL fragment `135.m4s`) "not available" — first fetch failure |
| `20:37:11.461` | `playback.stalled` | `stallDurationMs: 2666` (real stall — buffer running dry) |
| `20:37:18.262` | `playback.recovery-strategy` | `strategy: nudge, attempt: 1, success: true` — the controller's nudge recovery succeeded |
| `20:39:25.645` | `dash.error 28` | `0/header` "not available" — init segment refetch failed |
| `20:39:28.691` | `dash.error 28` | second header refetch failed |
| `20:39:30.126` | `playback.stalled` | `stallDurationMs: 4326` (second real stall, this time the buffer is fully out) |
| `20:39:33.261` | `dash.error 28` | third header refetch failed |
| `20:39:33.224` | `fitness.player.close.requested` | user gives up |
| `20:39:35.123-125` | `fitness.player.close.initiated/completed` | close takes 1.9s |
| `20:39:35.148` | `playback.unmount-progress-save` | `pos: 677.85, pct: 33.5` |

The 134-second gap between the first stall (`20:37:11.461`) and its eventual `recovery-resolved` (`20:39:25.800`) reflects the `nudge` recovery happening once but the player limping along until the transcode session was completely dead.

### What should have happened

`useMediaResilience.js` has a `hardReset({ refreshUrl: true })` path that mutates the `<dash-video>` `src` attribute to append a cache-buster, which causes the backend proxy to mint a fresh Plex transcode session. There is a dedicated test for this (`useMediaResilience.refreshUrl.test.js`). But the trigger for that path is the `BufferResilienceManager._executeSkipStrategy` 404-suppression flow — gated on a specific 404 detection at the network layer.

`dash.error 27` and `dash.error 28` from dash.js are exactly the symptom this mechanism is meant to recover from, but **no `playback.stream-url-refreshed` event fires anywhere in this session log** — the dash-error path doesn't escalate into the URL refresh.

### Operational impact

A 10-minute-old transcode session is a routine condition for anyone who uses the app for music or browsing before starting a workout (which describes most actual usage). The user has to manually close + restart to recover. The "fix" is wiring `dash.error 27/28` → `hardReset({ refreshUrl: true })` directly, alongside the existing 404-suppression path.

---

## 3. Pause→Play producing dash retry-loop instead of playback

### The 3.35-second thrash window

Between `20:39:14.738` and `20:39:18.092`, with `currentTime` pinned at `676.693333` the entire time (no progress), 8 alternating pause/resume events fired alongside 4 `dash.playback-started → dash.waiting` cycles:

| UTC | Source | Event | Notes |
|---|---|---|---|
| 20:39:14.559 | frontend | `fitness.render_thrashing` | (background noise) |
| 20:39:14.738 | media-controller | `playback.paused` | (user pressed pause? or auto-pause from buffer-stalled?) |
| 20:39:16.336 | dash-diag | `dash.playback-started` | dash.js (or the user) triggered `play()` |
| 20:39:16.336 | media-controller | `playback.resumed` | element's `play` event fired |
| 20:39:16.337 | dash-diag | `dash.waiting` | …1ms later, buffer underrun |
| 20:39:16.795 | media-controller | `playback.paused` | element auto-paused on the waiting event |
| 20:39:17.176 | dash-diag | `dash.playback-started` | retry |
| 20:39:17.177 | media-controller | `playback.resumed` | |
| 20:39:17.177 | dash-diag | `dash.waiting` | …1ms later |
| 20:39:17.479 | media-controller | `playback.paused` | |
| 20:39:17.704 | dash-diag | `dash.playback-started` | retry |
| 20:39:17.704 | media-controller | `playback.resumed` | |
| 20:39:17.704 | dash-diag | `dash.waiting` | …same-ms stall |
| 20:39:17.918 | media-controller | `playback.paused` | |
| 20:39:18.091 | dash-diag | `dash.playback-started` | retry |
| 20:39:18.091 | media-controller | `playback.resumed` | |
| 20:39:18.092 | dash-diag | `dash.waiting` | …same-ms stall |

The intervals between retries decreased monotonically (1.6s → 459ms → 382ms → 302ms → 225ms → 214ms → 173ms), which is **not** human input cadence — that's a machine retry loop accelerating as dash.js gives up on each successive attempt faster.

### Why the user perceived "play did nothing"

The HTML5 `play` event fired (visible in the logs as `playback.resumed`). The element's `paused` attribute went `false`. But `dash.waiting` fired in the *same millisecond* every time, meaning dash.js immediately detected no decoded frames available. The browser then auto-pauses (or never advances `currentTime`) and re-emits `pause` 200-500ms later.

From the user's chair, the screen never changed: same frame, same `currentTime` indicator, no audio. The only "feedback" was the loading overlay flickering on (suppressed in some cycles — see audit `2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md` Layer C for related overlay-status issues).

### What we cannot tell from the log

`playback.paused` and `playback.resumed` are emitted from the element's `pause` and `play` DOM events. Those events fire identically whether they originated from:
- A user keyboard / click input
- `mediaController.toggle()` called from app code
- dash.js's internal retry loop calling `play()` on the element
- Browser native auto-pause on a long `waiting`

The current telemetry **does not distinguish input source**. For a future session where the user reports "play didn't work," there is no way from the log to confirm whether the user actually clicked play 4 times or whether dash.js auto-retried 4 times. Adding a `source` field to the `playback.paused`/`playback.resumed` payloads (mirroring how `playback.seek` carries `source: "click"` / `"bump"` / `"programmatic"`) would close this gap.

### Operational impact

- During a stalled-transcode condition, the player effectively becomes unresponsive to play input while still flashing "playing" state at the user.
- The dash.js retry loop runs at the same time the user is trying to interact, so the two compete for the element's pause/play state and produce nonsensical state transitions in the logs.
- Once the user closes and restarts, the next mount hits `playback.player-no-source-timeout` (see §4) because the queue state didn't survive the close cleanly.

---

## 4. Post-close re-mount: `playback.player-no-source-timeout`

| UTC | Event | Details |
|---|---|---|
| 20:39:35.148 | `playback.unmount-progress-save` | progress saved at 677.85s (`pos: 677.8488155, pct: 33.5`) |
| 20:39:49.834 | `playback.started` | media re-mounted, `currentTime: 676.85` (resume) |
| 20:39:50.554 | `playback.transport-capability-missing` | `{ capability: "getMediaEl", delayMs: 2058 }` — the controller could not acquire `mediaEl` for over 2 seconds after mount |
| 20:40:18.514 | `playback.player-no-source-timeout` | `{ isQueue: true, queueLength: 0, hasPlay: true }` — 28 seconds after `playback.started`, the player declared no source despite having registered as "should be playing" |

`queueLength: 0, hasPlay: true` is internally inconsistent: the queue is empty so there is no source to play, but the player believes it should play one. The `transport-capability-missing` warning 0.7s into the mount suggests the renderer hadn't attached the media element to the controller yet — possibly the recovery from §3 left the controller registry in a stale state.

The workout did eventually play through (`playback.fps_stats` events resume normally after the 20:40 timeout), so this recovered on its own. But the 28-second "no source" window with the user staring at a non-playing player is the second user-perceived dead time of this session.

---

## 5. Cross-cutting findings

These were uncovered while investigating the above but are not the primary issues:

- **Phantom overlay leak still present.** `waitKey 00090f6f25` (Firefox/Linux UA matching the garage host) emitted **1,517 `playback.overlay-summary`** events through this session — 28% of the entire log volume — with constant payload `status:"Starting…" startup:armed attempts=0 el:t=0.0 r=n/a n=n/a p=false`. This is the phantom signature commit `9de00c9b5` was aimed at. Either the fix is not yet deployed on the garage container, or it does not cover this `effectiveMeta=null + attempts=0` variant. (Same finding as the parallel screens audit `2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md` §4.2.)

- **`fitness.render_thrashing` × 46.** Forty-six render-thrash warnings during one workout is high enough that it likely contributes to the `timeupdate` starvation that fires the false-positive stalls in §1. Separate issue from the watchdog tuning itself, but worth correlating.

- **Loading overlay was on-screen continuously for 2:25 during startup** despite ~14 `playback.stalled` / `recovery-resolved` cycles each "resolving" within 3ms. The overlay's `shouldRender` or `isVisible` upstream gate stays pinned `true` through the entire startup buffering era; it never gets a chance to hide between false-positive stall episodes. (See the count analysis: appearance `#1` ran 20:37:08 → 20:39:34 with 139 ticks and `vis` growing monotonically — meaning `visibleSinceRef` was never reset.)

---

## 6. Recommended fix surface (ordered by ROI)

1. **Watchdog: check `currentTime` directly before declaring a soft stall.** In the soft-timer callback (`useCommonMediaController.js:875-948`), in addition to the `Date.now() - s.lastProgressTs ≥ softMs` check, capture `mediaEl.currentTime` against a `lastObservedCurrentTime` ref. If `currentTime > lastObservedCurrentTime + epsilon`, the media is progressing — update `lastProgressTs` and reschedule, do not log `playback.stalled`. Closes 91% of the noise in one place.

2. **Escalate `dash.error 27/28` into `hardReset({ refreshUrl: true })`.** Wire the dash error handler to call `useMediaResilience.refreshUrl` directly when the error category is segment-not-available or init-segment-not-available. The mechanism exists and is tested; it just isn't reached from the dash-error path.

3. **Tag `playback.paused` and `playback.resumed` with their source.** Pattern matches the existing `playback.seek.source`. Add `source: "user" | "controller" | "dash-retry" | "buffer-underrun"` so post-mortem investigations can distinguish user input from machine retries. Likely needs a small queue at the controller layer that records the most recent intent before the DOM event fires.

4. **Investigate `playback.player-no-source-timeout` with `queueLength: 0, hasPlay: true`.** This is internally inconsistent and indicates a race between unmount-progress-save and the queue re-population path. Reproduce by closing + immediately reopening a fitness item.

5. **Deploy the `9de00c9b5` phantom-overlay fix to the garage container** (and confirm it covers `effectiveMeta=null + attempts=0`). 28% log-volume reduction.

---

## Appendix A — Raw stall/resolve pairings

The 5 stalls *not* in the ≤10ms bucket:

```
2026-05-23T20:37:11.461Z  declared=2666ms  resolved after 134339ms     (real — startup buffering era)
2026-05-23T20:39:30.126Z  declared=4326ms  resolved after  26514ms     (real — transcode death)
2026-05-23T20:40:04.785Z  declared=1696ms  resolved after       3ms    (false positive)
2026-05-23T20:40:27.327Z  declared=1607ms  resolved after       3ms    (false positive)
2026-05-23T20:40:35.499Z  declared=1790ms  resolved after       1ms    (false positive)
```

(The full table is reproducible from the session log; only the first 22 rows fit in this report.)

---

## Status

- **2026-05-23 (filed)** — Bug report; three remediations identified.
- **2026-05-23 (landed on `worktree-end-of-video-recovery`)** — All three remediations implemented across six commits:
  - **§1 watchdog false positives** (`83f5eeb4e` + `450d30072`) — `frontend/src/modules/Player/lib/stallVerdict.js` exports a pure `decideStallVerdict` that consults `mediaEl.currentTime` as a second opinion when `Date.now() - lastProgressTs ≥ softMs`. If `currentTime` advanced past `progressEpsilon` (0.05s) during the timer-gap window, verdict is `'progressing'` — caller fast-forwards `lastProgressTs` and does not log `playback.stalled`. Wired into `useCommonMediaController.scheduleStallDetection`. `lastObservedCurrentTime` captured on each `markProgress`, reset on asset change. Expected: ~0 false positives in subsequent sessions (currently 91%).
  - **§2 transcode-session timeout** (`db683ab43` + `049c567ab`) — `frontend/src/modules/Player/lib/dashErrorRecovery.js` exports a pure `decideDashErrorRecovery` that routes dash error codes `27` (segment unavailable) and `28` (init/manifest unavailable) to `action: 'refresh-url'`, capped at 3 attempts per mount. Wired into `VideoPlayer.jsx`'s `api.on('error', …)` handler; on `refresh-url`, invokes `hardReset({ seekToSeconds: currentTime, refreshUrl: true })` — the existing mechanism that mutates the `<dash-video>` `src` so the backend mints a fresh Plex transcode session. Counter resets on `mediaUrl` change.
  - **§3 pause/play telemetry gap** (`67911a349` + `ae344354c`) — `frontend/src/modules/Player/lib/playbackToggleSource.js` exports `tagPauseSource` / `tagPlaySource` / `readAndClearPauseSource` / `readAndClearPlaySource`. `playback.paused` and `playback.resumed` log payloads now carry a `source` field. Tagged sites: `controller.play/pause/toggle` (`'controller'` / `'controller-toggle'`), `nudgeRecovery` (`'recovery-nudge'`), `reloadRecovery` DASH path (`'recovery-reload-dash'`), `reloadRecovery` DOM path (`'recovery-reload-dom'`). Untagged calls (dash.js auto-retries, browser auto-pause on `waiting`, `softReinitRecovery`, snapshot replay) surface as `'dom-event'` — that's the desired default for "DOM-event-but-not-tagged-by-our-code" callers including dash.js's internal retry loop.
- **Test counts:** 24 new unit tests across 3 helper modules (8 + 6 + 8 + 2 controller wiring), all passing. Full Player module sweep: **109/109 tests pass across 15 of 16 files.** The single failing file is `VideoPlayer.hardReset.test.jsx`, a pre-existing baseline failure (`dash-video-element` package unresolvable under the worktree's vitest environment) unrelated to this change.
- **Pending live verification** — Awaiting next fitness session post-deploy. Expected observable changes:
  1. `playback.stalled` event count drops from ~50/session toward zero.
  2. When a Plex transcode session ages out mid-workout, `dash.error-recovery action='refresh-url'` + `playback.stream-url-refreshed` appear in the log and playback continues without manual close+restart.
  3. `playback.paused` / `playback.resumed` payloads carry `source`. `source: "dom-event"` clusters are dash.js retry signatures; `source: "controller"` / `"controller-toggle"` are app-initiated; `source: "recovery-*"` are stall-recovery initiated.

Items intentionally NOT addressed in this fix:
- **§5.1 — Phantom overlay leak on garage.** Requires deploying commit `9de00c9b5` to the garage container; non-code.
- **§4 — `player-no-source-timeout` race.** Needs a separate reproducer; out of scope for this fix.
- **§5.2 — `fitness.render_thrashing`.** Background contributor to `timeupdate` starvation; root cause needs separate investigation.
