# PianoChallenge SP2 — Recall and Read Presentations

**Date:** 2026-08-28

**Goal:** Make the existing session seam present and grade the two challenge
forms the current PianoChallenge cannot express: a named chord played from
memory, and a freely timed notated line. This is SP2 from the approved roadmap;
it does not add hosts, alter household YAML, or deploy.

## Outcomes

- User_5 can be assigned a named chord such as “Play a C major chord,” with no
  lit-key answer, accepting any octave/voicing and optionally requiring the
  named bass for inversions.
- A free-timed line can use properly duration-aware engraved notation instead
  of the sequence staff or the timing-oriented score path.
- A one-note reading ask has a compact staff card rather than an oversized
  empty notation surface.
- `hints: after-stall` reveals the answer before the existing 20-second
  free-attempt timeout; it does not silently turn into a fail or change the
  frozen unavailable/failure vocabularies.

## Current facts and boundaries

- `AskSession` resolves material and has the authored level plus picked spec;
  `ExerciseRun` owns presentation, assessment, persistence, and callbacks.
- `askSchema` already accepts `recall`, `engraved`, and hint values but
  deliberately reports `not-yet-implemented` for recall and non-`none` hints.
- The engine's held matcher currently compares exact MIDI pitches. It is the
  only matcher appropriate for an unordered chord and is the correct place for
  a pitch-class policy—never expand expected pitches into every octave.
- `ExerciseNotation` currently renders a generic ABC line; `ScorePassage` is
  only for actual MusicXML score material and must remain its own compilation
  path.
- Existing practice/program/video behavior is frozen. New presentation values
  must be opt-in and legacy tiers must keep their current output.

## Design decisions

1. **The tuple travels to the run.** `AskSession` passes the resolved flat
   tuple (not just `tier`) to `ExerciseRun`. The run falls back to its existing
   tier-derived tuple only for legacy/direct mounts. This prevents a second,
   divergent interpretation of a presentation axis.
2. **Recall is a primary stage.** It renders the host's ask line and a calm
   named-target card; it never renders target lights. A secondary `staff`
   remains a deliberate authored reinforcement, not an accidental hint.
3. **Pitch class is a grading policy.** Add `pitchClass: true` and optional
   `bassPitchClass` under the existing requirement policy. The held matcher
   compares normalized pitch-class sets when enabled, permits arbitrary octave
   placement/voicing, and verifies the lowest held pitch only when a bass is
   specified. Exact-MIDI behavior remains the default.
4. **Hints are a presentation transition, not a new grade.** On a free,
   running ask, `after-stall` flips one local `hintVisible` state before the
   existing timeout. The timeout still produces the same judged timeout if the
   child does not finish; `always` starts with that state true.
5. **Engraved free lines reuse the MusicNotation boundary.** Build a small
   duration-aware MusicXML/ABC adapter from exercise events and use the existing
   engraver component. It receives cursor/wrong/complete feedback just as the
   current notation stage does; it does not invent a second notation renderer.

## Tasks

### 1. Make SP2 grammar executable

**Files:** `frontend/src/modules/Piano/ask/askSchema.js`, its tests, and the
requirement builder/tests in `ask/gateAsk.js`.

- Remove only the two implementation-gate errors for `recall` and hints; retain
  all vocabulary and structural constraints.
- Validate `grading.pitchClass` as a boolean and `grading.bassPitchClass` as an
  integer 0–11; reject bass without pitch-class mode and reject either on a
  non-chord/unordered ask.
- Have `requirementForLevel` preserve those policy values with a named,
  documented shape instead of leaking raw level data to the assessment engine.
- Tests: valid named-chord tuple; invalid score-recall, bass-only, out-of-range
  bass, and non-chord policy combinations; legacy tier expansion remains exact.

### 2. Add pitch-class held matching

**Files:** `frontend/src/modules/Piano/performance/assessmentAttempt.js` and
tests, with a narrow ExerciseRun integration test.

- Normalize MIDI with a positive modulo and compare expected versus held pitch
  classes when the policy is enabled.
- Accept doubled notes and any octave/voicing, while still rejecting a foreign
  pitch class unless `allowExtras` explicitly permits it.
- When `bassPitchClass` exists, require the lowest currently held MIDI pitch to
  match it; do not infer inversion from arrival order.
- Preserve exact held-matcher behavior byte-for-byte when policy is absent.
- Tests cover root-position C-major in multiple voicings, inversion acceptance
  and rejection, duplicate octaves, extra pitch class, and exact-mode control.

### 3. Pass the authored presentation through the session seam

**Files:** `AskSession.jsx`/tests, `ExerciseRun.jsx`/component tests.

- Compute the tuple once in `AskSession`, use its errors for refusal, and pass
  the accepted tuple as `askTuple` to the run.
- Make `ExerciseRun` derive its stage, copy, hints, and presentation only from
  `askTuple` when supplied; its tier-derived fallback serves direct legacy
  mounts unchanged.
- Add a `recall` stage with no target keyboard. Its status wording says the
  target is named above, rather than “Follow the highlighted notes.”
- Tests assert `AskSession` passes identity-stable tuple data, and recall has no
  target lights while existing follow/read paths remain unchanged.

### 4. Implement controlled hint reveal

**Files:** `ExerciseRun.jsx`, `KeysAsk.jsx` (only if it needs a reveal prop),
SCSS and focused tests.

- `always` reveals target notation/keys as soon as an attempt is ready;
  `after-stall` reveals after a named pre-timeout delay (for example 12 s) and
  before `FREE_STALL_MS`; `none` never reveals.
- The reveal timer starts only after a real free attempt starts, resets on each
  note-on exactly like the existing stall timer, and is absent for cued and
  practice runs unless explicitly asked.
- A recall hint may show the same answer surface a follow ask uses, but only
  after the policy transition. It must never make the target visible at mount.
- Fake-timer tests prove ordering: no hint before threshold, hint before timeout,
  note-on resets it, no change to normal timeout/persistence callbacks.

### 5. Render free engraved lines and one-note cards

**Files:** a new focused presentation component beside `ExerciseNotation`,
the event-to-notation adapter, `ExerciseRun.jsx`, SCSS, and tests.

- For `notationStyle: engraved` plus free timing, render note values/rests and
  clef/key from the resolved instance with live cursor/wrong/completion ink.
- Use a compact single-note staff card for one-event/one-note read asks; it has
  one notehead, no keyboard target, and remains readable at kiosk scale.
- Keep `ScorePassage` exclusively for `source: score`; ensure an engraved bank
  line does not request MusicXML from the score resolver.
- Add one Chromium measure scenario for each new visible cell: named recall
  chord, after-stall hint, free engraved scale, and single-note card.

### 6. Content, documentation, and verification

- Add no household YAML in this SP. Instead add fixture levels proving User_5’s
  C-major recall chord and User_3’s free engraved scale can be expressed by the
  schema without special code.
- Update the roadmap/handoff and piano reference documentation to distinguish
  the product name `PianoChallenge` from retained implementation names.
- Run the focused schema, engine, session, ExerciseRun, and MusicNotation
  suites; run both Chromium measure suites. Run the full gate once and report
  any changing cross-suite failures without baselining them.
- Do not build or deploy until the homeserver worktree is reconciled and clean.

## Exit evidence

SP2 is complete only when its four Chromium scenarios are green, all legacy
Piano/MusicNotation tests remain green, and fixture configuration expresses the
User_5/User_3 cases without a host-specific branch. A full repository gate is
reported separately because it currently has unstable unrelated failures.

## Implementation checkpoint — 2026-08-28

Implemented locally, not committed or deployed:

- `recall` and hint policies are accepted by the schema and carry through
  `AskSession` as a stable tuple.
- Named synthesized chords (`root` + `quality`) and pitch-class/bass held
  matching support the User_5 configuration shape.
- Recall is a no-lights stage; `always` reveals within that stage and
  `after-stall` reveals at 12 seconds, resets on a new note, and remains before
  the existing 20-second timeout.
- Exercise ABC notation preserves authored quarter/half/eighth values, and a
  one-note read ask takes the compact staff-card stage.

Evidence: focused SP2 suites passed; the complete Piano + MusicNotation sweep
passed (414 files / 5,111 tests); the existing Chromium ExerciseRun measure
suite passed (15 tests). Dedicated Chromium scenarios for each new visual cell
remain a follow-up before calling this subproject release-complete.
