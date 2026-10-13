# Piano Timed Practice Groove Design

**Date:** 2026-10-04
**Status:** Proposed, conversational design approved

## Purpose

Make Sheet Music Learn timed runs easy for a child to enter and follow. The
learner must know exactly when to begin, be able to hear the click over the
piano, see the beat without looking away from the score, and choose an
appropriate practice speed directly.

The current experience counts upward for as many as twelve note-pulse clicks,
uses a fixed click gain, gives no continuing visual beat, and exposes tempo as
repeated five-percent plus/minus presses with a forty-percent floor.

## Experience

### Count-in

A timed run begins with at most four audible pulses. The centered presentation
counts down `4`, `3`, `2`, `1`, then changes to `PLAY` at the grading boundary.
A horizontal karaoke-style bar drains across the same interval. The score and
keyboard remain visually subdued until `PLAY`.

The four pulses use the run's established musical pulse. They do not enumerate
every subdivision in a complete slow measure. The grading timeline begins after
the final count-in pulse, and the metronome continues without a phase break.

Countdown numeral, drain progress, audible clicks, `PLAY`, the assessment
start, and the continuing visual beat are projections of the same anchored
timeline. None owns an independent timer.

### Beat visibility during the run

While a timed run is active, the score stage receives a restrained halo or
border pulse on each beat. The first beat of the bar is stronger than the
others. The effect must improve beat perception without obscuring notation,
changing layout, or flashing the full screen.

With `prefers-reduced-motion`, animation is removed and a small static beat
marker changes state instead.

### Metronome loudness

Timed Learn exposes four click levels: `Soft`, `Medium`, `Loud`, and `Max`.
The selection controls WebAudio gain for both the count-in and continuing
metronome. It is stored locally on the kiosk because it calibrates a physical
tablet/piano environment, not a score or learner achievement. The default is
`Loud`; existing callers that supply no level retain the current standard gain
until migrated.

Changing click level affects newly scheduled clicks and must not restart the
assessment or move the beat phase.

### Tempo selection

The inline minus/percentage/plus control is replaced with one large tempo
button. Pressing it opens a modal with five direct choices:

| Label | Internal scale |
|---|---:|
| Very slow | 25% |
| Slow | 40% |
| Steady | 60% |
| Nearly there | 80% |
| Full speed | 100% |

The learner-facing label is primary. Effective BPM is secondary. Percentage is
supporting detail only and is not needed to operate the control.

Non-mastery timed work may use all five choices. Mastery and Test Out remain
locked to `Full speed`. The Learn default minimum changes from 40% to 25%.
Configuration may replace the underlying percentages later, but the default UI
remains five named stages rather than an arbitrary numeric stepper.

## Architecture

### Shared timeline projection

`ExerciseRun` continues to own the timed assessment and anchored metronome.
Pure presentation helpers derive:

- remaining count-in pulses;
- countdown progress from `1` to `0`;
- the `PLAY` transition;
- current beat and downbeat state.

`CountInOverlay` receives remaining count and progress rather than a one-based
elapsed beat. The ongoing beat state is exposed as data attributes or CSS
variables on the existing run stage.

### Audio gain

The click scheduler accepts a normalized click level and passes it to
`scheduleBlipAt`. Gain is applied at the final WebAudio boundary so every
scheduler user has the same semantics. Accent gain remains proportionally
stronger while respecting the selected ceiling.

A small storage adapter maps the four semantic levels to tested gains and
persists the selected level. `LearnLab` owns the control; `ExerciseRun` receives
the resolved level as a presentation/audio preference.

### Tempo stages

A pure tempo-stage model owns ids, labels, default percentages, clamping, and
selection. `LearnLab` uses it to render the modal and to construct the existing
`score.tempoPercent`; the assessment and MusicXML tempo scaling interfaces do
not change.

The existing `tempo.minimumPercent` and `tempo.maximumPercent` configuration
filter which stages are available. The default minimum becomes 25. Mastery
continues to force 100 regardless of configuration or prior selection.

## Accessibility

- Countdown uses an accessible phrase such as `Starting in 4`, not an ambiguous
  `beat 4`.
- `PLAY` is announced once at the grading boundary.
- Tempo and click controls are labeled buttons with selected state.
- The modal traps focus, closes with Back/Escape, and returns focus to its
  launcher.
- Beat animation does not depend on color alone and honors reduced motion.

## Telemetry

The countdown-start event records pulse count, pulse BPM, lead-in duration,
tempo stage, and click level. Tempo-stage and click-level changes get explicit
events. No event records every animation frame or beat.

## Testing

Pure tests cover countdown projection, the four-pulse cap, tempo-stage mapping,
configuration filtering, gain mapping, and downbeat projection.

Component tests prove:

- countdown renders `4, 3, 2, 1, PLAY` rather than counting upward;
- audible scheduling, visual beat, and assessment share the anchor;
- selecting a tempo stage immediately updates the run without plus/minus UI;
- mastery cannot leave Full speed;
- click-level changes alter gain without restarting phase;
- reduced-motion presentation remains legible.

The real-Chromium ExerciseRun suite verifies the countdown bar, beat treatment,
tempo modal, and click-level control fit the 1920×1200 kiosk without covering
notation, progress, or the keyboard.

## Out of scope

- Replacing the assessment timing engine.
- Per-score or per-user click-volume histories.
- Arbitrary BPM entry.
- A full-screen flashing background.
- Redesigning non-Learn ScorePlayer tempo controls in this change.
