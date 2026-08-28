# Media Lessons with Comprehension Checkpoints — Design

**Date:** 2026-08-27
**Status:** Implemented on `feature/media-lesson-checkpoints` (2026-08-27). Behaviour as built, plus the deployment ordering for the three data edits that are still outstanding, is documented at `docs/reference/school/media-lessons.md` — read that first; this file remains the record of the design reasoning, and a few of its decisions were resolved differently in code (dispatch stayed on the §8 `DispatchMedia` → playback-port path rather than routing through `DoNowService`; `OpenMediaLessonSession` landed as `ReadLessonSnapshot` over the existing work session). Not yet run on the living-room TV.
**Prior art this builds on:** reading sessions (`docs/reference/school/reading-sessions.md`), fitness governance (`GovernanceEngine` + `pauseArbiter`), the DoNow surface/launcher pipeline, `OpenCatalogLearningSession`.

## Goal

School courses can assign video or audio (hence *media* lesson, not video lesson)
to watch on the living-room TV — but never passively. Playback pauses at
authored checkpoints and asks comprehension questions: not "are you there?" but
"did you get that?". Playback resumes only on a correct answer. The gate is
**hard**: backend-owned per-learner state, surviving reloads, feeding grades and
completion.

## Decisions made during design

| # | Decision |
|---|----------|
| D1 | **Hard gate.** Backend tracks cleared checkpoints + furthest-watched position per learner. Completion requires all checkpoints cleared and playback reaching the end. |
| D2 | **Grading reuses `2_domains/school/grading.mjs` unchanged.** `gradeAnswer` is already policy-free; the retry policy lives in the session use case, exactly as `attempt.mjs` and OMR each impose their own sequence on the same grader. |
| D3 | **Retry until correct.** Wrong answers re-ask (choices reshuffled). One of the presented options is always **"rewind and rewatch"** — the escape from a question you can't answer is choosing remediation, so the kid self-selects rewatching instead of brute-forcing. |
| D4 | **Checkpoints are authored in course curriculum data** (unit YAML), referencing a media manifest (which carries the `plex:<ratingKey>` locator) and a question bank. Not content sidecars: graded assessment content belongs where bank validation, revs, and grades live. |
| D5 | **Entry is the standard dispatch pipeline**: card scan / Portal keypad code → launch → `DoNowService.dispatch` → `livingroom-tv` surface. Attribution is pinned server-side at session open, not carried loose in a WS envelope. |
| D6 | **Format-neutral naming**: `media-lesson`, `mediaCheckpoints.mjs`, `OpenMediaLessonSession`. Audio lessons gate identically; the quiz overlay renders over whatever the audio's ambient frame is. |
| D7 | **The gate layer is standardized NOW for N simultaneous governors** (not deferred to a third case) — see "Gate layer" below. |

## Where the code lives (the boundary question)

The question that started this: abstract school context further into
`screen-framework/`, or build deeper into `modules/School/`? Answer: **neither
layer absorbs the other's concerns.** The rule that held for reading sessions
holds here — contracts are strings (registry keys, WS topics, verdict shapes),
never cross-boundary imports.

| Layer | Change |
|---|---|
| `screen-framework/` | **One registry line**: `school-lesson` → School's widget, in `widgets/builtins.js`. Nothing else — overlay slot, ActionBus input, WS pipe already suffice. |
| `lib/Player/` | **Gains the standardized gate layer** (`lib/Player/gate/`) — generic, school-ignorant. No `contentFilter` changes: its header's isolation warning stands; gating is not a cue effect. |
| `modules/Surround/` | **Nothing structural.** School registers modules via the existing `registerSurroundModule()`. |
| `modules/School/` | Owns everything semantic: lesson widget, checkpoint quiz overlay (reusing `QuizRunner` item components), session hook, API calls, surround modules. |
| `modules/Fitness/` | Migrates its `resolvePause` import to the promoted arbiter (one line); adopting `useMediaGate` for its element loop is a later, separate task. |

## Gate layer (`lib/Player/gate/`)

Fitness already has the right shape informally — authority (`GovernanceEngine`)
/ arbitration (`pauseArbiter`) / enforcement (`FitnessPlayer`'s element loop).
This design promotes and formalizes it. **There is no `ContentGovernor` base
class** — house style is duck-typed contracts (see `IProgramLauncher`), and the
two governors share no internals. The verdict IS the abstraction:

```js
/**
 * @typedef {object} GateVerdict
 * @property {boolean} blocked          playback may not proceed
 * @property {string}  id               stable governor id for logs ('checkpoint', 'governance', …)
 * @property {number|null} seekCeiling  furthest seekable position (s); null = unclamped
 */

/**
 * @typedef {object} PauseDecision
 * @property {boolean} blocked          STANDING: some gate says no, right now
 * @property {boolean} paused           ACT NOW: apply pause to the element
 * @property {string}  reason           a PAUSE_REASON enum value (why `paused` is what it is)
 * @property {string|null} gate         the blocking gate's `id`, whenever one is blocking
 * @property {number|null} seekCeiling  composed min ceiling
 */
```

**`blocked` and `paused` are deliberately separate**, and the distinction is the
whole reason the seeking rule is safe. While the element is mid-seek, pause is
suppressed (`paused: false`) so gate events cannot thrash the player — but a
checkpoint is still blocking, so `blocked` stays true and `gate` still names it.
Collapsing the two would make "no opinion right now" indistinguishable from
"released", and an enforcement layer reading only `paused` would call `play()`
mid-seek on a gated lesson. Enforcement acts on `paused`; anything asking "may
this proceed at all" reads `blocked`.

`GateVerdict.id` is NOT called `reason`: the decision object already has a
`reason` (the `PAUSE_REASON` enum), and one module carrying two different
meanings for that word — with a third field, `gate`, holding the first one — is
how a future governor writes the wrong field.

### `pauseArbiter` — promoted and N-ary

Moves from `modules/Player/utils/pauseArbiter.js` to
`lib/Player/gate/pauseArbiter.js` (framework-free pure logic belongs in
`lib/Player`, beside `useMediaClock`).

```js
resolvePause({ seeking, gates = [], resilience, user })
```

- `seeking` / `resilience` / `user` stay **fixed slots** — they are the
  player's intrinsic states, not policy, and never become governors.
- Priority unchanged: seeking suppresses everything (the anti-thrash rule),
  then any blocked gate, then buffering, then user.
- `blocked` composes as OR across `gates`. The naming gate is the **first
  blocked gate in array order** — array order is priority, caller-declared,
  no priority numbers. `blocked` and `gate` are populated on EVERY branch,
  including the seeking branch (see the `PauseDecision` note above).
- `seekCeiling` composes as **min of non-null ceilings**, and applies even
  while unblocked — a ceiling is a standing rule, not a pause side-effect.
- `PAUSE_REASON.GOVERNANCE` retires; `FitnessPlayer` (sole consumer) migrates
  in the same change, passing `{ blocked, id: 'governance' }` so its telemetry
  keeps a stable gate id.
- **There is no legacy `governance` slot.** An alias was built during Task 1 as
  migration insurance and then removed once `FitnessPlayer` was migrated in the
  same change: it had zero production callers, and its only consumer was a test
  written to exercise it. One way to say a thing (the DRY call, applied here
  too).

### `GateVerdictContext` — cross-tree contribution

A governor that does not own the media element (foreseeable: a screen-level
household gate — screen-time budget, lockdown) contributes via a small context
in `lib/Player/gate/`: ancestors provide verdicts, the element owner merges
`[...contributed, ...local]`. Contributed (outer) verdicts rank first, so a
household-level reason outranks a lesson-level one when both block. Governor #3
is a provider away; no arbiter surgery.

### `mediaGate.js` + `useMediaGate.js` — enforcement

Extracted in the `useMediaClock` style (framework-free core, thin hook).
Input: `getMediaEl` + merged verdict array. It applies the `resolvePause`
outcome to the element, snaps seeks past the effective ceiling, and logs
transitions (`gate.blocked`, `gate.released`, `gate.seek-clamped`) with the
winning gate id.

### Authorities stay domain-owned

`GovernanceEngine` (fitness) and the new `useCheckpointGate` (school) produce
only verdicts. Neither touches a video element. School's authority watches
`useMediaClock`; when the playhead crosses an unanswered checkpoint its verdict
flips `blocked`, with `seekCeiling` = furthest unanswered checkpoint.

## Backend

### Curriculum schema (domain, pure)

A gated-media unit composes existing reference kinds plus one new block:

```yaml
media: astronomy-e03          # manifest id → locator plex:123456 (locators are not identities)
bank: astronomy-3             # questions are a normal bank
checkpoints:
  - at: 312                   # seconds, strictly ascending
    items: [ast3-q4, ast3-q7] # must exist in the bank
  - at: 741
    items: [ast3-q9]
```

Validation lands in `unitValidation.mjs` beside the other reference checks:
`checkpoints` requires `media` + `bank`; `at` strictly ascending; every item id
resolves against the bank at publish time (the house rule: dangling references
die at publish, never on a child at the screen).

New pure module `2_domains/school/mediaCheckpoints.mjs` (styled like
`storyTime.mjs`) owns the math: `dueCheckpoint(position, checkpoints, cleared)`,
`seekCeilingFor(...)`, checkpoint-block validation. No clock, no I/O.

### Session (application)

`OpenMediaLessonSession` mirrors `OpenCatalogLearningSession`: the client
supplies only an address; the server re-resolves unit → manifest → locator,
opens a grading session pinned to the learner (forgery-proof attribution), and
returns `{ sessionId, contentId, checkpoints-without-answers, resumePosition }`.

- Answers flow through the existing grader under a retry-allowed policy; a
  checkpoint clears when all its items are answered correctly.
- The screen POSTs position heartbeats (periodic + on pause/gate events).
- Completion = all checkpoints cleared + playback reached the end → existing
  `completion.mjs` machinery.

### State split (reading-session doctrine)

- **Session** — who is watching, live position: in-memory, per location, dies
  with a restart (correct: nobody is watching after a restart). Idle sweep per
  the reading-session D6 pattern; the playing state is exempt.
- **Evidence** — cleared checkpoints, furthest-watched, attempts: durable
  per-learner store. A reload — or tomorrow — resumes with the gate intact.

## Dispatch and mount

1. The unit appears on the agenda normally. Card scan / keypad code resolves it
   (`ResolveScanAction` / `RunSelfServiceAction`).
2. Launch calls `OpenMediaLessonSession` → `sessionId`, then
   `DoNowService.dispatch({ surface: 'livingroom-tv', action: { kind: 'media-lesson', sessionId }, learnerId, … })`
   — occupancy and the approval ladder apply for free.
3. `LivingroomTvSurface` grows a second action kind beside raw `query`: for
   `media-lesson` it runs the same wake stack, then broadcasts
   `lesson.open { sessionId, learnerId }` on `lesson:livingroom` (per-room
   topic, mirroring `reading:livingroom`).
4. `living-room.yml` gains `widget: school-lesson, props: { location: livingroom }`.
   The widget renders nothing until `lesson.open` arrives; on open it fetches
   the session (`GET /api/v1/school/lesson/:sessionId`) and mounts `Player`
   through `useScreenOverlay()` — the same slot casts and reading-session books
   use — wiring `useMediaClock` → `useCheckpointGate` → `useMediaGate` around
   it, with `onMediaRef` for the element.

Ordering note: session open precedes dispatch; an undispatched session simply
idles out via the sweep — no session leak on a TV that would not wake.

## Input

The quiz overlay consumes the same input the menus do: `useScreenAction`
subscriptions for `navigate` / `select` / `escape`, which the TV remote and
gamepad adapters both already emit (plus synthetic keydown). `QuizRunner` item
components are touch-first, so the overlay wraps them in a focus-ring layer:
d-pad moves focus, A/OK selects, "rewind and rewatch" is just another focusable
option. Escape does nothing at a live question (it is a gate); it exits only at
a failure notice.

## Chrome (Surround)

School registers two modules via `registerSurroundModule()`, living in
`modules/School/lesson/`:

- **`checkpoint-map`** — segment bar with checkpoint nodes
  (cleared / current / locked), driven by the standard 10Hz sampled clock.
  `segment-map`'s shape, different data.
- **`lesson-score`** — placard: learner avatar + name (attribution made
  visible), items correct, attempts.

The surround definition comes from the session (the widget hands `SurroundHost`
an inline definition) rather than per-item sidecar resolution. The existing
surround rule stands: the frame can never be the reason nothing plays — if
chrome fails, the lesson still plays gated. Chrome is optional; the gate is not.

## Checkpoint moment, in sequence

1. ~5s out: the checkpoint-map node pulses — no surprise stops.
2. At `t`: gate blocks (arbiter) → Player pauses → quiz overlay mounts.
3. Wrong answer: gentle retry, options reshuffled; "rewind & rewatch" releases
   the gate, seeks to the previous checkpoint, re-arms.
4. Correct: brief ✓ beat → gate releases → playback resumes itself. Score
   module ticks.
5. Logged throughout: `lesson.checkpoint.hit / answered / rewind`.

## Error handling ("honest state, never stranded")

- **Answer POST fails:** gate stays blocked (a hard gate can't take the
  client's word). "That didn't send — try again" (the `RetakeAsk` pattern).
  A kid is never stranded: escape at the *notice* exits the lesson cleanly;
  evidence already recorded stays recorded. Failure mode is "lesson
  interrupted," never "TV wedged."
- **Reload / crash:** durable store resumes at furthest-watched with cleared
  checkpoints intact. The in-memory session dying is correct.
- **Unreadable progress store:** `error: true`, never zero (the StoryTime
  rule). A false "nothing cleared" would re-gate answered questions; the
  agenda shows the unit unavailable instead.
- **Dispatch fails / TV won't wake:** DoNow answers `dispatched: false` → the
  launch card refuses with the room named; the orphan session idles out.
- **Media itself won't play:** the gate must never be *why* — exit with a
  notice, progress preserved.
- **Seek past ceiling:** clamped, logged, no drama.

## Testing

| Layer | Approach |
|---|---|
| `mediaCheckpoints.mjs` | Pure vitest, run directly (the `--only=domain` Jest-routing trap). |
| Arbiter N-gate composition | Extends `pauseArbiter`'s existing suite; fitness's suite guards the one-line migration. |
| `mediaGate` core | Framework-free tests, `mediaClock` style. |
| Lesson widget | RTL, delivering `lesson.open` over mocked WS exactly as `ReadingSessionScreen.test.jsx` does. |
| Routers / use cases | Isolated tests mirroring `reading.test.mjs`. |
| Flow | Playwright with `?goto=` (the review-seek primitive) landing seconds before a checkpoint; assert pause, overlay, clamped seek. |

No conditional assertion-skipping anywhere (test discipline: skipping is not
passing).

## Explicitly out of scope

- FitnessPlayer adopting `useMediaGate` for its element loop (later task; it
  only migrates the `resolvePause` import now).
- Menu-browsed (non-dispatched) lesson entry from the TV itself.
- Any `contentFilter` changes.
- Per-checkpoint policy variations beyond retry-until-correct (the schema
  leaves room; nothing is built).
