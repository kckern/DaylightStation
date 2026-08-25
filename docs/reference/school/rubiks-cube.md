# Rubik’s Cube Foundations

`rubiks-cube` is an assigned School program for the `beginner-v1` layer-by-layer course. It is intentionally a learner-course service, not a Group Play game: the shared cube engine owns legal turns while the School service owns one learner's progress, hints, quiz results, and launch authority.

## Code map

| Concern | Authority |
|---|---|
| Curriculum | `backend/src/3_applications/school/rubiksCube/course.yml` |
| Course state and packet persistence | `RubiksCubeCourseService.mjs` |
| Legal six-face physical-cube import | `physicalCube.mjs` |
| Shared turn/goal/diagram logic | `shared/gaming/rulesets/rubiks-cube/` |
| Bounded full-cube recovery adapter | `backend/src/1_adapters/school/rubiksCube/` |
| Learner API and program UI | `rubiksCube.mjs` router and `frontend/.../RubiksCubeProgram.jsx` |

The catalogue YAML is the reviewed source for unit order, learner-facing copy, demonstrations, staged goals, and strategy checks. `courseCatalog.mjs` only validates and hydrates it, derives deterministic fixed-practice states, and removes answers/recovery moves from learner responses.

## Current physical-cube process

The learner opens **My physical cube**, enters all six faces, and has the state checked before any guidance is shown. Input is rejected unless colour counts, cubie inventory, edge/corner orientation, and permutation parity describe a legal 3×3 state. A bounded recovery worker returns only moves that are independently replayed through the shared engine.

After a valid import, the learner may request a **paper plan**. The service freezes the entered facelets, target lesson/unit, generated move groups, and every group’s before/after cube state in the learner’s Rubik progress record. A later full-face entry verifies the packet’s declared goal. Generating another packet supersedes, but does not overwrite, the prior packet.

The temporary route generator is `RubiksPacketPlanner`. It is engine-verified, but it currently groups a general recovery solution. It must not be represented as the final beginner-method planner: the replacement must emit only the already-taught layer-by-layer routines and checkpoints.

## Intended paper and companion contract

Packets must be rendered through the normal `school.document-source/v1 → publish → issue → retained artifact → exact reprint` lifecycle, never a Rubik-specific PDF renderer. Cube SVGs use a colour letter plus only 5/10/15/20/25% grayscale fills—no hatching or texture.

A worksheet companion is **one issued opaque token with two entry paths**: the normal School action card carries its QR payload and, immediately below it, the same token’s six-digit panel alias. Scanning the QR or typing the digits must resolve the identical token and emit the identical `school.rubiks.packet-companion.open` event. A worksheet may not invent either value.

The shared token model currently permits panel aliases only for `subject_next`. Before printable Rubik packets are enabled, add a dedicated packet token class, shared scan/keypad resolution, daily alias rotation, and frozen artifact issuance. The original QR may remain usable for its token lifetime; a new day receives a new companion action card rather than mutating an already-issued PDF.

## Assignment and access

Use the normal assignment write with this program enrollment:

```yaml
programId: rubiks-cube
courseId: beginner-v1
```

The assigned launch issues a short-lived `X-School-Cube-Grant`, bound to learner, unit, course, and content revision. The Portal uses it for every saved action. `GET /api/v1/school/rubiks-cube/preview` is intentionally untracked and exposes only the first demonstration.

## Learning contract and migration state

The course has seven ordered units: cube language, white cross, white corners, middle layer, yellow face, last layer, and complete solves. The final design replaces fixed digital-scramble practice with one packet per hands-on unit: a foundation intake packet in Unit 1, then one personalised route to the current unit goal in Units 2–6, and two separately captured full solves in Unit 7. A quiz needs 80%; time is a personal best only and never blocks progression.

The server is authoritative for move revision, current cube state, completion, hint count, quiz scoring, physical imports, packet contents, and packet verification. The client may animate a submitted move, but it reconciles to the returned cube projection.

`beginner-v1` is now revision 3. This intentionally resets earlier saved course progress because the packet workflow changes what an activity means. The course is **not enrollment-ready for paper-first use** until the beginner-method planner and standard print/token integration described above are complete.
