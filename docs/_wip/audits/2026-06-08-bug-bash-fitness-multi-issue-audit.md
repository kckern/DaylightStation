# Bug Bash Audit — Fitness App (June 8, 2026)

**Date:** 2026-06-08
**Scope:** Four independent items from the June 8 bug bash — (1) session-detail timeline
markers, (2) player footer zoom-navigation lifecycle, (3) challenge audio engine refactor +
config, (4) the June 8 live-session playback crash + F5 state-loss regression.
**Method:** Four parallel read-only research agents collected evidence from code, config, the
per-session JSONL logs, Plex transcode logs, and `ffprobe`. This document is evidence and gap
analysis only — no code was changed.

---

## Item 1 — Session Detail Timeline: Video-Change & Challenge Markers

**Goal:** Extend the session-detail timeline (which already renders green race/game overlays)
with (A) video-change markers and (B) in-session challenge markers.

### Current timeline architecture

The timeline is a single full-size `<svg>` rendered by
`frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx`.

- **Coordinate system is tick-indexed, not raw time.** `tickToX(index, effectiveTicks, plotWidth)`
  (`FitnessTimeline.jsx:12-15`) maps a tick to a pixel. `effectiveTicks` is the max HR-series
  length across participants (`:229-243`) so the timeline lines up under `FitnessChart`.
- **Time→x for overlays** goes through `timelineOverlay.js` `msToTickX(ms, …)` (`timelineOverlay.js:2-6`):
  `tick = ms / intervalMs`, then the same tick→x formula. **`ms` here is an axis offset (ms from
  session start), not an absolute epoch.**
- **Existing overlay primitives to copy:** the `overlay` memo (`FitnessTimeline.jsx:247-254`) builds
  `bands` (`computeRaceBands`) and `seams` (`computeSeamLines`). Seam lines (`:353-357`) are already
  full-height **dashed** vertical lines (`strokeDasharray="3 3"`) — the exact primitive a dashed
  video-change marker should mirror. Race bands (`:305-310`) are translucent full-height rects.
- **Data plumbing caveat:** `FitnessChart/sessionDataAdapter.js` surfaces only HR series/roster/timebase.
  The timeline reads `sessionData.activities` / `sessionData.seams` **directly off the raw prop**,
  bypassing the adapter. Those fields only exist on **group** detail
  (`SessionGroupingService.getGroupDetail`); single sessions currently show HR lanes only.

### A. Video-change markers — data is mostly present

Two complementary sources already exist in the single-session API response
(`GET /api/v1/fitness/sessions/:id`, `Session.toJSON` with `decodeTimeline:true`):

1. **`timeline.events` of `type: 'media'`** (built in `frontend/src/hooks/fitness/PersistenceManager.js:456-482`) —
   the timestamped source. Each carries `contentId`, `title`, `grandparentTitle/Id`, `parentTitle/Id`,
   `contentType` (`episode`/`track`), `durationSeconds`, and **`start`/`end` as absolute epoch ms**.
   Brief browse-past blips are filtered (`PersistenceManager.js:484-497`).
2. **`summary.media[]`** — de-duplicated catalog used by the header
   (`FitnessSessionDetailWidget.jsx:207`); carries `mediaType` (`video`/`audio`), `showTitle`,
   `durationMs`, and **`primary: true` on the hero**. No timestamps — use `timeline.events` for placement.

**Assets the marker card needs already resolve.** `mediaDisplayUrl(contentId)`
(`FitnessSessionDetailWidget.jsx:30-38`) maps `plex:674286` → `/api/v1/display/plex/674286`. The header
already builds the exact LEFT/RIGHT pair the spec wants:
**poster = `mediaDisplayUrl(grandparentId)`** (portrait show poster), **thumbnail = `mediaDisplayUrl(contentId)`**
(landscape episode thumb) (`:248-249`). Episode caption = `title`.

**The "skip 00:00 if hero is first" rule is implementable:** compare the first media event's `start`
to session start and check whether that first event is the `primary` one. Verified against real data
(`data/household/history/fitness/2026-06-08/20260608191948.yml`): the hero media starts at +22s — i.e.
effectively tick 0 — so the rule correctly suppresses a redundant flag there.

### B. Challenge markers — timestamps present, type discriminator is the gap

**`timeline.events` of `type: 'challenge'`** (built in `PersistenceManager.js:433-454`) carry
`challengeId`, `zoneId`, `zoneLabel`, `title`, `requiredCount`, **`start`/`end` epoch ms**, `result`
(`success`/`fail`), `metUsers`, `missingUsers`.

**The core gap:** at runtime `GovernanceEngine` distinguishes **`type:'cycle'`** (cadence/RPM) vs the
default HR/zone challenge (`GovernanceEngine.js:581,757,1778`). **`PersistenceManager.js:438-453` drops
`type` when consolidating the event** — so a persisted challenge can only be classified cycle-vs-zone by
fragile heuristics (`zoneId==null`, or `challengeId` prefix). To render type-distinct markers reliably,
**add a `type`/`kind` field to the persisted challenge event.**

**There is no central challenge-type registry.** Icon/color knowledge is scattered:
- `player/overlays/buildChallengeToast.js:22,32,69` — emoji by type: cycle → 🚴, default → 🏆 (the only
  existing challenge-type icon map).
- `player/overlays/cycleOverlayVisuals.js:32-39` — `RING_COLORS` for cycle phases.
- `ZONE_COLOR_MAP` (`lib/chartHelpers.js:13`, re-exporting domain `ZoneColors`) — per-zone colors,
  already imported by `FitnessTimeline.jsx:4`.
- `lib/activities/fitnessActivityRegistry.jsx` — closest pattern, but enumerates **session-level
  activities** (`cycle-game`), not in-session challenge types. Natural place to extend or sibling.

### Implementation gaps (Item 1)

**Shared infra for both A and B:**
1. Surface `timeline.events` and a **session-start-epoch** to the timeline — extend
   `sessionDataAdapter.js` or read the raw prop as `activities`/`seams` already are.
2. Add `sessionStartMs` to the `overlay` opts so absolute-epoch event timestamps rebase onto the tick
   axis: `offsetMs = event.start - sessionStartMs`, then existing `msToTickX(offsetMs, …)`. Session start
   epoch comes from `session.start` + `timezone` (header already does this at `:216-218`).
3. The timeline is **SVG-only** (no rich-text/markup primitives). The wide poster+thumbnail header card
   needs an HTML overlay layer or `<foreignObject>`.
4. Add marker classes to `FitnessTimeline.scss` (today only `.timeline-band` / `.timeline-seam` exist).

**A-specific:** new `computeVideoMarkers(events, sessionStartMs, opts)` (filter `type==='media'` +
video, rebase, apply skip-00:00-if-hero rule); new dashed-line + wide-card component. *Already present:*
asset resolver, poster/thumbnail URLs, captions, `primary` flag, timestamps.

**B-specific:** persist challenge `type` (the blocking gap); add a challenge-type registry mapping
`type → {label, color, icon/number}` consumed by the timeline (and ideally `buildChallengeToast` for
consistency); new **dotted** line (distinct `strokeDasharray`, e.g. `2 4`) + type flag; new
`computeChallengeMarkers(…)`. *Already present:* timestamps, `result`, zone colors, cycle emoji.

**Key files:** `FitnessTimeline.jsx`, `timelineOverlay.js`, `FitnessTimeline.scss`,
`FitnessSessionDetailWidget.jsx`, `FitnessChart/sessionDataAdapter.js`, `PersistenceManager.js:433-497`,
`lib/activities/fitnessActivityRegistry.jsx`, `lib/chartHelpers.js`,
`backend/.../SessionGroupingService.mjs:43-126`, `backend/.../entities/Session.mjs:240-283`.

---

## Item 2 — Footer Zoom-Navigation: Lifecycle & Bugs

**Goal:** Document the intended footer zoom/drill UX, then audit where the code deviates.

### View layer

`player/footer/FitnessPlayerFooterControls.jsx` is a pure presentational component — it owns no zoom
state. `isZoomed` is the single flag that swaps Close→Back (`:240-260`) and Play/Pause→zoom-steppers
(`:122-162`). `zoomNavState` (PropTypes `:278-283`) contains **only pan actions**
(`canStepBackward/canStepForward/stepBackward/stepForward`) — **no zoom-in or back/out**.

State is owned by `player/footer/FitnessPlayerFooterView.jsx` (`isZoomed` `:36`, `zoomNavState` `:37`,
`zoomResetRef` `:38`). The load-bearing handler:

```js
// FitnessPlayerFooterView.jsx:42-47
const handleBack = useCallback(() => {
  if (zoomResetRef.current) {
    zoomResetRef.current();   // === zoomOut() — FULL reset to root
    setIsZoomed(false);
  }
}, []);
```

### The actual state machine

`player/footer/hooks/useZoomState.js`, instantiated in `FitnessPlayerFooterSeekThumbnails.jsx:86-109`.

- `zoomRange`: `[start,end]` or `null` (root). `isZoomed = zoomRange != null` (`:105`).
- `zoomStackRef` (`:45`): a **history stack** of `{positions, range}` pushed on each `zoomIn`.
- `zoomIn(bounds)` (`:243-276`): pushes current snapshot, sets `zoomRange = bounds` (drill in).
- `zoomOut()` (`:281-285`): **clears the entire stack**, sets `zoomRange = null` (hard jump to root —
  **not a one-level pop**).
- `stepBackward/stepForward` (`:306-344`): pan within the current level; do **not** change depth or
  consult the stack.
- `scheduleZoomReset(delayMs=800)` (`:291-301`): after the delay, clears the stack → root.

Gesture mapping (`nav/SingleThumbnailButton.jsx`): tap → `onSeek`; right-click / time-label / **400ms
long-press** (`:117`) → `onZoom` (drill in).

### Timing constants

| Constant | Value | Location | Role |
|---|---|---|---|
| Long-press → zoom-in | **400 ms** | `SingleThumbnailButton.jsx:117` | Only hold timer; boundary tap=seek vs hold=zoom-**in** |
| Post-seek zoom reset | **800 ms** | `useZoomState.js:291`, fired `FitnessPlayerFooterSeekThumbnails.jsx:132` | De-facto "grace window," but resets to **root** |
| `GRACE_MS` | **650 ms** | `useSeekState.js:32` | **Seek-intent** tolerance — NOT zoom (misleading name) |
| `MAX_HOLD_MS` / `STICKY_MS` / `SETTLE_DELAY_MS` | 2500 / 700 / 100 ms | `useSeekState.js:33-35` | Seek-only |
| Segment count | **10** | `useZoomState.js:25` | Thumbnails per zoom level |

### Intended vs actual — the bugs

- **BUG 1 — Back never returns to the parent; it always nukes to root.** `handleBack` →
  `zoomResetRef.current()` → `zoomOut` → `zoomStackRef = []; setZoomRange(null)`. After root→L1→L2,
  one Back lands at root, skipping L1.
- **BUG 2 — The zoom stack is write-only; parent context is structurally lost.** `zoomIn` pushes
  snapshots but **nothing ever pops them**; the stack is only read for *pan* indexing. The history
  exists in memory with no restore path. Root cause of BUG 1 and "fails to return to parent nodes."
- **BUG 3 — No selection grace window; a seek schedules an unconditional reset to root.** On
  `playing` while zoomed, `scheduleZoomReset(800)` fires (`FitnessPlayerFooterSeekThumbnails.jsx:124-139`).
  Adjacent **pan** cancels it; an adjacent **tap-seek** does not preserve the level — it re-arms another
  800ms reset. Matches the symptom "selections lose state early": zoom in, tap, ~800ms later you're
  bounced to the full timeline.
- **BUG 4 — Two uncoordinated "grace" systems + a misleading name.** `useSeekState`'s `GRACE_MS`
  governs seek tolerance; `useZoomState`'s 800ms governs zoom teardown. Tuning `GRACE_MS` to fix zoom
  return would change seek tolerance instead.
- **GAP 5 — Hold-to-reset is unimplemented; the only hold (400ms) does the opposite (zoom-in).** The
  intended "hold = hard reset to root" affordance does not exist; the only reset paths are Back and the
  automatic 800ms timer.
- **GAP 6 — No tests** under `player/footer/` or its `hooks/`.

### Suggested fix anchors
- Add `popZoom()` to `useZoomState.js`; bind Back (`FitnessPlayerFooterView.jsx:42`) to it; reserve
  `zoomOut`/`scheduleZoomReset` for the hard-reset path.
- Replace the unconditional `scheduleZoomReset(800)` with a grace mode that keeps the current level and
  only resets after inactivity.
- Decide which gesture maps to hard-reset (the 400ms hold is taken by zoom-in).

---

## Item 3 — Challenge Audio Engine: Superclass + Volume Config

**Goal:** (A) a shared audio abstraction so cycling challenges get Start/End/Fail/Hurry SFX like HR
challenges already do; (B) an optional `volume` config field per cue.

### How the duck engine works today

- **Producer:** `GovernanceEngine.js` `_computeAudioDuck` (`:1753-1807`) emits an `audioDuck` descriptor
  `{ cueId, sound, duckTo, token }`.
- **Consumer:** `useGovernanceAudioDuck.js` (already type-agnostic) — lowers video via
  `videoVolume.setDuck(duckTo)`, plays the SFX on a shared `<audio>` element
  (`audioCuePlayer.js:getCueAudioElement`), and lifts the duck on `ended`/error.
- **Resolution:** `audio.src = DaylightMediaPath('/media/' + audioDuck.sound)` (`useGovernanceAudioDuck.js:52`).

**Volume finding (Goal B):** the SFX element's `.volume` is **never set** — grep for `.volume` in both
`useGovernanceAudioDuck.js` and `audioCuePlayer.js` returns nothing. Only `audio.muted` is toggled. So
**every governance SFX plays at 1.0 — exactly the "too loud" problem.** The CycleGame race system already
has the pattern to mirror: `lib/cycleGame/playSound.js:23` does `audio.volume = clamp(volume)`.

### Challenge architecture (HR vs cycling)

There is **no challenge base class** — challenges are plain objects on
`this.challengeState.activeChallenge` inside the 4,139-line `GovernanceEngine`. Type is discriminated by
a `type` field: cycle has `type:'cycle'`; HR/zone has **no `type`** (default branch, `_buildChallengeSnapshot`
`:757-791`).

- **HR audio path WORKS:** `_computeAudioDuck` maps HR lifecycle → cues: `challenge_complete` (`:1787`),
  `challenge_remaining`/Hurry (`:1795`), `challenge_start` (`:1803`), plus `governance_warning` (`:1769`).
- **Cycling is explicitly excluded:** `_computeAudioDuck` bails at **`:1778`**:
  `if (!challengeSnapshot || challengeSnapshot.type === 'cycle') return null;` — **cycle challenges never
  produce an `audioDuck` and never trigger SFX or ducking.**
- The engine *does* already compute cycle lifecycle edges — `cycleAudioCue` (`:645-674`): `cycle_challenge_init`
  (Start), `cycle_success` (End), `cycle_locked` (Fail/lock), `cycle_phase_complete`. **But `cycleAudioCue`
  is consumed by no component** — it dead-ends in a `debug` log (`:667-673`). The lifecycle hooks exist;
  they just aren't wired to the duck/SFX engine. `CycleChallengeOverlay.jsx` has zero audio.

### Current SFX config schema

`data/household/config/fitness.yml`, key `governance.audio_cues` (`:656-673`), parsed by `_normalizeAudioCues`
(`GovernanceEngine.js:884-923`). It is **already a list of objects** (not a flat string→path map):

```yaml
audio_cues:
  - id: challenge_start
    trigger: challenge_start
    sound: apps/fitness/ux/challenge-start.mp3
    duck_to: 0.2
  - id: challenge_hurry
    trigger: challenge_remaining
    threshold_seconds: 12
    sound: apps/fitness/ux/challenge-hurry.mp3
    duck_to: 0.1
  # …challenge_complete, challenge_warning
```

Per-entry fields parsed today: `id`, `trigger`, `sound`, `duck_to` (→ `duckTo`, clamped [0,1], default 0.1),
`threshold_seconds`. **No `volume`** — so adding optional `volume` is a clean additive change (no shape
migration). Supported triggers (`SUPPORTED_AUDIO_CUE_TRIGGERS` `:29-34`): `challenge_start`,
`challenge_remaining`, `challenge_complete`, `governance_warning` — **no cycle triggers registered.**

### Shared lifecycle (justifies the superclass)

| Lifecycle | HR/zone | Cycle | HR cue / cycle cue |
|---|---|---|---|
| **Start** | `pending`, not in hurry window | `cycle_challenge_init` | `challenge_start` / none |
| **Hurry** | `remainingSeconds <= threshold` | *no native timer signal* | `challenge_remaining` / none |
| **End** | `success`/satisfied | `cycle_success` | `challenge_complete` / none |
| **Fail/lock** | governance `warning`→lock | `cycle_locked` | `governance_warning` / none |

### Refactor surface & gaps (Item 3)

**(A) Shared abstraction + wire cycling** — all engine-side, consumer is already type-agnostic:
1. `GovernanceEngine.js:1778` — relax the `type==='cycle'` early-return.
2. `_computeAudioDuck` (`:1753-1807`) — add a cycle branch (or fold the existing `cycleAudioCue` edges,
   `:645-674`, into a shared mapper) for Start/End/Fail.
3. `SUPPORTED_AUDIO_CUE_TRIGGERS` (`:29-34`) — add cycle triggers, or design the shared mapper so HR and
   cycle reuse the same four logical triggers (Start/End/Fail/Hurry). The "superclass" most naturally
   lives here as a unified cue-resolution layer, since challenges are plain objects.
4. Add cycle cue entries to `fitness.yml` `audio_cues`.

**OPEN DECISION — cycle "Hurry" has no native signal.** HR uses `remainingSeconds <= threshold`; cycle
is RPM/health/phase-driven with no countdown. A Hurry trigger must be invented (e.g. `cycleHealthPct`
below a threshold, or `initRemainingMs`/`rampRemainingMs` low). This is the one place the "identical
lifecycle" assumption breaks and needs a product decision.

**(B) Optional `volume`** — small, well-contained:
1. `_normalizeAudioCues` (`:884-923`) — parse `entry.volume` (clamp [0,1], default 1.0).
2. `_computeAudioDuck` `emit()` (`:1758-1766`) — thread `volume` into the descriptor.
3. `useGovernanceAudioDuck.js` `startSession` (`:49-67`) — `audio.volume = clamp(audioDuck.volume ?? 1)`
   after setting `src`, before `play()` (mirror `playSound.js:23`).
4. Add `volume: 0.5` to hot entries in `fitness.yml`.

**Do not conflate** the governance cycle *challenge* (silent today, the target) with the CycleGame
*race takeover* (`CycleGameContainer.jsx` + `playSound.js`, separate fully-audio channel).

---

## Item 4 — June 8 Playback Crash + F5 State-Loss (CRITICAL)

**Incident:** ~7:44 PM PDT June 8, 2026. Video froze ~4.5 min in and entered an unrecoverable buffering
loop; retry modal and manual refresh both failed; F5 dropped the user out of the session to a menu.

### Session-log evidence (the stall)

Per-session JSONL survives redeploys (`media/logs/fitness/`). Active file:
`2026-06-09T02-18-50.jsonl` (= 7:18 PM PDT). Stalled asset: **`plex:674287` — "Game Cycling - S02E07 -
Daytona USA 2001"** (the *second* video; the prior item `plex:674286` had also stalled at 02:35:14).

```
02:41:32.898  dash.buffer-stalled {type: video}
02:41:34.648  playback.stalled {currentTime:258.88, duration:2896.782, stallDurationMs:1584}
02:41:41.449  playback.recovery-strategy {strategy:"nudge", attempt:1, success:true}
02:41:55.477  playback.player.stall-exhausted-restart {secondsStalled:22}
02:41:55.481  …stream-url-refreshed  next: /api/v1/proxy/plex/stream/674287?_refresh=1780972915477
02:41:55.482  playback.player-remount {reason:"user-retry-exhausted", seekSeconds:258.879}
```

Freeze at **currentTime 258.88s (4:18.9)** — matches "~4.5 min." Recovery files
(`…02-42-12`, `…02-44-00`, `…02-44-45`) show **14 consecutive `startup-deadline-exceeded` remounts**, all
re-requesting `offset=258`, never progressing. **No `MEDIA_ERR`/decode-error was ever emitted** — the
failure is "stream never starts," not a hard decode error.

### Plex/transcode evidence (root cause)

From `…/Docker/Media/plex/Logs/Plex Media Server.log`:

```
MDE: Direct Play is disabled / must be transcoded for dash
decision=transcode … Video=(transcode bitrate=20000 encoder=libx264 width=1920 height=1080)  Audio=(copy)
Transcoder … -codec:0 libx264 -crf:0 16 -maxrate:0 20000k -r:0 60 -preset:0 veryfast -f dash -seg_duration 1
```

**Software libx264, forced to 1920×1080 @ 60fps, 20 Mbit/s** — transcoding an already-h264/aac source
purely to satisfy the app's DASH-only / `directPlay=0` profile. The transcoder then **froze at DASH
segment 258** (matching the stall):

```
19:40:50 → 19:41:55  [Transcoder segment range: 0 - 258]   (repeated ~60×, never advances)
19:40:55  Asked for segment 259 …
19:41:57  Returning segment 259   ← >60s late
```

Preceded by `Throttle - Going into sloth mode`. The encoder produced ~1s of content per ~60s wall clock
at segment 258 — far slower than realtime. The client's 15s startup deadline expired before segment 259
existed, so it remounted and re-requested `offset=258`, re-entering the same stuck region forever.

### ffprobe — the source file is clean

`/media/kckern/Media/Fitness/Game Cycling/Game Cycling - S02E07 - Daytona USA 2001.mp4` (1.66 GB, h264
1080p60, aac, 2896.78s). Keyframes around the stall are clean: `254 I, 256 I, 258 I, 260 I, 262 I`
(regular 2s GOP, keyframe exactly at 258s). `ffmpeg -ss 255 -t 8 … -f null -` decoded with **zero
errors**. **The asset is not the problem.**

### Root-cause assessment

- **(a) Container-side SW-transcode throughput collapse — confirmed.** Forced 1080p60 / 20 Mbit/s
  libx264 of an already-h264 source fell behind realtime; the seek-to-`offset=258` resume meant every
  retry re-targeted the exact segment the encoder was stuck on → unrecoverable loop.
- **(b) Network — ruled out.** Pre-258 segments served in 2–46ms; no transport errors, no 404s.
- **(c) Client decode — contributing stressor, not primary.** `fitness.video_fps_degraded {fps:9.7–11.6}`
  shows 1080p60 strained the Firefox kiosk, but no decode error and the file decodes cleanly offline.

**Relationship to prior audits:** Same failure *family* as
`2026-05-18-fitness-av1-transcode-buffer-collapse-audit.md` (SW transcode slower than realtime → DASH
window exhaustion) and the stuck-seeking loop of `2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md`.
**It is NOT the vp9/av1 SourceBuffer codec mismatch** — the May 18 mitigation (advertise only `h264,hevc`,
`directPlay=0`, `PlexAdapter.mjs:969,1513,1628`) is present and working, which is *why* the target was
libx264. The new, unaddressed trigger is **forced 1080p60 SW transcode being too slow, plus a resume
mechanism that always re-seeks onto the poisoned segment.**

### Why the retry modal was "non-functional"

It was not a no-op — it ran correctly every time. The design flaw: **both manual reload and automatic
retry seek back to the same `offset=258` and re-issue the same Plex transcode request.** Since the
transcoder was deterministically stuck at 258, every reload reproduced the stall.

- Footer reload → `handleManualReload` → `controller.forceReload({seekToIntentMs})`
  (`FitnessPlayerFooterControls.jsx:100-113`).
- `forceReload` → `Player.jsx:750 handleResilienceReload` → `mediaAccess.hardReset({seekToSeconds:258, refreshUrl})`
  → remount at the same position (`Player.jsx:624-694`).
- Startup deadline: `useMediaResilience.js:263-272` arms recovery after **`hardRecoverLoadingGraceMs`
  = 15000ms** (`useResilienceConfig.js:14,78`) — matches the observed 15s remount cadence.

**The resilience layer has no "this exact position keeps failing → seek forward / pick a new variant /
fall back" escape hatch**, so it loops indefinitely. The 0-byte-fragment warmup extension
(`useMediaResilience.js:283-301`) did not engage because segments weren't 0-byte — they simply didn't
exist yet past 258.

### F5 state-loss regression

The active session/queue is the React `useState` array `fitnessPlayQueue` (`FitnessApp.jsx:54`). **There
is no `sessionStorage`/`localStorage` persistence** — the only durable cross-reload state is the URL path
(navigations use `navigate(..., {replace:true})`).

What actually happened on F5 (recovery file `…02-44-45.jsonl`):

```
02:44:45.957  fitness-url-init {view:"play", id:"674287"}             ← URL survived
02:44:46.187  fitness-play-url-sequential-blocked {episodeId:"674287", showId:"603407"}
02:44:46.202  fitness-view-state {view:"show", queueSize:0}           ← redirected play → show
02:45:04.523  …player-remount (startup-deadline-exceeded) offset=258  ← same poisoned stream
02:45:28.978  fitness-view-state {view:"screen", queueSize:0}         ← dropped to home dashboard
```

Two compounding causes:
1. **Sequential-show redirect:** `handlePlayFromUrl` (`FitnessApp.jsx:763-777`) detects `674287` belongs
   to a `sequential_labels` show and **redirects `/fitness/play/:id` → `show` view** instead of resuming
   playback. A hard reload of an in-progress *sequential* show never cleanly resumes.
2. **No durable queue + same poisoned stream:** when it did re-enter playback it rebuilt the queue from
   scratch, re-requested the stuck `offset=258`, stalled again, the queue emptied, and the app fell back
   to `view:"screen"` (the home dashboard — the "main menu"; `FitnessApp.jsx:1163-1168`).

**Net:** F5 preserves only a URL pointer, not the live session/queue/roster/position. For a sequential
show that pointer is actively redirected away from the player; even otherwise, the resume URL re-targets
the failing segment. No resume-on-mount restores session state from durable storage.

### Recommended follow-ups (Item 4)

1. **Stop forcing 1080p60 SW transcode.** Cap the transcode target (e.g. allow 30fps / lower the
   `bitrate=20000`/`-r 60`, or prefer direct-play/direct-stream when the source is already h264) so the
   encoder stays ahead of realtime. This is the actual root cause.
2. **Break the poisoned-segment loop.** Give the resilience controller an escape hatch: after N
   same-position `startup-deadline-exceeded` remounts, nudge `seekToIntentMs` forward past the stuck
   segment and/or request a fresh transcode session, rather than re-seeking onto 258 forever.
3. **Persist active-session state** (queue + id + roster + position) to `sessionStorage` and add
   resume-on-mount so F5 reloads the player in place.
4. **Fix the sequential-show resume path** so `/fitness/play/:id` for a sequential episode resumes the
   player instead of redirecting to the show's episode list.

---

## Cross-Cutting Notes

- **Persistence drops runtime discriminators.** Both Item 1B (challenge `type`) and Item 4
  (no session-state persistence) trace to `PersistenceManager.js` / `FitnessApp.jsx` discarding state
  that the UI later needs. Worth a small principle: persist enough to reconstruct the UI, not just the
  analytics summary.
- **Scattered registries.** Item 1B (challenge icons/colors) and Item 3 (challenge audio lifecycle) both
  want a single source of truth for "challenge type → {label, color, icon, audio cues, lifecycle}." A
  unified challenge-type registry could serve the timeline markers, the toast emojis, and the audio
  mapper at once.
- **No tests** cover the footer zoom hooks (Item 2) or the resilience poisoned-segment loop (Item 4).

## Evidence Sources

- Per-session JSONL: `media/logs/fitness/2026-06-09T02-18-50.jsonl` (+ `…02-42-12`, `…02-44-00`, `…02-44-45`).
- Plex transcode log: `…/Docker/Media/plex/Logs/Plex Media Server.log`.
- `ffprobe`/`ffmpeg` against `/media/kckern/Media/Fitness/Game Cycling/Game Cycling - S02E07 - Daytona USA 2001.mp4`.
- Sample session with both media + challenge events: `data/household/history/fitness/2026-06-08/20260608191948.yml`.
- Prior related audits: `2026-05-18-fitness-av1-transcode-buffer-collapse-audit.md`,
  `2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md`,
  `2026-03-11-fitness-video-dash-playback-failure-audit.md`.
