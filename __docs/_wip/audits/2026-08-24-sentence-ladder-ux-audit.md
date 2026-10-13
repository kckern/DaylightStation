# Sentence Ladder UX audit

Date: 2026-08-24

Scope: code-only review of the learner flow from the locked School keypad into
the current Sentence Ladder day. Corpus, learner progress, assignments, and
other production data were not changed.

## Findings

### Weak session hierarchy

The former header rendered `Day N`, pacing, and device settings as one shallow
row, followed by a thick progress pill with text floating over its fill. It did
not establish a clear reading order, and the progress label could lose contrast
as the fill crossed behind it.

Remediation: the header now names the context (`Today's session`), gives the
day typographic priority, groups secondary actions, and separates a plain-text
step count from a thin, accessible progress track.

### Navigation looked generated rather than composed

Every rung was an independent pill. Five pills with badges wrapped according
to label length, producing a ragged and unstable row. The same accent fill was
also used for primary actions, sounding text, and progress, so active
navigation competed with the task.

Remediation: modes now occupy one stable segmented rail. The active mode uses a
quiet surface change and a single accent rule; counts remain subordinate. The
rail scrolls horizontally on narrow screens instead of creating an arbitrary
second row.

### The task lacked a visual stage

Sentence text, inputs, and controls floated in the full remaining viewport.
Vertical centering alone did not create grouping or useful balance, especially
when one mode had substantially less content than another.

Remediation: every rung now uses the same bounded study stage, with a measured
maximum width, responsive padding, one border, and one background. Source,
target, response, and action remain in a stable reading column across all four
modes. Review uses the same content width.

### Exit and completion language were dishonest

The locked School shell rendered a generic `Done` button throughout the
session, even while work remained. Sentence Ladder also rendered its own final
`Done`, so completion could produce duplicate exits.

Remediation: an active session offers `Leave for now`; `Done` appears only
after all required, device-completable steps are saved. The completion panel
acknowledges the exact day and saved step count and states that the work counts
toward School progress.

### Progress acknowledgement was only implicit

The visible bar changed, and `day-loaded` was logged, but there was no stable
structured emission representing the learner-visible progress state.

Remediation: the runner emits one `school.language.program.progress` diagnostic
per distinct `(day, done, total, blocked)` state. Capability-driven duplicate
loads do not duplicate an unchanged progress emission.

### Edge states could strand the learner

An empty derived queue rendered the mode rail and an otherwise blank study
body. Rejected prompt audio instructed the learner to tap Play again while the
only available control could still be Stop or a non-interactive listening
status. History failures had no retry. A MediaRecorder failure after acquiring
the microphone could also leave the stream open.

Remediation: an empty day now says that nothing is due and, in the locked
lifecycle, provides the terminal `Done` action. A queue empty only because the
device lacks a required input names the missing mode and remains escapable
without claiming credit. Rejected playback returns both repetition and
recording to their start controls, history offers retry, recording playback
distinguishes loading from unavailable audio, and every capture failure
releases its microphone stream.

## Verification

- Sentence Ladder and connected School lifecycle tests cover keypad entry,
  all four offered modes, saved progress acknowledgement, locked exit states,
  empty and device-blocked days, audio rejection recovery, history retry,
  completion settlement, configured reward handoff, and completion-state
  emission.
- A final visual acceptance pass on the 1280×800 Portal remains necessary. The
  in-app browser runtime was unavailable during this audit, and a second local
  backend was deliberately not started because it would control live household
  integrations.
