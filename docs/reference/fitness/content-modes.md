# Content Modes (Instructional Labels)

Some content in the fitness library isn't a workout — an anatomy lecture, a technique
breakdown, a course episode watched for information rather than exertion. Content modes
let a Plex label change how the fitness player behaves for that item: whether it's ever
recorded, and whether the player switches into a study-oriented interaction model instead
of the ordinary workout one.

---

## The two label lists

Two independent config lists, both under `plex:` in the household fitness config, each
holding zero or more Plex labels:

- **`no_capture_labels`** — content carrying one of these labels is never recorded. No
  webcam frames, no player frames, no session recap.
- **`study_ux_labels`** — content carrying one of these labels gets the study interaction
  model instead of the workout one (see below).

The lists are independent by design — a label can appear in one, the other, both, or
neither. In practice both lists currently hold the same label (`Instructional`), so
instructional content is both never recorded and rendered with the study UX, but nothing
in the system requires that coupling. A label could suppress capture without changing the
UX, or switch the UX for content that's still fine to record.

Matching is case-insensitive and accepts either a plain label string or a Plex tag object
(`{ tag: 'Instructional' }`) on the item. A label match on an item's own labels resolves
synchronously; if the item doesn't carry labels inline, the player looks up the labels
from the item's show and resolves once that lookup settles (see *Fail-safe resolution*
below).

---

## What `no_capture_labels` suppresses

Setting `captureDisabled` for an item turns off every frame-capture surface:

- The interval-based player-frame capture that feeds the session recap's picture-in-picture.
- The session camera capture that feeds the recap's primary shot.
- The `camera_view` widget: it's dropped from the module menu entirely, and if it's
  already open when an instructional item starts playing, it tears itself down (drops its
  `getUserMedia` stream) rather than keep recording.

With no camera captures for a session, the recap has nothing to composite and is simply
**skipped** — not an error state, just nothing to render. A session that mixes
instructional and ordinary content only has camera frames for the ordinary portions, so a
recap still renders around the gap.

## What `study_ux_labels` swaps in

Setting `studyUx` for an item changes the player's interaction model, on the assumption
that a viewer studying a lecture wants precise control over a still frame, not a workout
metronome:

- **No pause scrim.** Pausing keeps the frame crisp on screen — no dimming overlay, no
  fullscreen pause glyph. (The loading/stall spinner is untouched; a genuinely stalled
  seek still shows buffering feedback.)
- **A permanently reachable scrub footer.** The layout reserves a footer band first and
  fits the video into what's left, rather than the workout layout's video-first sizing —
  so the footer is never crowded out. The sidebar is withheld, and tap-to-fullscreen is
  disabled everywhere in the player (the main video area, the frame root, and the
  loading-overlay tap-to-fullscreen path) so an accidental tap never yanks the viewer out
  of the footer-visible layout.
- **Paused jogging.** Jog buttons step the frame forward or backward by a configured
  number of seconds without resuming playback — jogging while paused leaves the player
  paused.
- **Loop windows.** A loop can be armed, anchored at the current paused position, for a
  configured duration in either direction; once armed it repeats hands-free, looping past
  the end of the clip if needed by seeking back and resuming. Any seek the viewer makes
  outside the loop's own repeat-seeks releases it automatically — there's no separate
  "release" gesture required, and an already-armed loop can also be released by tapping
  its chip.
- **A visible mirror toggle**, alongside the workout mode's corner-hotspot mirror gesture.

## Fail-safe: capture stays off until the mode resolves

An item's content mode isn't always known immediately. If the item doesn't carry labels
inline, the player has to fetch them from the item's show before it can decide. Capture is
**fail-closed** for that entire window: `captureDisabled` counts as disabled and
`studyUx` counts as off until resolution completes, so an item never starts recording on
the strength of "we haven't checked yet." This applies to ordinary, unlabelled workout
content too — every item spends a brief unresolved window at mount before its true mode
(usually "no restrictions") is known.

A failed lookup doesn't fall back to "allow capture" — it stays unresolved. But a single
failed attempt also doesn't strand a session forever: a failed lookup retries automatically
with backoff, up to a bounded number of attempts. Once the bound is exhausted the item
stays unresolved (and therefore capture-disabled) for that mount; a later mount for the
same show — reopening the item, or a different session touching the same show — starts a
fresh attempt sequence rather than inheriting the earlier failure. Nothing is ever cached
except a genuine success, so a transient lookup failure can't permanently mis-resolve a
show as "no restrictions."

## Scope boundary: capture stops, session telemetry does not

Content-mode suppression is scoped narrowly to the two frame-capture surfaces and the
camera widget. It does **not** touch anything else about how a session is tracked: heart
rate and other sensor telemetry, governance state (zone, coins), session start/end
recording, and the session's own JSONL activity log all keep running exactly as they would
for ordinary content, regardless of content mode. Watching an instructional episode still
counts as session activity in every respect except the recorded imagery — only the
recap-feeding frame captures are gated.

---

## `study_mode` tunables

A top-level `study_mode:` config block holds the study UX's adjustable values:

- **`loop_durations`** — the set of loop lengths (in seconds) offered as arming options,
  in each direction from the paused position.
- **`jog_steps`** — the set of step sizes (in seconds) offered for the paused jog buttons.
- **`footer_height_ratio`** — the fraction of the available vertical space reserved for
  the scrub footer before the video is sized into what remains.

Config changes here are picked up on the next backend restart (household app config is
cached in memory at startup).

---

## Related references

- [Session Time-Lapse Recap](./session-timelapse.md) — the recap this feature's capture
  suppression causes to be skipped for fully-instructional sessions.
- [Footer Zoom Navigation](./footer-zoom-navigation.md) — the workout-mode seek footer
  the study UX's scrub footer sits alongside.

---

## Source map

- Label resolution: `frontend/src/hooks/fitness/resolveContentMode.js`,
  `frontend/src/hooks/fitness/useContentMode.js`
- Capture gating: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`,
  `frontend/src/context/FitnessContext.jsx`,
  `frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx`,
  `frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.jsx`
- Study UX layout: `frontend/src/modules/Fitness/player/studyLayout.js`,
  `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx`
- Loop engine: `frontend/src/modules/Fitness/player/hooks/useLoopWindow.js`
- Study controls (jog/loop/mirror): `frontend/src/modules/Fitness/player/footer/StudyControls.jsx`
- Config: `plex.no_capture_labels`, `plex.study_ux_labels`, `study_mode` in the household
  fitness config
- Admin UI: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx`
