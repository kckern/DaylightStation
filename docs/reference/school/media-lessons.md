# Media lessons with comprehension checkpoints

> **Status:** built on `feature/media-lesson-checkpoints`, 2026-08-27. Not yet run
> on the living-room TV, and **not yet reachable in production even once the code
> deploys** — three data edits have to be applied by hand, in the order §10
> describes. Design: `docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md`
> (the authority on *why the shape is this shape*); this document is the authority
> on *behaviour* and on the contracts other code has to keep.

A course can assign a video or an audio lesson that plays on the living-room TV
and **stops at authored positions to ask comprehension questions** — not "are you
still there?" but "did you get that?". A wrong answer re-asks; one of the offered
options is always *watch it again*, so a child who cannot answer self-selects
remediation rather than brute-forcing four choices.

The gate is **hard**. The stop happens in the browser, but the guarantee does not
live there: cleared checkpoints are backend evidence, and the completion that
releases a linked quiz is refused while any checkpoint is outstanding. Seeking
past a stop, reloading the kiosk, or editing what the client was handed buys
nothing.

---

## 1. How a lesson runs, end to end

| # | Step | Where |
|---|---|---|
| 1 | A unit with `media` + `bank` + `checkpoints` appears on the agenda like any other. | curriculum |
| 2 | A child scans their personal card, or types the agenda's six-digit code into the school-room Portal. | `ResolveScanAction` / `RunSelfServiceAction` |
| 3 | Either path calls **`DispatchMedia`** with the session id (and, from the panel, the card's own `selfService.mediaSurface` as `target`; the scan path passes none and takes the single child-selectable target). | `usecases/DispatchMedia.mjs` |
| 4 | `DispatchMedia` re-resolves the unit, records `media_dispatched`, and calls the playback port. | |
| 5 | **`ScreenPlaybackAdapter`** wakes the room's screen, waits (briefly) for a live subscriber, then broadcasts `{ type: 'lesson.open', sessionId, learnerId }` on `lesson:{location}` — plus the port's own `dispatched` frame on `school-playback`. | `1_adapters/hardware/playback/ScreenPlaybackAdapter.mjs` |
| 6 | The already-mounted `school-lesson` widget hears it and fetches its snapshot: `GET /api/v1/school/lesson/:sessionId`. | `MediaLessonScreen.jsx` / `useMediaLessonSession.js` |
| 7 | It paints a curtain (the child's face, their name, the lesson title), then mounts `Player` in the screen's overlay slot. | |
| 8 | The playhead crosses an uncleared checkpoint → the gate blocks → the element pauses → the question card mounts. | `useCheckpointGate` → `useMediaGate` → `CheckpointQuizOverlay` |
| 9 | Each answer is graded **server-side**; when every item at that checkpoint is right, a `checkpoint_cleared` event is appended and the gate releases after a short ✓ beat. | `RecordCheckpointAnswer` |
| 10 | Player's semantic natural-end callback posts `/ended` before queue advance or cleanup. Only then is the lesson complete, and only then does a linked quiz or form release. | `RecordMediaCompletion` |

**There is no separate "lesson session."** `sessionId` throughout is the unit's
ordinary work session — the one a scan or an issued worksheet already opened — and
the lesson is a stretch of its event log (`media_dispatched` → `checkpoint_cleared`
annotations → `media_completed`). That is why attribution needs no client help: the
session's own `created` event names the learner. The design sketched a dedicated
`OpenMediaLessonSession`; what shipped reads the existing session instead
(`ReadLessonSnapshot`).

**It does not route through `DoNowService`.** The design proposed dispatching a
lesson the way a `launch:`/`program:` block is dispatched, to inherit DoNow's
occupancy and approval ladder for free. The build kept the existing §8 media leg
instead: `DispatchMedia` → the playback port → `ScreenPlaybackAdapter`. So the only
permission mechanism on a lesson is `child_selectable` on the target (§10.2), and
nothing checks whether the living room is already busy.

Three things about that pipeline are easy to get wrong:

**Waking is not loading.** The adapter wakes the screen the way story time does —
power on, bring the kiosk forward, nothing else. The obvious alternative,
`WakeAndLoadService`, ends in a content load, and on this Shield a content load is
an unconditional FKB `loadURL`. That drops the very WebSocket `lesson.open` has to
arrive on, so the room would be reloading at the exact moment it was told, on every
dispatch. The reading path had already learned this and says so in its own wiring.

**A screen that is not coming on is never told.** Wake failure (or an empty room
after the listener wait) throws, and *nothing* is broadcast. `DispatchMedia` then
files a non-advancing `failed` event and tells the child to scan again, leaving the
session `created` so the retry really re-dispatches. Broadcasting anyway would
record `media_dispatched` against a dark TV, and the idempotency rule would answer
every retry for the rest of the day with "It is already playing. Enjoy!".

**Re-scanning mid-lesson does not restart the video.** `media_dispatched` is not a
dispatchable state; the second scan answers `already_playing` — and still returns
the checkpoint positions, because that is the reloaded-screen case and a gate the
screen cannot see is a gate it cannot stop at.

---

## 2. The gate layer — shared with fitness

`frontend/src/lib/Player/gate/` is generic and school-ignorant. Fitness's
`GovernanceEngine` and school's `useCheckpointGate` are both *authorities*: they
produce verdicts and never touch a media element. One arbiter composes N verdicts
into one decision; one enforcer makes a real element obey it.

```js
GateVerdict  = { blocked, id, seekCeiling }          // what a governor says
PauseDecision = { blocked, paused, reason, gate, seekCeiling }  // what the arbiter decides
```

There is deliberately **no base class**. House style is duck-typed contracts, and
the two governors share no internals — the verdict *is* the abstraction.

### `blocked` and `paused` are two different questions

- **`blocked`** — a standing fact: some gate refuses, right now, whatever the
  player happens to be doing.
- **`paused`** — an instruction for this tick: put the transport down.

They diverge during a seek. Seeking suppresses the pause *action* (the anti-thrash
rule fitness paid for first), so mid-seek `paused` is false while `blocked` stays
true and `gate` still names the blocker. Collapse them and "no opinion right now"
becomes indistinguishable from "released": an enforcement layer reading only
`paused` would call `play()` in the middle of a seek on a gated lesson and re-pause
on seek end, reintroducing the exact thrash the rule exists to prevent.

**Enforcement acts on `paused`. Anything asking "may this proceed at all" — seek
clamps, overlays, reporting — reads `blocked`.** For the same reason `mediaGate`
conditions its resume on `!blocked && !paused`, not on `paused === false`.

Two composition rules follow:

- `blocked` is an OR across gates, and the **first blocking gate in array order**
  names the decision. Array order is priority, declared by the caller — no
  priority numbers. Verdicts contributed from *outside* the player subtree
  (`GateVerdictProvider`) come first, so a household-level lock outranks a
  checkpoint: telling a child to answer a question that will not release the video
  is worse than telling them the TV is locked.
- `seekCeiling` is the **min of the non-null ceilings, and it applies even while
  nothing is blocking**. A ceiling is a standing rule, not a side-effect of a
  pause — otherwise a child could scrub past an unanswered checkpoint the instant
  playback resumed.

`GateVerdict.id` is not called `reason` because `PauseDecision` already has a
`reason` (the `PAUSE_REASON` enum) and a third field, `gate`, holds the id. One
module carrying two meanings for one word is how the next governor writes the wrong
field. The id values live in `gate/gateIds.js` (`GATE_ID.GOVERNANCE`,
`GATE_ID.CHECKPOINT`) — they are the strings already in the log store, so changing
one breaks every saved query.

### The twin arithmetic

`useCheckpointGate.js` (frontend) hand-copies `dueCheckpoint` and `seekCeilingFor`
from `2_domains/school/mediaCheckpoints.mjs` (backend), because a frontend module
cannot import a backend domain module — the same arrangement `SUBJECT_IDS` already
has. **The two must change together.** The backend is the authority; the copy is
what makes the stop happen in front of the child. Three details are copied verbatim
and matter:

1. `at <= position` is **inclusive** — a playhead reporting 312.0 has played the
   second before it, so a checkpoint at 312 has fired.
2. **First** uncleared, not nearest — a child who seeks to the end still owes every
   checkpoint on the way, in order, one at a time.
3. Ids are `cp-<at>`.

---

## 3. Authoring a gated unit

`checkpoints:` is not a composition kind of its own. It **modifies** a media+bank
pair and is meaningless without both: the media is what pauses, the bank is where
the questions live.

```yaml
# a unit in the authored curriculum
media: astronomy-e03        # manifest id → a locator such as plex:123456
bank: astronomy-3           # a normal question bank
checkpoints:
  - at: 312                 # whole seconds, strictly ascending, >= 1
    items: [ast3-q4, ast3-q7]
  - at: 741
    items: [ast3-q9]
```

Everything below is enforced at publish time by `unitValidation.mjs` +
`mediaCheckpoints.validateCheckpoints`, because the house rule is that dangling
references die at publish, never on a child at the screen.

| Rule | Why |
|---|---|
| `checkpoints` requires `media` **and** `bank` | Two separate field-named errors, so an author who forgot both is told both in one pass. |
| `at` must be an **integer ≥ 1** | See below. `0` would fire before a frame had played. |
| Strictly ascending | The gate walks the list in order and stops at the first uncleared entry; an out-of-order block leaves later checkpoints permanently unreachable. Both indexes are named in the error. |
| `items` non-empty, and every id resolves in the unit's bank | Existence is checked at the one boundary that can inject the bank's item ids; a pure domain function has no repository to reach for. With no bank corpus injected it degrades to a shape check, which is the accurate answer — an absent corpus is not evidence that every item is missing. |
| At most `MAX_CHECKPOINTS` (**20**) | Twenty on a 45-minute lesson is already a stop every two minutes; past that the lesson is mostly interrogation. Four hundred on a twenty-minute video is a mistake no learner can work around, and refusing it at publish is far cheaper than a child in front of an unwatchable lesson with no error anywhere. |

### Why `at` must be a whole second

**The checkpoint's id is spelled from its position: `cp-<at>`.** No counter, no
uuid, no index — because a learner's cleared checkpoints are stored durably *by
id*, and an id that moved when the block was re-parsed would un-clear work the
child had already done. (Insert one earlier checkpoint into an index-keyed list and
every later gate re-fires.) Deriving from `at` means the id changes only when the
position itself changes, which is the one case where re-asking is correct.

That is exactly why fractions are refused. YAML hands back `312.5` and `312.50` as
the same number, but they are different *strings* to anything that kept the id
verbatim: the same instant under two ids, and a child's cleared row stops matching with nothing to say so. Whole seconds keep `cp-<at>` unambiguous and human-checkable, and
sub-second precision is not something an author can aim at anyway.

---

## 4. Known limitation: `matching` items cannot be used here

A `matching` item's `pairs` are simultaneously the question (the left column) and
the answer key (which right goes with which left). There is no projection that both
renders it and withholds the key, so `ReadLessonSnapshot` ships the **lefts only**,
and `MatchingItem` — which builds its right-hand chips from `p.right` — cannot
present a usable question. It falls to the overlay's explicit fault card, whose only
control is *watch it again*, and logs `school.lesson.checkpoint.unrenderable`.

That is the correct trade for this surface: a matching item is not answerable from
a d-pad in the first place (the living room has no pointer), so authoring one onto
a TV checkpoint is a curriculum mistake, and it must fail visibly rather than by
handing the answers to the room.

**The durable fix is a publish-time validation rule forbidding `matching` inside a
`checkpoints:` block. It is NOT implemented.** Today the only feedback is the fault
card at the moment a child hits the gate.

The same fail-closed shape covers new item types: a type with no entry in
`PUBLIC_ITEM` is not shipped at all, degrading to a bare id and the same fault card.
A new item type cannot leak before somebody has decided what of it is public.
Short-answer and cloze items *are* projected, but want a keyboard the living room
does not have — the overlay focuses the rewind control for them and logs
`school.lesson.checkpoint.no-dpad-input`, again because that is a curriculum bug
the screen cannot fix.

---

## 5. Routes, and why the status codes are what they are

Mounted at `/api/v1/school/lesson` (`4_api/v1/routers/mediaLesson.mjs`). Four
routes, one caller: the `school-lesson` widget, through `schoolApi`.

| Route | Purpose |
|---|---|
| `GET /:sessionId` | The snapshot the widget opens on. |
| `POST /:sessionId/answer` | Grade one question at a checkpoint. |
| `POST /:sessionId/position` | Playhead heartbeat (~15 s while playing, plus one at every gate). |
| `POST /:sessionId/ended` | The media finished — claim the lesson. |

**Nothing here gates the caller.** A child at the TV has no code to type and no
grown-up to fetch. The gate this router serves is the comprehension gate, and it
lives entirely in the two use cases: an answer is graded server-side against the
bank, and a completion is refused while a checkpoint is outstanding no matter what
the body says.

**Attribution is the path's, never the body's.** The session already names its
learner on its own `created` event, so `sessionId` in the URL is the only identity
the router passes on. A body naming a different session or learner is ignored —
which is what makes a lesson's grades unforgeable from the room they are earned in.

### The mapping

```
answer:  graded 200 · already_cleared 200 · invalid_answer 400 · unknown_checkpoint 404
         unknown_item 404 · not_playing 409 · not_gated 409 · unknown_session 410 · ungradable 422

ended:   completed 200 · already_completed 200 · not_playing 409
         checkpoints_outstanding 409 · unknown_session 410 · uncorrelated 410

snapshot: ok 200 · unknown_session 410
```

Every status is mapped by hand, and **a status this router has never heard of
throws** (→ 500) rather than falling through to 200.

- **Why a refusal is 409, not 200.** `schoolLifecycle.mjs`'s `STATUS_BY_OUTCOME`
  defaults the unlisted to 200, so a completion refused for outstanding checkpoints
  once answered `200 {released: false}`. A client reading only the status code takes
  that for a finished lesson — and that client is a TV in front of a child who did
  not answer the questions. Adding a status to a use case must break this router
  loudly rather than granting it by default.
- **Why `unknown_session` is 410, not 404.** 410 is the code the frontend is built
  around: `schoolApi` passes it through untouched, and `useMediaLessonSession`'s
  `endBecauseGone` drops the gate and ends the lesson on it. If the server no
  longer has this lesson, no answer can ever clear the checkpoint the child is
  sitting in front of, so leaving the gate up would leave a paused picture that
  nothing can release — the frozen TV this feature exists to avoid. `uncorrelated`
  from the completion is folded into the same 410: with a `sessionId` in hand it
  means exactly the same thing.
- **Two 200s that look like errors and are not.** `already_cleared` on an answer
  (the checkpoint *is* cleared; the screen is resending a reply it never saw, and an
  error would strand a child in front of a question they already got right) and
  `already_completed` on `/ended` (the screen retrying its own POST; an error would
  put "I couldn't save that lesson" over a lesson that is saved). Note the second
  differs from `schoolLifecycle.mjs`, where `already_completed` *is* a 409 — there
  it is a duplicate scan worth flagging.

### What the snapshot carries, and what it withholds

`{ sessionId, learner: {id, name}, contentId, title, checkpoints, cleared,
resumePosition, seekCeiling, state, playing }`.

- `checkpoints` is `{id, at, items}` with items as **public bodies**
  (`{id, type, prompt, choices}`). Prompts and choices are not answers — a choice
  list is the question — and they are already served whole to browsers by
  `GET /api/v1/school/banks/:bankId`. What is withheld is `answer`, `accept`,
  `expected`, and the right half of a `matching` item's `pairs`. Every projector
  *builds* an object from named keys rather than spreading the authored item, so a
  field added later stays behind by default instead of leaking on the day it is
  authored.
- **One call, on purpose.** Fetching each question as its gate fires would put a
  request in the *blocking* path: the picture is already stopped, so a failure there
  leaves a child in front of a frozen frame with no question and no way forward.
  Everything needed to run the whole lesson arrives before the first frame, and a
  kiosk that reloads mid-lesson recovers in one round trip.
- `cleared` is a list of **bare ids**, not the reducer's `{checkpointId, attempts,
  at}` rows: the screen appends locally when an answer clears a gate, and a
  row-shaped element would make the list heterogeneous the moment the first
  checkpoint cleared.
- `resumePosition` is **derived, not remembered** — the authored `at` of the
  furthest cleared checkpoint, or `null`. There is no durable playhead in this
  feature by an explicit domain decision, so the only defensible resume point is the furthest
  position we can *prove* the child reached. A reload replays the stretch between
  the last cleared gate and where they actually were; it re-asks nothing.
- The snapshot **refuses exactly one thing**: an unknown session. A stalled lesson,
  a completed one, a unit whose checkpoints were edited away — all answer, with
  `playing` saying which. A snapshot that refused would leave the widget with
  nothing to render.

`DispatchMedia` returns a checkpoint list too, but only `{id, at}` — ids and
positions, never the items, because that payload travels to a browser a child is
sitting in front of. It is **advisory**: `RecordMediaCompletion` re-reads the unit
and refuses, so a client that ignores, loses or edits it gains nothing.

---

## 6. What is durable, and what is allowed to be forgotten

| State | Where | Survives a restart? |
|---|---|---|
| Cleared checkpoints (`checkpointId`, `attempts`) | `checkpoint_cleared` events on the work session | **Yes** |
| Which items of a *half-answered* checkpoint are right | in memory, in `RecordCheckpointAnswer` | No — the checkpoint is re-asked from the top |
| The playhead | nowhere | No — resume is derived from the furthest cleared checkpoint |

`checkpoint_cleared` is an **annotation**, not a transition: it is accepted from
`media_dispatched` *and* `media_stalled`, and the reducer is first-write-wins per
`checkpointId`. Legality is asked of `transitionViolation`, never of
`statesAccepting` — annotations are absent from the transition table by
construction, so `statesAccepting('checkpoint_cleared')` answers with the empty set
and gating on it would refuse every clear the use case could make.

**Retry until correct.** A wrong answer costs nothing durable and leaves the item
answerable. That is this use case's policy, not the grader's: `2_domains/school/
grading.mjs` stays policy-free, and the panel path (one shot) and the OMR path (mark
once, a grown-up may override) sequence the same grader differently. Retrying is
what makes *watch it again* work — self-selecting remediation only beats guessing if
guessing is never terminal.

Partial progress is held in memory deliberately, and the two alternatives were both
worse: taking the client's word for which questions it already got right would clear
a three-question gate with one answer (the exact skip this feature prevents), and
writing a `checkpoint_cleared` per item would open the gate on the first one, since
the event is keyed by checkpoint and first-write-wins. The accepted cost is that a
restart, or a checkpoint left half-answered for more than eight hours, re-asks that
checkpoint's questions from the top. It never clears anything early.

**A wrong answer appends nothing.** The durable trace of a struggle is the inflated
`attempts` on the eventual clear (`attempts - items.length` is the number of wrong
answers it cost). The per-answer detail goes to the log store as
`school.checkpoint.wrong`, which is where "what stumped them tonight?" is answerable.

### Stalling

A gated lesson takes longer than its own running time *by design*, so measuring it
against `duration + grace` writes off healthy lessons. The stall window is widened
by **`CHECKPOINT_GRACE_SEC` = 180 s per authored checkpoint** on top of the default
600 s grace. `media_stalled` still cannot complete — there is no
`media_stalled → media_completed` edge in the transition table — which is why the
problem is fixed where it is caused rather than by loosening the completion.

---

## 7. Chrome, escape, and the two halves of the widget

`MediaLessonScreen` sits in the screen's layout; `LessonStage` sits in the overlay
slot above it. They are two components because the overlay is rendered as a
*sibling* of the widget's children, so no context can reach it and its props are
frozen at `showOverlay` time. Live state crosses through a tiny external store
instead — one `showOverlay` call per session — which also keeps the 10 Hz clock's
re-renders inside the overlay subtree.

The chain, in order: `useMediaClockState` → `notePosition` (a ref write, no render)
→ `useCheckpointGate` (authority) → `noteCheckpointDue` (the view machine) →
`useMediaGate` (enforcement, one per element) → `CheckpointQuizOverlay`.

`player.seeking` is deliberately **not** passed to `useMediaGate`: `seeking.active`
suspends all enforcement, and a slot stuck true is indistinguishable from having no
gate — the easiest hole to open in a checkpoint.

**Escape.** `ActionBus.emit` broadcasts, and the living-room screen's own
`actions.escape` dismisses the mounted overlay — which is the Player. So without
something in between, pressing back at a live question tears the lesson down. The
widget claims the framework's `registerEscapeInterceptor` for exactly the window a
checkpoint is up and gives it back when the ✓ beat ends. Escape at a live question
does nothing but print a line saying what *will* work; it exits only at a failure
notice.

**Surround chrome** — `checkpoint-map` (segment bar with cleared / current / locked
nodes, pulsing ~5 s before a stop) and `lesson-score` (avatar, name, items correct,
attempts) — is registered by School into the Surround registry, one-way, and mounted
via `SurroundFrame` directly with an inline definition, because a lesson's chrome
comes from its session and `SurroundHost` only polls for content sidecars. It is
**video only**: all three of the frame's rules are geometry of a video box, so an
audio lesson mounts the frame inactive (`display: contents`) and logs
`school.lesson.surround.suppressed`. An audio lesson loses the map and the placard
and keeps the gate, the question card and the ✓ — the parts that make it hard-gated.
The standing rule holds: **the frame can never be the reason nothing plays.**

Two more asymmetries worth knowing:

- **`clearedIds` grows in exactly one place** — a `lessonAnswer` reply that says
  `checkpointCleared`. Not on a failed POST, not on a rewind, not on a timeout.
  Everything that looks like an escape hatch *ends* the lesson instead of releasing
  the checkpoint.
- **If the Player calls `clear` while a checkpoint is up, the Player wins and the
  lesson ends.** Holding a pause on an element that is going away would mean a
  question card over a dead surface. Nothing is skipped: the checkpoint stays
  uncleared server-side, `/ended` is never posted, and the child resumes at that
  same question. The gate loses the argument and keeps the guarantee.

---

## 8. Operations

### Topics

| Topic | Carries |
|---|---|
| `lesson:{location}` (e.g. `lesson:livingroom`) | `{ type: 'lesson.open', sessionId, learnerId }` — one topic per room, mirroring `reading:{location}`. |
| `school-playback` | The playback port's own frames: `dispatched`, and the widget's `progress` heartbeat (`{source: 'lesson-screen', seconds, percent: null, sessionId}`). |

The heartbeat is **observability only**. It refreshes no liveness (there is no such
mechanism — the stall deadline is computed from the dispatch event plus duration
plus grace, and reads no liveness state), and nothing subscribes to `school-playback`
yet. It also can never fail at the screen: an absent or unusable position answers
`{ok: true, reported: false}`, and a throwing bus is swallowed, because a heartbeat
that 500s would log an error every fifteen seconds for a lesson that is going fine.

**One inconsistency is unresolved.** The lesson adapter broadcasts under `type:`,
while the reading-session broadcaster uses `event:`. `useMediaLessonSession` reads
`payload.event ?? payload.type` and therefore accepts both. That tolerance is a
safety net, not a decision — a screen that ignored the wrong spelling would show a
black TV with nothing in any log to explain it. Picking one spelling and making both
producers use it is still open.

### Log events worth grepping

All backend events carry `context.app: school`; the frontend lesson modules log
under `app: school`, the gate layer under `app: player`.

| Event | Says |
|---|---|
| `school.media.dispatched` / `school.media.dispatch-failed` | The lesson was handed to a screen, or the wake failed. |
| `school.lesson.session.open` / `.replaced` / `.gone` / `.fetch-failed` | The widget's own lifecycle; `.replaced` is last-dispatch-wins. |
| `school.lesson.checkpoint.hit` / `.answered` / `.rewind` | The checkpoint moment, in sequence. |
| `school.checkpoint.cleared` / `school.checkpoint.wrong` | The server's view — the durable clear, and every wrong answer. |
| `school.lesson.checkpoint.unrenderable` | A question this surface cannot present (see §4). |
| `school.lesson.checkpoint.no-dpad-input` | A keyboard-shaped item authored onto a TV lesson. |
| `school.media.checkpoints-outstanding` | A completion was **refused** — the hard gate doing its job. |
| `school.lesson.unmapped-status` | A use case grew a status the router does not know; the request 500s. |
| `school.lesson.surround.suppressed` | An audio lesson ran without the frame. |
| `gate.blocked` / `gate.released` / `gate.seek-clamped` | The generic gate layer, with the winning `gate` id (`checkpoint` or `governance`). |
| `school.lifecycle.no-playback-target` | **Read this first when the media action prints but nothing plays** — it names which of the three preconditions is missing (bus, `wakeScreen`, configured targets). |

### Telling the two failure directions apart

They are deliberately opposite, and confusing them wastes an evening.

**The frontend fails OPEN.** An unusable checkpoint list — null, absent, empty, not
an array — produces *no gate*. That is not an oversight: blocking with no question
to present would freeze the video with no overlay and no answer that could release
it, and every ungated lesson (which passes no checkpoints at all) would freeze too.
A single entry with no usable `at` is skipped for the same reason — it can never
fire, so it would deadlock the lesson forever. Unknown *clearance*, by contrast,
fails the other way: nothing is cleared, so the gate re-asks. For a gate, re-asking
is the cheap failure.

**The backend fails CLOSED, and that is where the guarantee lives.**
`RecordMediaCompletion` re-reads the unit and refuses with
`checkpoints_outstanding` (409, carrying `outstanding` and the `seekCeiling` the
screen must send the playhead back to). A screen that lost its list, or a child who
found a way past a stop, reaches here and is refused. Neither confidence buys a way
around it: a playhead at the end and a duration timer that ran out are both evidence
about *time*, and a checkpoint is a question about *comprehension*.

So: **a lesson that plays straight through without stopping is a frontend symptom;
a lesson that will not complete is the backend holding the line.** If both are true
at once, suspect the checkpoint list never reached the screen — check the snapshot
response, not the gate.

One documented exception: **an unresolvable unit completes.** If the unit was
withdrawn or edited into invalidity mid-lesson, we cannot know what was owed, and
refusing would wedge the session with no exit (the same missing unit makes
`RecordCheckpointAnswer` answer `not_gated` and `DispatchMedia` answer
`unavailable`). It fails open, loudly, at `warn`
(`school.media.completion-unit-unresolvable`). It is not a hole a child can open —
the unit id comes off the session's own `created` event, never off the request. A
curriculum read that *throws*, on the other hand, propagates: a null is durable, a
throw is a blip, and completing off a transient catalog error would skip a gate that
is still perfectly well authored.

---

## 9. Where the code lives

| Piece | File |
|---|---|
| Gate arbitration (shared) | `frontend/src/lib/Player/gate/pauseArbiter.js` |
| Gate enforcement | `frontend/src/lib/Player/gate/mediaGate.js`, `useMediaGate.js` |
| Cross-tree verdicts | `frontend/src/lib/Player/gate/GateVerdictContext.jsx` |
| Gate ids | `frontend/src/lib/Player/gate/gateIds.js` |
| Checkpoint authority (frontend) | `frontend/src/modules/School/lesson/useCheckpointGate.js` |
| Screen state machine | `frontend/src/modules/School/lesson/useMediaLessonSession.js` |
| Widget | `frontend/src/modules/School/lesson/MediaLessonScreen.jsx` |
| Question card | `frontend/src/modules/School/lesson/CheckpointQuizOverlay.jsx` |
| Lesson chrome | `frontend/src/modules/School/lesson/surround/` |
| Checkpoint arithmetic (authority) | `backend/src/2_domains/school/mediaCheckpoints.mjs` |
| Authoring validation | `backend/src/2_domains/school/curriculum/unitValidation.mjs` |
| The `checkpoint_cleared` annotation | `backend/src/2_domains/school/sessions/sessionEvents.mjs` |
| Dispatch / grade / complete / read | `backend/src/3_applications/school/usecases/{DispatchMedia,RecordCheckpointAnswer,RecordMediaCompletion,ReadLessonSnapshot}.mjs` |
| HTTP door | `backend/src/4_api/v1/routers/mediaLesson.mjs` |
| Playback target | `backend/src/1_adapters/hardware/playback/ScreenPlaybackAdapter.mjs` |
| Composition | `backend/src/5_composition/modules/schoolLifecycle.mjs`, `backend/src/app.mjs` (search `Gated media lessons`) |
| Widget registration | `frontend/src/screen-framework/widgets/builtins.js` → `school-lesson` |

---

## 10. Deployment ordering — read before touching any data file

**`data/` is a Dropbox-synced tree shared with production. A data edit is live on
prod the moment it syncs — before the code that reads it deploys.** All three edits
below must therefore be applied **after** the code ships, by hand, in that order.
Applying them early does not break the house, but it does put configuration in front
of a build that cannot honour it: the widget name resolves to nothing, and the
target list builds a playback adapter whose broadcast no screen is listening for.

**School config is cached at startup.** After editing `school.yml`, the container
needs a restart before anything reads it.

### 10.1 Mount the widget

`data/household/screens/living-room.yml` — a new entry beside the existing
`school-reading` widget:

```yaml
    - widget: school-lesson
      props:
        location: livingroom
```

`location` is the room, and it is what the WebSocket topic is built from
(`lesson:livingroom`). It must match the target's `location:` in 10.2 exactly.
The widget renders nothing until a lesson is dispatched to that room, so the menu
and the screensaver are untouched by its existing.

### 10.2 Configure the playback target

`data/household/school/school.yml` — **note the path: `school.yml`, not
`school/config.yml`, which does not exist** — nested inside the existing top-level
`lifecycle:` block:

```yaml
lifecycle:
  enabled: true
  # ... existing keys ...
  media:
    targets:
      # `location` is what the room's topic is built from (`lesson:livingroom`)
      # and MUST match the `school-lesson` widget's `props.location` in
      # data/household/screens/living-room.yml — the same value `school-reading`
      # already uses. `device` defaults to `id`; `livingroom-tv` is already a
      # registered devices.yml id.
      - id: livingroom-tv
        label: the living room TV
        location: livingroom
        child_selectable: true
```

Three things this entry decides:

- **Whether anything plays at all.** With no configured target (or no event bus, or
  no `wakeScreen` seam) the real `ScreenPlaybackAdapter` is never built and the media
  leg degrades exactly as it always has — logged, by name, as
  `school.lifecycle.no-playback-target`.
- **Whether a child may choose it.** `child_selectable` *is* the permission
  mechanism: a target a child may not choose simply never prints on their agenda.
  There is no second check elsewhere and no way to reach a non-selectable target by
  scanning harder.
- **Which room hears about it.** `location` comes from config, never from
  convention. A target without it is refused **by name** before the TV is touched,
  because stripping `-tv` off an id would be right for `livingroom-tv` and wrong — with
  no error anywhere — for the next screen — and the failure mode is a lesson broadcast to a topic
  nobody subscribes to.

### 10.3 Author the checkpoints

Any real unit YAML gaining a `checkpoints:` block (§3). Nothing is gated until a
unit actually authors one; a unit with `media` + `bank` and no `checkpoints:` keeps
behaving exactly as it does today.

### 10.4 Then restart, and watch

Restart the container so the cached school config is re-read, then dispatch one
lesson and confirm, in order: `school.media.dispatched`, the widget's
`school.lesson.session.open`, a `school.lesson.checkpoint.hit` at the first authored
position, `school.checkpoint.cleared` after the answer, and
`school.lesson.playback.completed` at the end. A `school.lifecycle.no-playback-target`
line at startup means 10.2 did not take.

---

## 11. Not built

- **No publish-time rule forbidding `matching` (or keyboard-only) items inside a
  `checkpoints:` block** — §4. This is the one gap a curriculum author can walk into
  without warning.
- **No per-checkpoint policy variation.** Retry-until-correct is the only policy;
  the schema leaves room and nothing reads it.
- **No menu-browsed lesson entry.** A lesson arrives only by dispatch; you cannot
  start one from the TV itself.
- **No durable playhead.** Resume is derived (§5). `sessionEvents.mjs` says a future
  need for the observed playhead gets its own unambiguous `positionSeconds` event —
  no such event exists.
- **Fitness has not adopted `useMediaGate`** for its element loop; it migrated the
  `resolvePause` import only.
- **Nothing has been run on the actual TV.** Every claim above is from code and
  tests.
