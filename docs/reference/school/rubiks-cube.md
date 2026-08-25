# Rubik’s Cube Foundations

`rubiks-cube` is an assigned School program for the `beginner-v1` layer-by-layer course. It is intentionally a learner-course service, not a Group Play game: the shared cube engine owns legal turns while the School service owns one learner's progress, hints, quiz results, and launch authority.

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
