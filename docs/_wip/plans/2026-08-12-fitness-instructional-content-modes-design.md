# Fitness Content Modes — Instructional Labels

**Date:** 2026-08-12
**Status:** Design approved (revised after adversarial review), pending implementation plan

---

## Problem

The fitness player is built around one assumption: **the viewer is exercising.** They are
across the room, hands full, not touching the screen. Every design choice follows:
full-bleed video legible from ten feet back, vitals overlaid on top, a webcam recording the
session for a timelapse recap, and pause treated as "I stopped working out" — signalled by a
dimming scrim with a large pause glyph.

Instructional content inverts every one of those assumptions. A dance lesson (Plex show
`696065`, *Show Her Off*, labelled `Instructional`) is studied, not performed:

- **Recording is unwanted, not merely useless.** There is no workout to memorialize, and a
  camera silently recording a couple's date night is undesirable regardless of output
  quality.
- **Pause means the opposite thing.** In a workout, pause means "I quit — tell me loudly."
  In a lesson, pause means "hold on, show me that hand position again." The moment of pause
  is the moment the frame matters most, and the current scrim covers exactly that frame.
- **The primary verb is navigation, not playback.** A workout is play-once-never-touch. A
  lesson is a constant hunt: back 5, back 5, forward 2, *there*. The scrub strip lives in a
  footer that disappears the moment the viewer taps the video and lands in fullscreen.
- **Seeking must be a paused operation.** The viewer rocks back and forth around a spot while
  paused, watching the frame update, then plays. Better still, repeats a short window
  hands-free while copying the move.

Same media pipeline, opposite interaction model. A Plex label selects between them.

---

## Configuration

```yaml
plex:
  # Suppress all session frame capture. No recap is produced.
  no_capture_labels:
    - Instructional
  # Swap the player to a study-oriented interaction model.
  study_ux_labels:
    - Instructional

study_mode:
  loop_durations: [10, 15, 20, 30]  # seconds offered as onscreen loop options
  jog_steps: [5, 10]                # paused jog button sizes, seconds
  footer_height_ratio: 0.20         # viewport share reserved for the footer band
```

The two label lists are **independent and composable**. A show labelled only
`no_capture_labels` suppresses recording without altering its player UX (a privacy-sensitive
workout); a show labelled only `study_ux_labels` gets study controls while still recording.

Label lists live under `plex:` beside the existing `*_labels` keys, matching established
convention. Tunables occupy their own `study_mode:` block.

**Config plumbing is verified pass-through**: `FitnessConfigService.loadRawConfig` returns
raw YAML, the router serves the block whole, and `FitnessContext` passes the entire `plex`
block through as `plexConfig`. New keys flow without per-key projection. Note that context
prefers `root.content` over `root.plex` when both exist.

---

## Label resolution — including the hole that must be closed

`resolveContentMode(item, plexConfig)` returns `{ captureDisabled, studyUx }`, normalising
both sides to lowercase and intersecting — the same pattern as the existing `resumable_labels`
check. Absent both labels every flag is `false` and all existing behaviour is unchanged.

**Labels do not arrive reliably today.** This was the review's most important finding and
must be fixed as part of this work:

| Path | Today | Required |
|---|---|---|
| FitnessShow → play | Works, but only because the **frontend** unions episode labels with `showData.info.labels` in `deriveEpisodeLabels`. Episode-level labels are dropped by the API. | Keep working; reuse this union as the model. |
| FitnessMenu → direct queue | **Broken.** Queue items carry `labels: undefined` — the shared list serializer emits no `labels` field, and the show-listing mapper has none either. | Must resolve labels. |

The adapter's show-label merge exists but only fires for directly-playable ids; the
show → season → episode listing path converts episodes without it. Combined with the
serializer omission, a show labelled for `no_capture_labels` and queued from the menu
**would record anyway**.

**Decision — fix in the Fitness consumer.** The Fitness queue-building path resolves labels
itself when constructing queue items; the shared list serializer is left untouched. This
follows the standing preference to fix in the consumer rather than a shared module used well
beyond fitness.

Until this is closed, "the camera never opens" is a default, not a guarantee. Closing it is
in scope.

---

## Capture suppression (`captureDisabled`)

Three capture surfaces, all currently gated only on `timelapse.enabled`:

| Surface | Role | Change |
|---|---|---|
| Player frame capture hook | screenshots the video (`role:'player'`) | additionally gated on `!captureDisabled` |
| Session camera capture | headless webcam (`role:'camera'`) | same gate; component returns `null` before mounting the webcam, so `getUserMedia` is never called |
| `CameraViewApp` widget | live webcam panel | hidden from the module menu; self-disables if already open |

Player frames are suppressed alongside camera frames because the timelapse frame mapper
returns `[]` without at least one camera frame — retaining player capture would write
orphaned frames for a recap that can never render.

### The widget gate needs a mechanism that does not exist yet

`manifest.requires` is **decorative — it has zero consumers anywhere.** `CameraViewApp`
already declares `requires.sessionActive` and it has never been enforced. The module menu
builds purely from config, filtering only on "a manifest exists."

So the widget gate must be built:

1. **Data flow.** `captureDisabled` derives from the currently-playing item, which is player
   local state. It must reach the module menu, which lives outside the player. The player
   already publishes current media to fitness context; content mode is derived and exposed
   there alongside it.
2. **Menu filtering.** The module menu filters `camera_view` out of its item list when
   `captureDisabled`.
3. **Already-open case.** If `CameraViewApp` is open when an instructional item starts, the
   widget itself must tear down its stream and render a disabled state. Menu filtering alone
   does not stop a live webcam.

Implementing a general `requires` evaluator is **out of scope** — this builds the specific
gate, not a framework.

### Scope boundary

Frame capture stops. Session telemetry does not: `media_start` events with title and show
metadata are still written to the session log, and the session still records what was
played. The guarantee is "no camera, no images," not "no record that this was watched."

---

## Study UX (`studyUx`)

### Pause scrim suppressed

The paused overlay has an exact precedent for suppression: its blackout path returns `null`
early. A parallel `suppressPauseOverlay` prop is threaded from the player component.

**Use this new prop, not the existing `showPauseOverlay` state.** That internal state
(toggled by double-click today) also hides the overlay, but it drives `isVisible` false and
suppresses stall feedback along with it. The new prop keeps `pauseOverlayActive` true, which
keeps the *loading* overlay correctly suppressed while preserving stall feedback.

**Stated exception:** the loading overlay's condition is `(!pauseOverlayActive || stalled)`,
and `stalled` includes buffering. A paused jog into an unbuffered region **will** briefly
show the spinner over the frozen frame. This is desirable feedback and is not a bug — "no
full-screen chrome" applies to the healthy paused state, not to stalls.

A small unobtrusive corner indicator replaces the large glyph, so pause stays discoverable.

### Layout: video + footer, no sidebar, no fullscreen

The existing layout derives the footer as *leftover* space: video is sized from width first
(available width minus sidebar, at 16:9), and the footer gets whatever height remains. There
is no ratio to set. Study mode therefore changes the sizing rule:

- **Hide the sidebar** (decision). No workout is being monitored, so vitals are noise, and
  the full width partly offsets the height lost to the footer.
- **Clamp video height** to `(1 − footer_height_ratio) × viewportHeight`, deriving width from
  that height at 16:9, and centre horizontally. This inverts the normal width-first rule.
- The footer is a real laid-out element — no z-index games, no translucent band (a known
  frame-rate cost on this hardware), nothing covering the dancers' feet.

**Correction to an earlier premise:** the sub-5% fullscreen auto-snap is *not* what strands
the footer. With the sidebar present, normal mode on a 16:9 display already yields roughly a
13% footer, so the auto-snap cannot fire. Fullscreen on the garage display comes from the
**tap-to-toggle gesture**. That is what must be addressed.

**Decision — disable tap-to-fullscreen entirely in study mode.** Both handlers (content-level
and root-capture) are neutralised; fullscreen is unreachable while studying. This matters
because removing the pause scrim also removes the shield that was blocking paused taps from
reaching the fullscreen toggle — without this, a paused double-tap would land on the toggle
underneath. Video taps do nothing; transport lives in the footer.

**Accepted trade-off:** the video is visibly smaller than workout fullscreen. That is the
price of a permanently reachable scrub strip.

### Paused jogging — and the resilience interaction that would break it

The transport's seek only assigns `currentTime` and never calls `play()`, and controller
stall detection correctly disengages while paused. Removing the scrim makes the frozen frame
visible. So far, no transport change is needed.

**But paused jogging does not survive the resilience stack, and this must be fixed.** The
chain, verified end to end:

1. During any seek, user intent flips from `paused` to `seeking`, so `isUserPaused` is false.
2. `isStuck` = has-played ∧ **not-user-paused** ∧ clock-not-advancing ∧ (stalled ∨ buffering ∨
   seeking). A paused seek that wedges — the documented case of seeking forward past the
   transcoder head — satisfies all of it.
3. After ~9.5s continuously stuck, the jolt ladder escalates to refresh-url, then remount.
4. The rebuilt element sets `autoplay = true` **unconditionally**. The `wasPaused` snapshot
   restore exists only on the controller's soft-reinit path; the resilience remount restores
   the seek target but not paused-ness.

Net: a paused forward-jog into untranscoded territory silently resumes playback about ten
seconds later. Study mode's signature gestures — repeated forward jogs, "loop what comes
next" — seed exactly this condition. The player's own 15s seek-safety timeout is longer than
the 9.5s grace, so it does not save you.

**Requirement:** pause intent must survive resilience recovery. The recovery path restores
paused state the same way the soft-reinit path already does via its snapshot. The
implementation plan owns the precise mechanism, but the acceptance criterion is concrete: a
paused seek that wedges must leave the player paused, never playing.

Jog buttons are the existing seek buttons sized to `jog_steps`.

### Loop

No endpoint marking. The pause position is one edge; a single tap picks side and length.

```
PAUSED at 4:12
  ↺ LOOP BACK    [10] [15] [20] [30]     → 4:02 ⇄ 4:12
  ↻ LOOP FWD     [10] [15] [20] [30]     → 4:12 ⇄ 4:42
```

Loop options appear **only while paused**, where `P` is the paused position; they are hidden
during playback, so the window is always anchored to a position deliberately chosen and
visible on screen.

- **Back** loops `[P − N, P]` — "I just watched that; run it again."
- **Forward** loops `[P, P + N]` — "run what comes next."
- Durations come from `study_mode.loop_durations`; both edges clamp to `[0, duration]`.
- Arming starts playback and repeats via a `timeupdate` listener that seeks back at the far
  edge. The armed duration renders active so the running loop is always visible.

**Release semantics — must distinguish seek origins.** "Any manual seek releases the loop"
is ambiguous, because the loop's own boundary seek *is* a transport seek, and resilience
recovery seeks travel the same machinery. The loop marks its own boundary seeks so they do
not self-release, and recovery seeks likewise do not count as user intent. Release happens
on: tapping the armed duration again, a user-initiated seek (jog button or scrub strip), or
transport stop.

**The `timeupdate` listener must re-attach when the media element is replaced.** A resilience
remount swaps the element; a listener bound once dies silently mid-loop.

### Mirror

A **visible** mirror toggle in the footer, wired to the existing mirror state and toggle —
no new state. The current affordance is two invisible corner hotspots carrying a glyph at
0.16 opacity: deliberately unobtrusive for workouts, effectively undiscoverable. Those
hotspots remain for workout mode; study mode gets a real labelled control.

---

## Testing

**Unit — `resolveContentMode`:** label match, case-insensitivity, absent/empty config, and
independence of the two lists (each label alone yields only its own flag).

**Unit — label resolution:** queue items built from the menu path carry labels; the
FitnessShow path keeps working; show-level labels reach episode items.

**Component — capture:** both capture components render `null` and acquire no media stream
when `captureDisabled`; `camera_view` is absent from the module menu; an already-open
`CameraViewApp` tears down its stream when an instructional item starts.

**Component — overlays:** the paused overlay returns `null` under `suppressPauseOverlay`
while the loading overlay stays suppressed (guards the regression where one replaces the
other); the loading overlay **does** appear when stalled.

**Component — layout:** study mode hides the sidebar, clamps video height to the configured
ratio, and centres it; tap on video does not toggle fullscreen.

**Component — loop:** back and forward windows compute correctly; the boundary seek fires at
the far edge; clamping holds at 0 and at duration; a user seek releases the loop but a
boundary seek does not; the listener survives a media-element swap.

**Integration — the resilience regression:** a paused seek that wedges long enough to trigger
the jolt ladder leaves the player **paused**. This is the single highest-risk behaviour in
the design and needs an explicit test, not a manual check.

**Regression:** existing fitness suites stay green. Unlabelled content takes a path identical
to today's.

---

## Related

- Plex show `696065` (*Show Her Off*) carries label `Instructional` — the first target.
- Labels are applied via `cli/plex.cli.mjs set <id> --labels "..." --lock`.
