# Fitness Content Modes — Instructional Labels

**Date:** 2026-08-12
**Status:** Design approved, pending implementation plan

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
- **The primary verb is navigation, not playback.** A workout is play-once-never-touch,
  which is why the scrub strip lives in a footer that is hidden whenever the layout snaps to
  fullscreen — on a 16:9 display, always. A lesson is a constant hunt: back 5, back 5,
  forward 2, *there*.
- **Seeking must be a paused operation.** The viewer rocks back and forth around a spot while
  paused, watching the frame update, then plays. Better still, repeats a short window
  hands-free while copying the move.

Same media pipeline, opposite interaction model. A Plex label selects between them.

---

## Configuration

```yaml
plex:
  # Suppress all session capture. Nothing is recorded; no recap is produced.
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

---

## Resolution

Labels reach the frontend already lowercased and show-merged — `PlexAdapter` merges
show-level labels into each episode, so an episode of a labelled show carries
`instructional` even though the label is applied to the show.

A helper `resolveContentMode(currentItem, plexConfig)` returns
`{ captureDisabled, studyUx }`, normalising and intersecting label lists using the same
pattern as the existing `resumable_labels` check in the fitness player. Both flags are
surfaced on fitness context so the widget registry can read them.

Absent both labels, every value is `false` and all existing behaviour is unchanged.

---

## Capture suppression (`captureDisabled`)

Three capture surfaces exist, all currently gated only on `timelapse.enabled`:

| Surface | Role | Change |
|---|---|---|
| Player frame capture hook | screenshots the video (`role:'player'`) | additionally gated on `!captureDisabled` |
| Session camera capture | headless webcam (`role:'camera'`) | same gate; component returns `null` |
| `CameraViewApp` widget | live webcam panel | new `requires.captureAllowed`; registry hides it |

All three stop. The camera component returning `null` means **no webcam stream is ever
acquired** — the guarantee is "the camera never opens," not "the frames are discarded."

Player frames are suppressed alongside camera frames because the timelapse frame mapper
returns nothing without at least one camera frame; retaining player capture would write
orphaned frames for a recap that can never render.

---

## Study UX (`studyUx`)

### Pause scrim suppressed

The paused overlay already has an exact precedent for suppression: its blackout path returns
`null` early. A parallel `suppressPauseOverlay` prop is threaded from the player component.

Critically, the underlying `pauseOverlayActive` state stays `true`, which keeps the *loading*
overlay suppressed as well. Without this, suppressing the pause overlay alone would let the
loading overlay take its place. The result is a clean frozen frame with no full-screen
chrome — a small unobtrusive corner indicator replaces the large glyph, so pause is still
discoverable without covering the content.

### Footer band

Study mode pins the player to `normal` mode and skips the fullscreen auto-snap that fires
when computed footer height falls below 5% of the viewport. `footer_height_ratio` of viewport
height is reserved for the footer; the video letterboxes to roughly 80% height.

This is a real laid-out element rather than a floating overlay: no z-index games, no
translucent full-width band (a known frame-rate cost on this hardware), and nothing covering
the dancers' feet. The existing footer — seek buttons, thumbnail scrub strip, time display —
mounts unchanged.

**Accepted trade-off:** the video is visibly smaller than in workout fullscreen. This is the
cost of a permanently reachable scrub strip.

### Paused jogging

No transport change is required. The transport's seek only assigns `currentTime` and never
calls `play()`, so seeking while paused already leaves playback paused. The pause scrim was
what hid the result. Removing it makes paused jogging work.

Jog buttons are the existing seek buttons sized to `jog_steps`.

### Loop

No endpoint marking. The pause position is one edge of the loop; a single tap picks the side
and the length.

```
PAUSED at 4:12
  ↺ LOOP BACK    [10] [15] [20] [30]     → 4:02 ⇄ 4:12
  ↻ LOOP FWD     [10] [15] [20] [30]     → 4:12 ⇄ 4:42
```

The loop options appear **only while paused**, where `P` is the paused position. They are
hidden during playback, so the loop window is always anchored to a position the viewer
deliberately chose and can see on screen.

- **Back** loops `[P − N, P]` — "I just watched that; run it again."
- **Forward** loops `[P, P + N]` — "run what comes next."
- Durations come from `study_mode.loop_durations`.
- Arming starts playback and repeats the window via a `timeupdate` listener that seeks back
  at the far edge.
- Release by tapping the armed duration again, or by any manual seek or transport stop.
  The armed duration renders in an active state so the current loop is always visible.
- Both edges are clamped to `[0, duration]`.

### Mirror

A **visible** mirror toggle is added to the footer, wired to the existing mirror state and
toggle — no new state. The current affordance is two invisible corner hotspots carrying a
glyph at 0.16 opacity, deliberately unobtrusive for workouts and effectively undiscoverable.
Those hotspots remain for workout mode; study mode gets a real labelled control.

---

## Testing

**Unit — `resolveContentMode`:** label match, case-insensitivity, show-merged episode labels,
absent/empty config, and independence of the two lists (each label list alone yields only its
own flag).

**Component — capture:** both capture components render `null` and acquire no media stream
when `captureDisabled`; `CameraViewApp` is absent from the registry.

**Component — overlays:** the paused overlay returns `null` under `suppressPauseOverlay`
while the loading overlay remains suppressed (guards the regression where one replaces the
other).

**Component — loop:** back and forward windows compute correctly; the boundary seek fires at
the far edge; clamping holds at position 0 and at duration; a manual seek releases the loop.

**Regression:** existing fitness suites must stay green. Unlabelled content takes a path
identical to today's.

---

## Related

- Plex show `696065` (*Show Her Off*) carries label `Instructional` — the first content this
  targets.
- Labels are applied via `cli/plex.cli.mjs set <id> --labels "..." --lock`.
