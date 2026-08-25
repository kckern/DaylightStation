# Rubik’s Cube Foundations

`rubiks-cube` is an assigned School program for the `beginner-v1` layer-by-layer course. It is intentionally a learner-course service, not a Group Play game: the shared cube engine owns legal turns while the School service owns one learner's progress, hints, quiz results, and launch authority.

## Authored course and physical companion

The course catalogue lives in `backend/src/3_applications/school/rubiksCube/course.yml`.  It is the reviewed, editable source for unit order, learner-facing copy, demonstrations, staged goals, and strategy checks.  `courseCatalog.mjs` only loads and validates that source, derives deterministic practice scrambles and their engine-checked recovery sequences, and removes answers/recovery moves from learner responses.

The learner can enter all six faces of a physical cube in the persistent **My physical cube** panel.  Input is rejected unless colour counts, cubie inventory, edge/corner orientation, and permutation parity describe a legal 3×3 state.  A bounded recovery worker then returns moves which are replayed through the local engine before the app shows them.  Reset/setup guidance is explicitly guidance; a physical-stage verification requires entering all six faces again and checking the authored stage predicate.

Rubik worksheets will be authored as `school.document-source/v1` sources and issued through the School print-document lifecycle.  Cube SVGs carry a colour letter plus a light grayscale cue (no hatching).  A worksheet companion action is **one issued opaque token with two entry paths**: the action card carries its QR payload and, immediately with it, the token's six-digit panel alias.  Scanning the QR or typing the digits resolves the identical token and emits the identical companion-open event.  A worksheet is not allowed to invent either value.  Until the dedicated worksheet-companion token class is added to that shared contract, the course must not present a worksheet as printable/enrollable.

## Assignment and access

Use the normal assignment write with this program enrollment:

```yaml
programId: rubiks-cube
courseId: beginner-v1
```

The assigned launch issues a short-lived `X-School-Cube-Grant`, bound to learner, unit, course, and content revision. The Portal uses it for every saved action. `GET /api/v1/school/rubiks-cube/preview` is intentionally untracked and exposes only the first demonstration.

## Learning contract

The course has seven ordered units: cube language, white cross, white corners, middle layer, yellow face, last layer, and complete solves. Each activity is a demo, solve lesson, challenge, or quiz. A quiz needs 80%; challenges record assisted completion when a hint was used but still unlock the next activity. Challenge completions retain a private personal-best time for that activity; time never blocks progression.

The server is authoritative for move revision, current cube state, completion, hint count, and quiz scoring. The client may animate a submitted move, but it must reconcile to the returned cube projection. A general-purpose arbitrary-scramble solver and custom sticker editor are deliberately outside `beginner-v1`; hints only apply to authored course states.
