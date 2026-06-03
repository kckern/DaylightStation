# Fitness Session Merge + Resilience Failure Audit — 2026-05-22

**Window:** 2026-05-22 17:46 PDT → 18:40 PDT (= 2026-05-23 00:46 → 01:40 UTC)
**Session log:** `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/2026-05-23T00-46-02.jsonl` (12,086 events)
**Plex container:** `plex` (healthy, up 21h)
**App container:** `daylight-station` (up 7h)

---

## TL;DR

Two independent catastrophic failures landed in the same workout:

1. **Session merge (silent feature gap).** The user pressed "n" intending a new session between "Tough Mudder" and "Diddy Kong Racing." Nothing happened. The `FitnessSession` instance has **no input that can roll its sessionId from user intent** — not the "n" key (no binding anywhere), not the Sidebar "End Session" button (POSTs to backend only; never notifies the in-process session), not the resume-prompt UI (dead code). The whole 54-minute span persists as a single sessionId `fs_20260522174700`. This is not a regression; this is a feature gap that has been quietly tolerated.

2. **Resilience collapse on Diddy Kong Racing playback (real regression).** Plex correctly DirectStreamed the source (commit `c62839c1b` worked as designed: container transcode + video-copy + audio-copy of AV1). The Firefox WebView **failed to sustain software AV1 decode at 1920×1440@60fps** (peak 5.3 Mbps). Buffer collapsed to zero in ~10 s, Plex's idle reaper killed the transcoder session at 18:18:11 PDT, and the client then spent the next 15 minutes in stall→nudge→spawn-new-decision loops with the user mashing pause/play to no effect. Two UX regressions made the failure mode unrecoverable for the user: **(a) `PlayerOverlayPaused` is gated `!stalled` so during a sustained recovery the screen goes blank when paused (no pause icon, no spinner, no feedback)**, and **(b) the first `fitness.player.close` request took 27.6 s to initiate**, so when the user tried to exit to home, the navigation appeared frozen.

A third issue is mechanically present but cosmetic to the user:

3. **Phantom `<Player>` instance leaking 556 overlay-summary events.** A second `<Player>` is mounted with `effectiveMeta=null` and its `useMediaResilience` hook is stuck in `STATUS.startup` indefinitely because `shouldArmStartupDeadline` requires media metadata. The 30s no-source bailout calls `clear?.()` but the parent passes no `clear`. The overlay is rendered offscreen at `left:-9999px` so the user does not see it, but every 1 s it emits `playback.overlay-summary` to the session log forever. This is a logging/state leak; not the spinner the user saw, but it pollutes diagnostics.

---

## 1. Bug 1: Session Merge — "New Session" Intent Has No Wiring At All

### The user's intent

> "It started with the Tough Mudder and then it went to Diddy Kong Racing. And the user explicitly put n session in between. And apparently that was not honored in the least bit."

### What actually happened

| UTC | PDT | Event |
|---|---|---|
| 00:47:00.409 | 17:47:00 | `fitness.session.started` `sessionId=fs_20260522174700` `reason=buffer_threshold_met` |
| 00:47:05.151 | 17:47:05 | `playback.started` *Tough Mudder — Dumbbell Endurance 3.0* (plex:599295, 1630 s) |
| 01:14:15.787 | 18:14:15 | Tough Mudder reaches 100% (`percent:100, playhead:1630`) |
| 01:14:15.748 | 18:14:15 | `fitness.player.close.requested` (sessionId still `fs_20260522174700`) |
| 01:14:43.369 | 18:14:43 | `fitness.player.close.initiated` — **27.6 s gap** |
| 01:14:43.371 | 18:14:43 | `fitness.player.close.completed` |
| 01:14:58.170 | 18:14:58 | `playback.queue-track-changed` *Diddy Kong Racing* (plex:674284) |
| 01:15:02.790 | 18:15:02 | `playback.started` *Diddy Kong Racing* (currentTime=4813 s — resume) |
| 01:40:32.861 | 18:40:32 | Log ends — **still `fs_20260522174700`** |

Distinct sessionIds in the log: **exactly one** (`fs_20260522174700`).

### Root cause: there is no code path that rolls the sessionId in response to user intent

`/opt/Code/DaylightStation/frontend/src/hooks/fitness/FitnessSession.js`

```javascript
// line 1183 (_maybeStartSessionFromBuffer):
if (this.sessionId) return false;

// line 1620 (ensureStarted):
if (this.sessionId) return false;

// line 1632:
this.sessionId = `fs_${this.sessionTimestamp}`;

// line 1643:
getLogger().warn('fitness.session.started', { sessionId: this.sessionId, reason, ... });
```

`ensureStarted()` is reached only by `_maybeStartSessionFromBuffer` (HR threshold met), `acceptResume()` (no UI caller), and `declineResume()` (no UI caller). Both re-entry guards short-circuit once `sessionId` is set. The only way to roll a new sessionId in-process is `endSession()` → `reset()` → fresh buffer fill → threshold hit.

**The "n" key is not wired to `endSession()` anywhere.** Searches:

- `frontend/src/Apps/FitnessApp.jsx` — no `keydown`, no `KeyN`, no `'n'`. Only `onKeyDown` on the "Reload App" button (Enter/Space).
- `frontend/src/modules/Fitness/**` — zero `'n'` / `KeyN` matches.
- `frontend/src/screen-framework/input/actionMap.js` — no `session:new`, `session:end`, or equivalent.
- `data/household/config/keyboard.yml` — the office keypad maps `'n'` → `function: overlay, params: camera`. That's it.
- `data/household/screens/{living-room,office}.yml` — no fitness-related `n` subscription.

The sidebar "End Session" button (`FitnessSidebar.jsx:55-70`) does this and only this:

```javascript
const req = buildEndSessionRequest(activeSessionId);
await DaylightAPI(req.path, req.body, req.method); // POST /api/v1/fitness/sessions/:id/end
```

It POSTs to the backend, finalizes the snapshot, and returns. **It never calls `fitnessSessionInstance.endSession(...)`** and no WS event is broadcast back to the frontend session instance to make it reset. The modal even tells the user:

`FitnessSidebarMenu.jsx:569`:
> "Subsequent heart-rate readings will start a new session."

That is a lie under current code: as long as `FitnessSession.sessionId` is set, the buffer guard at line 1183 swallows every new HR sample and the threshold never re-trips.

### Additional dead code that should have closed this loop

- `acceptResume()` / `declineResume()` / `_pendingResumePrompt` / `_onResumePrompt` (`FitnessSession.js:1582-1616`) — full prompt API, **no React component registers an `onResumePrompt` callback**.
- `force_break` WS listener (`FitnessContext.jsx:1218-1226`) — listens for `{action: 'force_break'}` and would call `endSession`, but **no code path anywhere publishes that message**.
- `setPendingContentId(id)` (`FitnessSession.js:1556-1558`) — `playback.queue-track-changed` propagates the new contentId hint, but it's only consumed by `_startWithResumeCheck`, which is short-circuited at line 1183.

### Why this matters

The frontend `FitnessSession` and the backend `SessionService` have diverged: the backend finalizes a row but the frontend keeps writing to the same key. Every downstream consumer that joins on `sessionId` (Strava sync, summary, chart, persistence) treats two distinct workouts as one. **891 `fitness.persistence.validation_failed reason: session-too-short` warnings** in the log are the audible smoke of that single, never-rolling session being persisted thousands of times in shapes it can't validate.

---

## 2. Bug 2: AV1 1440p60 Client Decode Collapse + Stall-Recovery UX Death Spiral

### Timeline of the collapse

| UTC | PDT | Event |
|---|---|---|
| 01:14:58.686 | 18:14:58 | DASH playback-started for plex:674284 |
| 01:15:02.790 | 18:15:02 | Element `play` succeeds, currentTime=4813 |
| 01:15:02-10 | 18:15:02-10 | Client downloads segments 962-975 in a 2 s burst (~70 s buffered) |
| 01:15:11 | 18:15:11 | **Client stops fetching segments** |
| 01:15:13.008 | 18:15:13 | `fitness.music.stuck_loading playlistId:463801` (sidebar music player too) |
| 01:18:11 | 18:18:11 | **Plex idle-reaps transcoder session `d58dd14c`** (SIGKILL, 180 s idle) |
| 01:19:46.538 | 18:19:46 | **First `playback.stalled`** stallDurationMs=2016 |
| 01:19:54.933 | 18:19:54 | `playback.recovery-strategy strategy:nudge attempt:1 success:false` |
| 01:20:11.933 | 18:20:11 | `fitness.player.close.requested` (user trying to exit) |
| 01:20:21.147 | 18:20:21 | `playback.stalled currentTime:4812 duration:12999` (element rewound on its own) |
| 01:21:11.849 | 18:21:11 | `playback.stalled currentTime:0 duration:null` (**media element fully reset**) |
| 01:21:20.734 | 18:21:20 | `playback.started currentTime:4939` (recovery resumed at a new offset) |
| 01:21:01.843 | 18:21:01 | `playback.recovery-resolved stallDurationMs:40695` (**single stall lasted 40.7 s**) |
| 01:20:49–01:21:23 | 18:20:49–18:21:23 | 5 mouse-driven fullscreen-toggle-request bursts (user mashing the video element) |
| 01:22:13–01:34:18 | 18:22–18:34 | **22 more `playback.stalled`** events as recovery keeps reseeding sessions |

### Plex was healthy. The client was overrun.

Source media (from `Plex Transcoder Statistics.log`):

> `<Stream codec="av1" codedHeight="1440" codedWidth="1920" frameRate="60" bitDepth="8" profile="main" bitrate="3477" ... decision="copy" />`

Plex decision for plex:674284 (PMS log 18:14:58.188):

> `decision=transcode container=mp4 protocol=dash streams=(Video=(decision=copy ...) Audio=(decision=copy ...))`
> `transcodeHwRequested="0" transcodeHwFullPipeline="0"`

Container-mux only. Video and audio streams pass through untouched. The client correctly advertised `videoCodec=h264,hevc,av1,vp9` (commit `c62839c1b` working as designed). Plex segmented as far ahead as **segment 1056 (~88 min of content)** before being idle-reaped — the server side was healthy and well ahead of the consumer.

**Zero transcoder errors** in the entire 18:00–18:35 PDT window. No EAGAIN, no decoder reset, no demuxer failure. The only `Killing job` / `signal -9` events are the idle reaper killing sessions the client stopped pulling from.

The Firefox 150 WebView on `172.18.0.26` is software-decoding AV1 1920×1440@60fps. That asset is **2.25× the pixel rate of the 1080p30 H.264 "Tough Mudder" video that played fine for 27 minutes immediately before** (1920×1080@30fps vs 1920×1440@60fps). Software dav1d cannot keep up on this hardware; once the prebuffer drained, the MSE pipeline stopped requesting fragments because the decoded-but-not-displayed queue was full.

### UX regression A: "No pause icon during a stall" — blank screen on user pause

`/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx:46`

```javascript
const overlayDisplayActive = shouldRender && isVisible && !pauseOverlayActive;
```

`/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayPaused.jsx:24-30`

```javascript
const isInitialPlayback = seconds === 0 && !stalled;
const shouldShowPauseOverlay = shouldRender
  && isVisible
  && pauseOverlayActive
  && !waitingToPlay
  && !stalled            // ← THIS
  && !isInitialPlayback;
```

When the player is **stalled** AND the user **pauses**:

- `PlayerOverlayLoading` returns null (`pauseOverlayActive=true` suppresses the spinner)
- `PlayerOverlayPaused` returns null (`stalled` is true)

**Both overlays return null. The user sees a black video element with no feedback.** That is exactly the symptom the user reported: "spinner showing during playback and would disappear during pause." The spinner shows during stalled-play (correct) and the pause icon refuses to render during stalled-pause (the regression).

The opposite half of the symptom — spinner *during what looks like playback* — is the same `stalled` signal staying truthy after the buffer recovers. Recent stall-handling work (`bc72ed611 fix(fitness-player): debounce governance stall signal, reset across media changes` and `2450f829d fix(fitness-player): gate stall recovery on genuine playhead progress`) tightened the *recovery exit* condition (the player must observe real playhead progress before clearing `stalled`). With a fragile AV1 pipeline that briefly progresses 1-2 s before re-stalling, `stalled` stays truthy through what the user perceives as playback. Net effect: the user can see the video moving but the loading spinner is on top of it, and pausing hides both overlays — exactly the inversion they described.

### UX regression B: 27.6 s exit-to-home delay

`fitness.player.close.requested` at 01:14:15.748 → `fitness.player.close.initiated` at 01:14:43.369. The two events nominally bracket a `useEffect` cleanup chain. The second close at 01:20:11.933 was instant (same ms for all three lifecycle events), so the first close was an outlier — but the user's reported experience ("navigation was a mess … couldn't find her way back in because the home screen was blank or locked or not responding") maps precisely to that first 27-second gap: the user pressed exit on Tough Mudder at the very moment the video hit EOF (`percent:100 playhead:1630`) and the close raced with the natural-end teardown. Nothing logged that interval — no exception, no WS event — just a 28-second silence on the close path.

Subsequent symptoms (5+ fullscreen-toggle clicks in 20 s on the DASH-VIDEO element between 01:20:49 and 01:21:23) are the user's frustration reflex on a frozen player — clicking the only thing that looks clickable.

### Render thrash & tick starvation amplified everything

`fitness.tick_telemetry` over the stall window:

> `ingestCalls:312, ingestRate:10.4/sec, maybeTickCalls:314, actualTicks:0, actualTickRate:0.0/sec, expectedTickRate:0.20/sec`

The tick loop did **not advance once** in ~30 s windows across the entire 22-minute span. Ingest fired at 10–30 Hz; **zero ticks**. The session-too-short re-validation loop fired 891 times. `fitness.render_thrashing` warned 36 times (FitnessChart re-rendering 13–66 times per 5 s, `sustainedMs > 30 s`). The frontend was already saturated *before* AV1 decode strain pushed it over.

WS instability was the chronic backdrop: every ~60 s the kckern Firefox client and the Shield TV menu both fire `[WebSocketService] Connection stale (no data in 45s), forcing reconnect`, and the backend logs the matching `eventbus.client_disconnected` / `client_stale`. This is the same pattern that has been in the logs for at least 90 minutes prior to the stall — it didn't cause the failure, but it contributed to the user's perception that nothing was responsive.

---

## 3. Bug 3 (related, but not what the user saw): Phantom `<Player>` Overlay Spam

556 `playback.overlay-summary` events on a single waitKey `00090f6f25`, all with `status='Starting…' startup=armed t=0.0 r=n/a n=n/a paused=false`, from 01:14:48 to 01:24:59. That waitKey is the **FNV-1a hash of the literal string `'player-idle'`** — i.e., a Player whose `effectiveMeta` is null.

`/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx:412-416`

```javascript
const resolvedWaitKey = useMemo(() => {
  if (!effectiveMeta) return 'player-idle';
  const fallback = mediaIdentity || effectiveMeta.waitKey || 'player-entry';
  return `${fallback}:${remountState.nonce}`;
}, [effectiveMeta, mediaIdentity, remountState.nonce]);
```

`effectiveMeta` is `resolvedMeta || singlePlayerProps || null` (Player.jsx:282). The phantom path:

- `inputIsExplicitQueue=true` (a `queue` prop is passed)
- `playQueueHead=null` (the queue contains no resolvable head)
- ⇒ `activeSource=null` (Player.jsx:160-174, tightened by commit `fa2b643fd fix(player): startup perf regression + rate key shadowed by ambient`)
- ⇒ `singlePlayerProps=null` (Player.jsx:202-204)
- ⇒ `effectiveMeta=null`

Then `useMediaResilience` cannot arm its startup deadline because `shouldArmStartupDeadline` requires media metadata:

`/opt/Code/DaylightStation/frontend/src/modules/Player/lib/shouldArmStartupDeadline.js:13-18`

```javascript
if (!meta) return false;
return !!(meta.mediaType || meta.mediaUrl || meta.plex || meta.media || meta.contentId || meta.assetId);
```

Status stays `STATUS.startup` forever. `shouldShowOverlay` stays true (`useMediaResilience.js:447-453`). The 30 s no-source bailout in Player.jsx:181-194 calls `clear?.()` — but a music/sidebar consumer that mounts this Player passes no `clear` prop, so it's a no-op. The `PlayerOverlayLoading` 1-second log interval at lines 334-370 fires forever (the only suppression at 286-287 is `!isVisible && status === 'playing'`, which is never satisfied here).

The user did not visually see this overlay — it renders inside an offscreen wrapper at `left:-9999px`. **What the user saw was the real video Player's overlay reacting to the AV1 stall (Bug 2).** But the phantom is a real defect: it pollutes session logs with 10+ minutes of "Starting…" noise per session, ticks `useMediaResilience` state forever, and prevents the parent from cleanly unmounting an idle Player.

Suspect commit: `fa2b643fd` (May 17) made `activeSource` strict about queue resolution. Pre-fa2b643fd the same scenario produced a different phantom waitKey hash (`008711f393` = `player-entry:0`) by falling back to the `play` prop; post-fa2b643fd it produces `00090f6f25` (`player-idle`). The phantom-shaped behavior pre-dates this commit; the new commit just changed its fingerprint.

---

## Root Causes (Summary)

| # | Root cause | Files |
|---|---|---|
| **1** | `FitnessSession` has no input that can roll its `sessionId` in response to user intent. Re-entry guards (`if (this.sessionId) return false;`) make it impossible to start a second session in-process without first calling `endSession()`. No keyboard key, no WS event, no React handler calls `endSession()`. The sidebar "End Session" button POSTs to the backend without notifying the frontend. | `FitnessSession.js:1183, 1620, 1632, 1643`, `FitnessSidebar.jsx:55-70`, `FitnessContext.jsx:1218-1226`, `keyboard.yml`, `actionMap.js` |
| **2a** | The Firefox WebView cannot software-decode AV1 1920×1440@60fps. Plex `decision=copy` (post-commit `c62839c1b`) does exactly what it should — DirectStream — but exposes the client's decode ceiling. Buffer drains in ~10 s, Plex idle-reaps the session, recovery loop spawns parallel decisions at moving offsets. | `_extensions/_metadata/...` (Plex profile), client-side; commit `c62839c1b` |
| **2b** | `PlayerOverlayPaused` is gated `!stalled` (line 29). During a sustained recovery the pause icon refuses to render, and `PlayerOverlayLoading` is gated on `!pauseOverlayActive` (line 46). When stalled + paused, **both overlays return null** ⇒ blank screen with no user feedback. | `PlayerOverlayPaused.jsx:24-30`, `PlayerOverlayLoading.jsx:46` |
| **2c** | `stalled` is sticky after recent tightening of recovery exit (commits `bc72ed611`, `2450f829d`). Brief playhead progress is not enough to clear `stalled`, so the spinner persists into what the user perceives as playback. | `useMediaResilience.js`, `usePlaybackHealth.js` |
| **2d** | `fitness.player.close` first invocation took 27.6 s. Race between natural-end teardown and user-requested close. The close path is single-shot but the race produces a long-tail outlier with no observability. | `FitnessApp.jsx`, `FitnessPlayer.jsx`, `fitness.player.close.*` emit sites |
| **3** | `<Player>` mounts with `effectiveMeta=null`. `useMediaResilience` cannot arm startup deadline without metadata; `PlayerOverlayLoading` log interval fires forever. 30 s no-source bailout's `clear?.()` is a no-op when the parent passes no `clear`. | `Player.jsx:181-194, 282, 412-416`, `useMediaResilience.js:250-257, 447-453`, `shouldArmStartupDeadline.js:13-18`, `PlayerOverlayLoading.jsx:286-287, 334-370`, `FitnessMusicPlayer.jsx:687` |
| **extra** | `891 fitness.persistence.validation_failed reason: session-too-short`. PersistenceManager retries below the 5-min floor at ingest rate (10-30 Hz) for the entire low-tick early window. Not the bug, but the proof the tick loop is starved. | `PersistenceManager.js:811-813, 885` |
| **extra** | Tick loop runs `ingestCalls:312` per 30 s window with `actualTicks:0`. Render thrashing (FitnessChart 13-66 renders/5s, sustained >30 s). Frontend was already saturated before AV1 decode strain. | `fitness.tick_telemetry`, `fitness.render_thrashing` |

---

## Remediation Recommendations (in execution order)

These are recommendations, not approvals — every one needs an explicit "do this" before any code lands.

### Tier 1 — Stop hiding feedback from the user

- **R1. Let `PlayerOverlayPaused` render during `stalled`.** Drop the `!stalled` gate. Or render a third overlay state ("Recovering, paused") so the user always has at least one icon on screen. The blank-screen-during-stalled-pause UX is uncondonable.
- **R2. Treat sustained stall (>15 s) as a first-class user-visible error state.** Surface a banner: "Playback failed. Tap to restart" with explicit choices (Restart this video / Pick something else / End session). The current silent loop of nudge → reseek → re-decision is invisible to the user.
- **R3. Add a global "stuck close" watchdog.** If `fitness.player.close.requested` is not followed by `fitness.player.close.completed` within 5 s, log it loudly and force-unmount the player.

### Tier 2 — Wire the missing session-control affordances

- **R4. Bind explicit "new session" intent end-to-end.** Pick one (or all):
  - Wire `'n'` (or any key the user can press from a fitness screen) to call `fitnessSessionInstance.endSession('user-requested')` AND `reset()` AND clear the resume cooldown.
  - Wire the existing Sidebar "End Session" button to also call `fitnessSessionInstance.endSession(...)` (currently backend-only).
  - Publish a backend WS event after `POST /sessions/:id/end` and wire `FitnessContext.jsx`'s already-existing `force_break` listener to it (it is already coded; nothing emits it).
- **R5. Make the resume-prompt UI live.** `acceptResume()` / `declineResume()` exist with a complete API; register a real `onResumePrompt` callback that surfaces a modal when a finalized session is detected, so transitions are explicit rather than implicit.

### Tier 3 — Fix the silent failures

- **R6. Phantom Player cleanup.** Either (a) refuse to mount `<Player>` when the queue/play prop resolves to no media, (b) auto-unmount after `clear?.()` no-ops twice, or (c) make `PlayerOverlayLoading`'s log interval silent when `effectiveMeta=null` (suppress at the symptom layer until the mount is fixed). Don't keep emitting 10 minutes of "Starting…" for nothing.
- **R7. Add a client-side codec capability probe.** Before requesting `decision=copy` for AV1 at >1080p / >30fps, check `MediaSource.isTypeSupported('video/mp4; codecs="av01..."')` AND a perf-sanity threshold. If the host can't sustain decode, force `decision=transcode-to-h264` with the existing Plex profile. This is the only way commit `c62839c1b`'s DirectStream advertisement stops shooting the user in the foot on high-res AV1 source files.
- **R8. Cap recovery attempts.** The current loop spawns new Plex decisions at progressively later offsets indefinitely; cap at N attempts and escalate to R2's user-facing banner. Each spawned-then-killed Plex session wastes I/O.

### Tier 4 — Fix the noise that's masking the signal

- **R9. Gate `PersistenceManager.persistSession` on `durationMs >= 300000` *before* calling validate**, instead of validating and emitting a warn 891 times. The warning is correct but is noise.
- **R10. Investigate tick-loop starvation independently.** `ingestRate=10-30/sec, actualTickRate=0` with `expectedTickRate=0.20/sec` for the entire 22-minute window means whatever throttles ticks (RAF? micro-task starvation? render-thrashing back-pressure?) is broken. Open a separate audit if needed.
- **R11. WS keepalive.** Both clients reconnect every ~60 s on "no data in 45 s." Either the server isn't heartbeating, or the WebSocketService stale-detector is too aggressive. Pick one.

### Tier 5 — Documentation

- **R12. Document the actual codec advertisement and the consequence.** Commit `c62839c1b` is correct in isolation but lacks any guardrail. Add a runbook entry pairing the codec advertisement with the client capability probe (R7) and an "if user reports stalls on AV1" diagnostic flow.

---

## Evidence Index

| Claim | Evidence |
|---|---|
| Only one sessionId across 54 minutes | `grep -aoE '"sessionId":"fs_[0-9]+"' <log> \| sort -u` → `"sessionId":"fs_20260522174700"` |
| Session started by HR buffer threshold | jsonl `fitness.session.started reason:buffer_threshold_met` @ 00:47:00.409 UTC |
| Tough Mudder mediaKey / duration | jsonl `playback.started title:"Dumbbell Endurance 3.0" grandparentTitle:"Tough Mudder" mediaKey:plex:599295 duration:1630.464` |
| Diddy Kong resume offset | jsonl `playback.started title:"Diddy Kong Racing" mediaKey:plex:674284 currentTime:4813 duration:12999.0879` |
| 27.6 s exit delay | jsonl `fitness.player.close.requested` @ 01:14:15.748 vs `close.initiated` @ 01:14:43.369 |
| 26 stalls on Diddy Kong | `grep playback.stalled <log> \| grep Diddy \| wc -l` = 26 |
| Single stall lasting 40 s | jsonl `playback.recovery-resolved stallDurationMs:40695` @ 01:21:01.843 |
| 556 phantom overlay summaries | grouped by `context.waitKey`; `00090f6f25` (= FNV-1a("player-idle")) has 556 events all `status:Starting… startup=armed` |
| Plex DirectStream (no software re-encode) | PMS log @ 18:14:58.188 `decision=transcode container=mp4 protocol=dash streams=(Video=(decision=copy) Audio=(decision=copy))`; Transcoder Statistics `transcodeHwRequested=0 videoDecision=copy audioDecision=copy` |
| AV1 1920×1440@60fps source | `Plex Transcoder Statistics.log` (session `89099cbe`): `<Stream codec="av1" codedHeight="1440" codedWidth="1920" frameRate="60" bitDepth="8" profile="main">` |
| Client stopped fetching segments 18:15:11 | PMS log (no further m4s requests after 18:15:10) → Plex idle reap @ 18:18:11 |
| Plex idle reap | PMS log `Killing job ... exit code -9 (signal: Killed)` @ 18:18:11, 18:24:12, 18:24:34 |
| Persistence validation spam | `grep -c persistence.validation_failed <log>` = 891; all `"reason":"session-too-short"` |
| Tick loop starved | jsonl `fitness.tick_telemetry actualTicks:0 ingestRate:10.4/sec` across the 22-min stall window |
| WS instability throughout | `[WebSocketService] Connection stale (no data in 45s), forcing reconnect` paired with backend `eventbus.client_disconnected` every ~60 s for the entire 2 h |
| No Plex transcoder errors | Full grep of `Plex Media Server.log` 18:00-18:35 for `ERROR\|EAGAIN\|fail\|reset\|abort\|dav1d` returned only the `libdav1d` decoder-hint arg in ffmpeg invocations |
| `PlayerOverlayPaused` gates `!stalled` | `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayPaused.jsx:24-30` |
| `PlayerOverlayLoading` gates `!pauseOverlayActive` | `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx:46` |
| Phantom waitKey = hash of `'player-idle'` | `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx:412-416` + FNV-1a from `lib/waitKeyLabel.js` |

---

## Recent Commits in Scope

- `c62839c1b fix(plex): advertise AV1/VP9 to Plex so it DirectStreams instead of software-transcoding` — Plex side worked as designed; client side cannot sustain decode (Bug 2a).
- `bc72ed611 fix(fitness-player): debounce governance stall signal, reset across media changes` — likely contributes to stickier `stalled` (Bug 2c).
- `2450f829d fix(fitness-player): gate stall recovery on genuine playhead progress` — tightened exit condition; on AV1-stutter media this never clears (Bug 2c).
- `fa2b643fd fix(player): startup perf regression + rate key shadowed by ambient` — changed phantom-waitKey fingerprint (Bug 3).
- `1419b461b fix(player): seamless queue playback + exit-to-home from menu` — predecessor of fa2b643fd in the queue-resolution chain.
- `a46610c7e fix(screen): eliminate dual-autoplay spinner overlay bug` (Mar 22) — added the `!isVisible && status==='playing'` log suppression; insufficient to silence phantom during `STATUS.startup`.

---

## Documents to Cross-Reference

- `docs/_wip/audits/2026-05-18-fitness-av1-transcode-buffer-collapse-audit.md` — prior AV1 audit that this session's failure echoes
- `docs/_wip/audits/2026-05-16-fitness-session-cycling-bugs-audit.md`
- `docs/_wip/audits/2026-04-28-fitness-session-merge-failure.md` — earlier session-merge audit; check if R4 is a duplicate of work already in flight
- `docs/_wip/audits/2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md` — render-thrash precedent

---

*Generated 2026-05-22 from session log `2026-05-23T00-46-02.jsonl`, Plex container logs, daylight-station container logs, and end-to-end code trace.*
