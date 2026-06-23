# Piano Video Player + Course Browser — Design

> Status: approved design (2026-06-22). Next step: implementation plan via writing-plans.

## Goal

Give the Piano kiosk a proper lecture-watching experience over the Plex
collection `plex:675686` ("Music Education", 28 sub-courses, each with many
lecture "episodes"):

1. A **course → lecture → player** browse flow modeled on
   `frontend/src/modules/Fitness/player/FitnessShow.jsx`.
2. A **custom `PianoVideoPlayer`** modeled on
   `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`, with chrome useful
   to a piano student: a prominent play/pause, rewind −30s/−15s, forward
   +15s/+30s, an **A–B loop** for drilling a passage, and a **playback-rate**
   control (0.5×–2×).

Lectures **resume** where the student left off and show watched / in-progress
indicators.

## Non-goals

- No backend changes. All data and progress come from existing generic
  endpoints (see below).
- No fitness coupling: no HR governance, no fingerprint unlock, no voice memo,
  no media-amplifier boost, no session roster.
- No drag sliders (house rule: touch widgets use discrete tap targets).

## Backend (reused as-is, no changes)

| Endpoint | Use |
|---|---|
| `GET api/v1/list/plex/675686` | The 28 courses (`items`: `{id, title, thumbnail, image}`). Already used by today's `Videos.jsx`. |
| `GET api/v1/fitness/show/{courseId}/playable` | A course's lectures (`items`) with `watchProgress` / `watchSeconds` / `isWatched` / `duration` / `thumbId`, plus `parents` if the course has sub-sections. The endpoint is "fitness"-namespaced but generic; the piano UI ignores its governance/label fields entirely. |
| `POST api/v1/play/log` | Watch-progress sink keyed by `assetId` (the plex id). Same store fitness uses, so resume + watched badges work with zero new backend. Payload mirrors FitnessPlayer's: `{ title, type:'plex', assetId, seconds, percent, status, naturalEnd, duration, reason }`. |

The collection `675686` resolves as `type: collection`, `childCount: 28`. Its
direct children are courses (shows); drilling into a course via `/playable`
returns that course's lectures.

## Engine approach

**Compose the shared `<Player>` engine; do not fork FitnessPlayer.**

`frontend/src/modules/Player/Player.jsx` is a `forwardRef` component whose
imperative handle (via `usePlayerController`) exposes `play`, `pause`,
`toggle`, `seek(t)`, `getCurrentTime()`, `getDuration()`, and
`getMediaElement()`. It renders **no transport chrome of its own** — only state
overlays (loading / paused / stall) and an internal `ProgressBar`. The entire
fitness transport bar lived in the Fitness module, so a custom piano chrome
does not double up.

`PianoVideoPlayer` therefore renders `<Player ref>` (chromeless) and overlays
`PianoVideoChrome`, driving it through `usePlayerController`. The raw `<video>`
from `getMediaElement()` provides `playbackRate` and a `timeupdate` event for
A–B looping.

Rejected alternatives:
- **Fork FitnessPlayer** (~1500 lines welded to governance/HR/voice-memo/
  roster/amplifier) — more work and more risk to strip than to compose the lean
  engine.
- **Raw `<video>`** — loses Plex DASH/transcode/stall-recovery resilience the
  shared Player provides.

## Components

All under `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`.

| File | Responsibility | Depends on |
|---|---|---|
| `Videos.jsx` (rework) | View controller with three states: course grid → course detail → player. Preserves inactivity-return behavior. Reads `config.videos.plexCollection`. | `usePianoKioskConfig`, child views |
| `CourseGrid.jsx` | The 28-course tile grid (reuses `.piano-video-grid`). Tap a course → detail. | `DaylightAPI('api/v1/list/plex/{key}')` |
| `CourseDetail.jsx` | FitnessShow-style layout: course poster + summary on the left, lecture grid (thumbnails + watched/in-progress badge) on the right. Tap a lecture → player. Back → grid. Governance-free. | `DaylightAPI('api/v1/fitness/show/{courseId}/playable')` |
| `PianoVideoPlayer.jsx` | `<Player ref>` (chromeless) + `PianoVideoChrome`, wired via `usePlayerController`. Wrapped in `PlayerBoundary`. Resume on mount; progress logging via `usePianoWatchLog`. Back → lectures. | `Player`, `usePlayerController`, `useABLoop`, `usePianoWatchLog` |
| `PianoVideoChrome.jsx` | Touch transport bar (see below). Presentational; receives state + handlers. | — |
| `useABLoop.js` | Holds `{a, b}`; subscribes to the media element's `timeupdate`; when `t ≥ b`, seeks to `a`. Boundary math is unit-testable. | media element + `seek` |
| `usePianoWatchLog.js` | Throttled `POST api/v1/play/log` during playback (≥500ms apart, like fitness) and on close/advance; resolves resume seconds on mount. | `DaylightAPI` |

### `PianoVideoChrome` controls

- **Big center play/pause** — the primary control.
- **Rewind −30s and −15s**, **forward +15s and +30s** — discrete tap buttons;
  each clamps to `[0, duration]` and calls `seek`.
- **A–B loop** — tap **A** to mark start at current time, tap **B** to mark end;
  while both set, playback loops A→B (via `useABLoop`). A **clear** tap removes
  the loop. Visual markers on the seek bar show A and B.
- **Speed** — discrete tap-cycle through `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2`×,
  applied to `mediaEl.playbackRate`. Reuses `playbackRateCycle` util with a
  piano ladder. No slider.
- **Seek / progress bar** — tap-to-seek; shows current position, A/B markers,
  buffered range.
- **Time display** — `MM:SS` (or `H:MM:SS`).
- **Back** — return to the course's lecture list (saves progress on the way out).

All targets are large (kiosk is touch-first); no drag sliders.

## Play-along (keyboard + grand staff)

While a lecture plays, the student can play along on the connected MIDI piano and
see live feedback. The player consumes `usePianoMidi()` (the same hook the Games
mode uses; `PianoMidiProvider` wraps all piano modes in `PianoApp.jsx`), reading
the live `activeNotes` Map.

- **Bottom keyboard** — the existing `PianoKeyboard`
  (`frontend/src/modules/Piano/components/PianoKeyboard.jsx`) in a fixed-height
  strip, fed `activeNotes`, so keys light up as they are pressed.
- **Note waterfall** — the existing `NoteWaterfall`
  (`frontend/src/modules/Piano/components/NoteWaterfall.jsx`) directly above the
  keyboard, fed `noteHistory` + `activeNotes`. It uses the same
  `getNotePosition` mapping as `PianoKeyboard` (same `startNote`/`endNote`), so
  played notes stream down and align to the keys (Synthesia-style). No `gameMode`
  prop — plain play-along, not a game.
- **Right grand staff** — the existing `CurrentChordStaff`
  (`frontend/src/modules/Piano/components/CurrentChordStaff.jsx`), fed
  `activeNotes`. It renders held notes on a treble+bass grand staff (abcjs) with
  rolling key detection and note decay.
- **Note/chord readout** — a small text line naming the notes currently held and,
  when they form a known triad/seventh (any inversion), the chord name
  (e.g. "C E G — C major"). Powered by a new pure helper `describeChord` over
  `getNoteName` (`frontend/src/modules/Piano/noteUtils.js`).
- **Toggle** — the transport bar has a play-along toggle. Play-along shows by
  default; toggling it off hides the keyboard, staff, and readout so the video
  fills the stage. State lives in `PianoVideoPlayer`.

The feedback is a live mirror of the student's own playing — not graded against
the lecture (the videos carry no note-level MIDI reference).

Layout: a stage row (video on the left, grand staff on the right) above the
transport bar, with the note waterfall + keyboard strip stacked across the
bottom (waterfall above, keys below, sharing the same note range so they align).
When play-along is off, the video occupies the full stage and the
waterfall/keyboard strip and staff are hidden.

## Data flow

```
Videos (controller)
  ├─ CourseGrid      ← GET list/plex/675686            (28 courses)
  │     tap course →
  ├─ CourseDetail    ← GET fitness/show/{courseId}/playable  (lectures + progress)
  │     tap lecture →
  └─ PianoVideoPlayer
        <Player ref> (chromeless)  ──getMediaElement()──► useABLoop (timeupdate→seek a)
        usePlayerController ──► PianoVideoChrome (transport)
        usePianoWatchLog ──► POST play/log (throttled) ; resume seconds on mount
```

State lives in `Videos.jsx`: `{ selectedCourse, selectedLecture }`. Null course
= grid; course set, lecture null = detail; both set = player.

## Resume & progress

- On player mount, resolve resume seconds from the lecture item
  (`watchSeconds` / derived from `watchProgress × duration`), and `seek` once the
  media is ready.
- During playback, `usePianoWatchLog` POSTs `play/log` throttled to ≥500ms, and
  on close/advance with the final position. `status` follows the fitness
  convention (`in_progress` / `completed` when ≥98%).
- `CourseDetail` reads `isWatched` / `watchProgress` from `/playable` to render a
  watched check or an in-progress bar on each lecture tile. Re-fetching the
  course on return reflects the latest position.

## Styling

Extend `frontend/src/Apps/PianoApp.scss` with `.piano-video-detail`,
`.piano-video-chrome`, and lecture-badge classes, following the existing
`.piano-*` BEM naming and the dark kiosk theme (Roboto Condensed, accent
green `#3c7`). Reuse `.piano-video-grid` for both the course grid and the
lecture grid.

## Input model

Touch-first, matching the rest of the kiosk: large tap targets, no keyboard or
remote dependency. `useInactivityReturn` continues to send an idle student back
to the menu. (Optional dev-only keyboard shortcuts may be added but are not
required.)

## Logging

`getLogger().child({ component: 'piano-video-player' })` (and
`'piano-video-detail'`, `'piano-video-grid'`) emit structured events at:
mount/unmount, course/lecture selection, transport actions (play/pause/seek/skip),
A–B set/clear, speed change, resume, and `play/log` success/fail.

## Testing

- Extend `Videos.test.jsx`: course list renders from `list/plex`; tapping a
  course fetches and renders its lectures; back returns to the grid.
- Unit-test `useABLoop` boundary logic (seeks to A at/after B; no-op when only
  one bound set; clears correctly).
- Unit-test the speed-cycle helper (wraps the 0.5–2× ladder).
- Resume test: player mount triggers a `seek` to resume seconds and `play/log`
  fires during playback.

## Config

`config.videos.plexCollection` already drives the collection. Confirm it is set
to `plex:675686` for the active piano (`PianoConfig` default is `null`; the real
value lives in the piano admin config).

## Reused as-is

`PlayerBoundary`, `usePlayerController`, `Player`, the `playbackRateCycle` util
(with a piano ladder), `useInactivityReturn`, `DaylightAPI`, the logging
framework.

---

*Code lives at `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`; the shared
engine at `frontend/src/modules/Player/`.*
