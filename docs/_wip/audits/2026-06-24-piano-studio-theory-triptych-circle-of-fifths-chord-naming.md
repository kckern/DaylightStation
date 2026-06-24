# Studio top pane: configurable music-theory triptych (circle of fifths + chord naming)

- **Source:** voice feedback `piano/20260624191207_Q6HVNw` · route `/piano/studio` · reported 2026-06-24
- **Audio:** `media/audio/feedback/piano/20260624191207_Q6HVNw.webm`
- **Type:** feature
- **Area:** Piano · Studio Play top pane · music theory

## What the user said
> Have it centered by default, but I want the options — maybe this would be
> configurable — that I want kind of a triptych there. Maybe the staff in the middle,
> and then on the left have like a circle of fifths that shows what's being played.
> And on the right, maybe spell out the chord or name the chord — is it a D minor
> diminished or whatever — so some music theory can be included in that as well.

## Problem / opportunity
The Studio top pane currently shows only the grand staff. The user wants an optional,
**configurable triptych** that turns the top of Studio into a live music-theory
display while playing.

## Desired outcome
A configurable top-pane layout with three panels:
- **Left — Circle of fifths**: highlights the keys/notes currently being played
  (lights up the active pitch classes / inferred key region).
- **Middle — Staff**: the existing current-chord grand staff (default-only mode keeps
  just this, centered).
- **Right — Chord name**: spells/names the current chord (e.g. "D minor diminished"),
  i.e. live chord identification from the active notes.

Default is staff-only (centered); the triptych is an opt-in mode (configurable per
piano/user — ties into the per-user preferences store and/or `piano.yml`).

## Actionable tasks
- [ ] Build a Circle-of-Fifths component that highlights active pitch classes / key.
- [ ] Build a chord-identification + naming module from `activeNotes` (root, quality,
      inversion → display name).
- [ ] Compose the triptych layout (left/middle/right) in the modular top pane.
- [ ] Add a config/preference toggle (`staff` vs `triptych`); default `staff`.

## Acceptance criteria
- With the triptych enabled, playing a chord lights the circle of fifths, shows the
  staff, and names the chord live; default mode shows just the centered staff.

## Where to look
- Builds on the modular top pane:
  `docs/_wip/audits/2026-06-24-piano-studio-top-pane-modular-fixed-height.md`.
- `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`;
  `frontend/src/modules/Piano/components/CurrentChordStaff.jsx`;
  chord/key helpers in `frontend/src/modules/Piano/noteUtils.js` (extend for naming).
- Per-user preferences: `/api/v1/piano/users/:userId/preferences`
  (see [[reference_piano_multi_user]]).

## Context / evidence
N/A (feature request). Larger scope — good candidate for `/brainstorm` → spec.
