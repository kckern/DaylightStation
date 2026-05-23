# Living Room TV — End-of-Video "Stuck Seeking" Audit — 2026-05-23

**Window:** 2026-05-23 19:43:34 UTC → 19:50:38 UTC (= 12:43 → 12:50 PDT)
**Container:** `daylight-station` (up 2h at time of failure)
**Device:** `livingroom-tv` (Shield TV, UA `SHIELD Android TV / Chrome 148`, IP `172.18.0.26`)
**Asset:** *Bluey (2018) — Season 1 — "Teasing"* (`plex:59518`, duration `441.76s` / 7:21.76)
**Player waitKey:** `00a5fca078`
**Recovery:** manual user restart at ~19:51

---

## TL;DR

Bluey "Teasing" played cleanly from resume position `107.0s` through `~441s`. At `19:49:11.400`, a single JavaScript write set `videoEl.currentTime = duration` (intent `441.759999`, identical to duration `441.759999`, tagged `source: "programmatic"`). The DASH session refetched its init segment, then requested fragment 88 (`startTime:440, duration:5`), which Plex returned **`bytes: 0`** because there is no content past `441.76s`. The element settled into `el:t=441.8 r=4 n=2 p=true` (`HAVE_ENOUGH_DATA / NETWORK_LOADING / paused`) and `mediaEl.seeking` never cleared. The `PlayerOverlayLoading` heartbeat then emitted `status:Seeking…` once per second for **87 seconds** until the user manually intervened.

The "video stalled" experience is the **collapse of every resilience layer in the screens player at the same instant**, each layer correctly designed in isolation, none of them composed:

| Layer | What it does | Why it didn't fire |
|---|---|---|
| **Stall watchdog** (`useCommonMediaController.scheduleStallDetection`) | Detects no-progress stalls and runs `nudge → seekback → reload → softReinit` | Explicit guard: `currentTime >= duration - 0.5` skips detection — meant for "natural end" false positives, but the actual natural end never happened either |
| **Overlay status** (`useMediaResilience` → `PlayerOverlayLoading`) | Renders a contextual status string | `effectiveSeeking = isSeeking \|\| mediaEl.seeking` — `mediaEl.seeking` stays `true` after a seek to duration with zero-byte tail fragment; status sticks to `"Seeking…"` |
| **Queue advance** (`ContentScroller.handleEnded`) | Calls `onAdvance()` to move to the next queue item | Wired exclusively to HTML5 `ended`. After a partial-tail seek-to-duration, dash.js does not call `endOfStream()`, so `ended` never fires. No timer fallback. |
| **Buffer resilience** (`BufferResilienceManager._executeSkipStrategy`) | Skip past suppressed-404 hangs via `hardReset` | Only triggers on the suppressed-404 path; the zero-byte trailing fragment was not a 404, it was a `200 OK` with empty body |

The fitness app has a parallel watchdog (`useCloseWatchdog`) for the analogous failure during session close. The screens player has nothing equivalent.

A separate, unrelated finding surfaced during investigation: `playback.fps_stats` emits a **stale `currentTime`** value due to a stale React closure (`VideoPlayer.jsx:533-593`). It reported `currentTime: 107` for the entire 5.5-minute Bluey session despite real playback advancing to 441s. This is logging-only — does not affect behavior — but it actively misleads anyone reading session logs.

---

## 1. Failure Timeline

All timestamps UTC. Source: `docker logs daylight-station`, filtered to IP `172.18.0.26`.

### 1.1 Setup — clean playback

| UTC | Event | Notes |
|---|---|---|
| 19:43:34.392 | `commands.queue` | `op=play-now contentId=plex:59493 prewarmContentId=plex:59532` |
| 19:43:34.721 | `playback.unmount-progress-save` | Previous item (`plex:663154` Sibelius) saves `pos=564.06 pct=27.1` and unmounts |
| 19:43:34.884 | `dash.api-ready` | `src=/api/v1/proxy/plex/stream/59518?offset=107` (server-side offset already at 107s) |
| 19:43:34.982 | `dash.manifest-loaded` | `duration=441.76 type=static` |
| 19:43:35.692 | `playback.start-time-decision` | `requestedStart=0 effectiveStart=0 isDash=true` |
| 19:43:35.694 | `playback.start-time-applied` | `method=dash-immediate intent=107 actual=107 drift=0` — first `programmatic` seek of the session |
| 19:43:36.519 | `playback.started` | `currentTime=107.001865 duration=441.76` |

The video then plays cleanly. Fragment indices step from `173` (audio) upward by 1 per ~5s; no `dash.buffer-stalled`, `dash.fragment-abandoned`, or recovery events between `19:43:36` and `19:49:11`.

### 1.2 The 50ms collapse at the end of playback

| UTC | Event | Payload |
|---|---|---|
| 19:49:11.400 | `dash.seeking` | `seekTime: 441.759999` |
| 19:49:11.403 | `playback.seek` | `phase=seeking intent=441.759999 duration=441.759999 source="programmatic"` |
| 19:49:11.404 | `dash.waiting` | — |
| 19:49:11.405 | `dash.buffer-stalled` | `type=video` |
| 19:49:11.409 | `playback.paused` | `currentTime=441.759999 duration=441.759999` |
| 19:49:11.452 | `dash.seeked` | `actual=441.759999 drift=0` (dash-layer event) |
| 19:49:11.493 | `dash.fragment-loading` | init segment refetch — `…/session/3e38bb69…/0/header` |
| 19:49:11.719 | `dash.fragment-loaded` | `bytes=834` (init segment OK) |
| 19:49:11.719 | `dash.transcode-warmed` | `emptyCount=15` (stale counter from initial warmup carried forward) |
| 19:49:11.746 | `dash.fragment-loading` | `index=88 startTime=440 duration=5` |
| 19:49:11.867 | `dash.fragment-loaded` | `index=88 bytes=0` ← **zero bytes** |

After this point, no further dash events fire for this session. `PlayerOverlayLoading` emits `playback.overlay-summary` once per second with constant payload `el:t=441.8 r=4 n=2 p=true | status:Seeking…` until `19:50:38.786` (the last we observed before manual restart) — 87 consecutive seconds of identical heartbeats.

### 1.3 The HTML5 `ended` event never fires

No `playback.ended`, no `dash.ended`, no `playback.unmount-progress-save` for `plex:59518`, no subsequent `playback.started` for any next item — the only thing that breaks the cycle is the user.

---

## 2. Per-Layer Root Cause

### 2.1 Layer A — The trigger (open question)

The HTML5 `seeking` event only fires when JS writes `currentTime` or calls `fastSeek`. Browser-native end-of-stream does **not** fire `seeking` — it fires `ended`. So the `441.759999` value was set by JavaScript.

`useCommonMediaController.js:1313` documents the `programmatic` tag:

```javascript
mcLog().sampled('playback.seek', {
  mediaKey: assetId,
  phase: 'seeking',
  intent: mediaEl.currentTime,
  duration: mediaEl.duration,
  source: mediaEl.__seekSource || 'programmatic'   // fallback when no caller tagged
}, { maxPerMinute: 30 });
delete mediaEl.__seekSource;
```

Every known seek path tags `__seekSource` before mutating `currentTime`:

| Path | File:line | Tag |
|---|---|---|
| Seek bar click | `ContentScroller.jsx:275` (via `__seekSource = 'click'` at `useCommonMediaController.js:382`) | `click` |
| `seekForward` / `seekBackward` keyboard | `useMediaKeyboardHandler.js:171,182` | `bump` |
| Start-time application (initial mount) | `useCommonMediaController.js:1191,1218` | `programmatic` (logged once at `19:43:35.694` for this session) |
| Recovery strategies (nudge/reload/softReinit) | `useCommonMediaController.js:454,494,538` | `programmatic` (but no `playback.recovery-strategy` log was emitted in our window) |
| Buffer-resilience skip | `BufferResilienceManager.js:182` via `hardReset` | `programmatic` (but no `shaka-recovery-action` log was emitted in our window) |
| Position watchdog correction | `useCommonMediaController.js:702` | `programmatic` (no `playback.position-watchdog` log emitted) |

None of the tagged recovery paths emitted their own preceding log, so they are not the trigger. The remaining candidates are:

1. **dash.js-internal seek.** dash.js can adjust `currentTime` in response to MSE buffer-end conditions (especially with `liveDelayFragmentCount` or `lowLatencyMode` semantics applied to short trailing fragments). With a static manifest whose advertised duration (441.76s) exceeds the actual playable buffer end (~441.6s or wherever fragment 87's data ran out), dash.js's gap-jump or end-of-stream logic can write `currentTime = duration`. This is consistent with the `init segment refetch → fragment 88 request → 0 bytes` pattern: dash.js was attempting to consume the trailing partial fragment and, finding it absent, snapped the player to declared duration.
2. **An untagged app-side writer we did not find.** Possible but lower probability given the exhaustive grep of `\.currentTime\s*=` across `frontend/src/`.

**This is the only part of the audit with residual uncertainty.** It does not block the fix — the player must recover from `paused at duration` regardless of who put it there — but the instrumentation task in the plan will resolve it for next time.

### 2.2 Layer B — Stall watchdog disables itself near duration

`useCommonMediaController.js` `scheduleStallDetection` (~line 840):

```javascript
if (s.hasEnded || mediaEl.ended ||
    (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
  // Skip stall detection near end
}
```

The intent is correct: stall recovery should not nudge/reload a video that has legitimately reached its end. But the guard then **does nothing** — there is no "advance the queue" branch, no terminal action, no escalation. It silently disengages, leaving the player in whatever state it found.

This guard runs inside the soft-timer callback, so it disables both the soft and hard stages of recovery once `currentTime >= duration - 0.5`. After the seek-to-duration in our incident, every subsequent stall watchdog tick saw `currentTime = 441.76 ≥ 441.26` and immediately returned.

### 2.3 Layer C — Overlay status reports a stale internal flag forever

`useMediaResilience.js:336-344`:

```javascript
const mediaElSnapshot = (() => {
  try {
    const el = getMediaEl?.();
    return { seeking: el?.seeking === true, seekSource: el?.__seekSource || null };
  } catch {
    return { seeking: false, seekSource: null };
  }
})();
const effectiveSeeking = isSeeking || mediaElSnapshot.seeking;
```

Line 451:

```javascript
status: effectiveSeeking ? 'seeking' : status,
```

`PlayerOverlayLoading.jsx:251`:

```javascript
if (status === 'seeking') return 'Seeking…';
```

`mediaEl.seeking` is a DOM-spec attribute the browser owns. It becomes `true` when a seek begins and clears to `false` when the seek completes (the position is reached and frames are decoded). With a zero-byte trailing fragment, the seek can never "complete" in the strict sense the spec requires — there are no frames to decode at the target time. `dash.seeked` fired at `.452` because dash.js uses a more permissive completion criterion, but the DOM flag stayed `true`.

The overlay copy "Seeking…" is then literally accurate from the element's point of view — and useless to the user, who has been watching a static frame for 87 seconds.

### 2.4 Layer D — Queue advance has only one trigger, and it doesn't fire here

`ContentScroller.jsx:283-285,365`:

```javascript
const handleEnded = useCallback(() => {
  onAdvance && onAdvance();
}, [onAdvance]);

// …
<video onEnded={handleEnded} … />
```

The HTML5 `ended` event has a precise spec: it fires when playback reaches the end of the media resource AND `mediaSource.endOfStream()` has been called (for MSE streams) AND the playback direction is forward. dash.js calls `endOfStream()` when it has loaded the final fragment and the media's `duration` matches the buffered end. In our case, fragment 88 returned zero bytes — dash.js cannot complete `endOfStream()` because it has no last-fragment data to commit. The spec event never fires.

This is the **structural** bug: the only mechanism that advances a queue is gated on a precondition that genuinely cannot be met when the source has a partial trailing fragment. Every Plex stream has a partial trailing fragment (the duration almost never lands exactly on a fragment boundary).

There is no fallback path. There is no "if paused at duration and nothing has changed for N seconds, advance" timer. The fitness app has `useCloseWatchdog.js` for the analogous failure during session close (where the close command was issued but the player did not actually close); the screens player has no such watchdog.

---

## 3. Why we did not see this before

Two reasons it has been latent:

1. **Most Plex transcodes return non-zero trailing fragments**, which lets `endOfStream()` complete and `ended` fire. The zero-byte tail is a Plex behavior that depends on encoder settings, GOP alignment, and how the requested time range straddles the actual EOF. It is not deterministic per asset.
2. **Most users press the remote to skip near the end of an episode**, which short-circuits the natural-end path entirely via the `nextTrack` action.

The combination of "let the episode play through to natural end" + "Plex returns a zero-byte tail for this particular asset" is rare enough that it has slipped past every prior audit. There is nothing in `2026-02-27-video-playback-failure-audit.md`, `2026-03-10-video-resume-resilience-remount-audit.md`, or `2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md` that covers this case.

---

## 4. Orphan Findings (not the cause, but discovered during investigation)

### 4.1 `playback.fps_stats` reports stale `currentTime`

`VideoPlayer.jsx:533-593`:

```javascript
useEffect(() => {
  // …
  fpsIntervalRef.current = setInterval(() => {
    // …
    logger.info('playback.fps_stats', {
      // …
      currentTime: Math.round(seconds * 10) / 10,   // ← stale closure
      duration: Math.round(duration * 10) / 10,
      // …
    });
  }, 10000);
  return () => { /* … */ };
}, [isPaused, isStalled, displayReady, quality?.supported]);   // ← `seconds` not in deps

// Keep refs up to date with latest values for use in interval callback
const latestDataRef = useRef({ seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader });
useEffect(() => {
  latestDataRef.current = { seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader };
}, [seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader]);
```

The deps array deliberately excludes `seconds` to avoid recreating the interval on every timeupdate — fine. The `latestDataRef` is updated by a second effect — also fine. **But the logger reads `seconds` directly**, capturing the value as it was when the outer effect last ran.

Evidence from this incident:

```
2026-05-23T19:43:46.527Z  ct=107
2026-05-23T19:43:56.530Z  ct=107
2026-05-23T19:44:06.527Z  ct=107
…
2026-05-23T19:49:06.527Z  ct=107   ← 5 seconds before the stall, still reading 107
```

Every `playback.fps_stats` event in the 5.5-minute Bluey playback reported `currentTime: 107` despite the video advancing to `441s`. This is a logging defect — no behavioral impact — but it actively misled this investigation for ~15 minutes (I initially suspected the video was actually stuck at 107).

### 4.2 Garage fitness phantom-overlay heartbeat (already known)

`waitKey 00090f6f25` (Firefox/Linux UA matching the garage fitness extension) emitted `playback.overlay-summary` every second for the full hour we sampled, with constant payload `status:"Starting…" startup:armed attempts=0 el:t=0.0 r=n/a n=n/a p=false` and an obviously wrong `vis:62126403ms`. This is the phantom-overlay signature commit `9de00c9b5` was aimed at suppressing. Either the fix is not yet deployed to garage, or it does not cover the `attempts=0 effectiveMeta=null` variant. Not in scope for this audit; flagged for the fitness track.

---

## 5. Recommended Fix Surface

Ordered by ROI. The Plan document (`docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md`) sequences them.

1. **D — Add an end-of-content queue-advance watchdog.** The cheapest correctness fix. New behavior: `if (paused && currentTime ≥ duration − 0.5 && !progressing) for ≥ 3s → onAdvance()`. Resolves the user-visible bug.
2. **C — Treat "paused at duration" as ended in the overlay status.** Stop showing "Seeking…" when the video is at duration with no progress; either hide the overlay or show "Ended". Cosmetic but the message has been actively lying to the user.
3. **B — Promote the stall watchdog's near-end exemption into an escalation.** Today the guard does nothing; instead it should call into the queue-advance watchdog from (1). One code path for "we are at/past duration and not advancing."
4. **A — Add a seek-source trace for end-of-duration seeks.** When `handleSeeking` observes `intent ≥ duration − 0.5`, capture and log a stack trace (or a one-shot trace of the next event-loop tick). Diagnostic, not behavioral. Confirms or refutes the dash.js-internal hypothesis next time.
5. **Orphan — Fix `fps_stats` stale closure.** One-line read from `latestDataRef.current.seconds` instead of `seconds`. Worth doing while in the file.

---

## Appendix A — Raw evidence

The 12-minute log slice used in this audit is available in container logs (`sudo docker logs daylight-station --since 12m` at investigation time). Key filtered subsets:

```
$ grep -E '"event":"dash\.(buffer-stalled|waiting|seeking|seeked|fragment-abandoned|quality-change)|playback\.seek|playback\.paused|playback\.video-ready|playback\.unmount' /tmp/shield-recent.log
2026-05-23T19:43:34.721Z  playback.unmount-progress-save  {"assetId":"plex:663154","pos":564.057698,"pct":"27.1"}
2026-05-23T19:43:35.660Z  dash.waiting  {}
2026-05-23T19:43:35.707Z  dash.seeking  {"seekTime":107}
2026-05-23T19:43:35.717Z  playback.seek  {"mediaKey":"plex:59518","phase":"seeking","intent":107,"duration":441.76,"source":"programmatic"}
2026-05-23T19:43:36.515Z  playback.seek  {"mediaKey":"plex:59518","phase":"seeked","actual":107,"intent":107,"drift":0,"duration":441.76}
2026-05-23T19:43:36.516Z  playback.video-ready  {"title":"Teasing","grandparentTitle":"Bluey (2018)","parentTitle":"Season 1","mediaKey":"plex:59518"}
2026-05-23T19:49:11.400Z  dash.seeking  {"seekTime":441.759999}
2026-05-23T19:49:11.403Z  playback.seek  {"mediaKey":"plex:59518","phase":"seeking","intent":441.759999,"duration":441.759999,"source":"programmatic"}
2026-05-23T19:49:11.404Z  dash.waiting  {}
2026-05-23T19:49:11.405Z  dash.buffer-stalled  {"type":"video"}
2026-05-23T19:49:11.409Z  playback.paused  {"title":"Teasing","grandparentTitle":"Bluey (2018)","parentTitle":"Season 1","mediaKey":"plex:59518","currentTime":441.759999,"duration":441.759999}
2026-05-23T19:49:11.452Z  playback.seek  {"mediaKey":"plex:59518","phase":"seeked","actual":441.759999,"intent":441.759999,"drift":0,"duration":441.759999}
```

The 87 subsequent `playback.overlay-summary` heartbeats with identical `el:t=441.8 r=4 n=2 p=true | status:Seeking…` are omitted for brevity.

---

## Status

- **2026-05-23 (filed)** — Audit published; plan written at `docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md`.
- **2026-05-23 (landed on `worktree-end-of-video-recovery`)** — All five fix items implemented across six commits. 51 new tests, all in scope passing (87/87 across 12 of 13 Player module test files; `VideoPlayer.hardReset.test.jsx` is a pre-existing baseline failure unrelated to this change). Awaiting merge to main + live verification.
  - **D (end-of-content watchdog)** — `frontend/src/modules/Player/lib/endOfContentWatchdog.js` + `hooks/useEndOfContentWatchdog.js` wired into `ContentScroller.jsx`. Fires `onAdvance` once after 3s of paused-at-duration with no progress; one-shot per arming episode, resets on source change.
  - **C (overlay status)** — `PlayerOverlayLoading` returns null when paused within 0.5s of duration. `useMediaResilience` now passes numeric `currentTime` + new `duration` field in `mediaDetails` so the suppression can actually trigger in prod (the prior `currentTime: seconds.toFixed(1)` was a string that defeated `Number.isFinite` checks).
  - **B (telemetry on near-end exemption)** — `playback.at-duration-stuck` warn log fires once per arming episode when `scheduleStallDetection`'s guard activates with `mediaEl.ended === false`. Predicate lives in `lib/atDurationStuck.js`.
  - **A (seek-source trace)** — `playback.seek-trace` event with truncated `Error().stack` fires from `handleSeeking` when intent ≥ duration − 0.5, sampled at 5/min. Predicate + stack capture + payload builder in `lib/seekTrace.js`. The next occurrence in prod will pin down whether the trigger is dash.js-internal or an untagged app path.
  - **Orphan — `fps_stats` stale closure** — `VideoPlayer.jsx` now reads from `latestDataRef.current` via a pure `buildFpsStatsPayload` helper. No more frozen-at-effect-creation values in production telemetry.
