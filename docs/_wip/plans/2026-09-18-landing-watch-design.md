# Landing watch — making "we did it" and "it happened" two different claims

**Date:** 2026-09-18
**Status:** design, approved in chat; not yet implemented
**Origin:** two production failures on 2026-09-18, both invisible to a green
test suite AND to a seven-day log store.

---

## The problem

Both of the day's failures logged SUCCESS while a child sat in front of a
screen that had not done the thing.

| | what the log said | what the child saw |
|---|---|---|
| Timed exercise cursor | `piano.exercise-visual-cursor {displayedCursor: 2, reason: "clock"}` | no cursor anywhere on screen, for eleven days |
| Chess opponent turn | `opponent-replied {san: "Qxd4"}` | board frozen at ply 7 for ten minutes |

Neither is a logging *volume* problem. The events were emitted, shipped,
indexed and queryable. They were simply describing **what the code decided to
do**, never whether it happened. A cursor index is an intention; a committed
move is an intention. Our telemetry has no vocabulary for *outcome*.

This has bitten before in a third subsystem. `createPlaybackStallWatch`'s own
comment records the 2026-08-16 remount storm running "for 17 minutes with a
healthy-looking device" because **"nothing compared consecutive values."** That
fix was built once, for playback, in `screen-framework/publishers/`, and never
generalised — which is why chess had no equivalent when it needed one.

## Non-goals

- Not a new logging framework. The existing one is good; the gap is semantic.
- Not continuous screen verification. Rejected deliberately: continuous geometry
  reads on the SM-T590 risk causing the jank they exist to report.
- Not a refactor of `createPlaybackStallWatch`. It may adopt this later or
  never; its rules are legitimately domain-specific.
- Not a replacement for CI assertions. Tests catch "we drew it wrong"; this
  catches "it didn't land", including races no test can reach.

## Naming

**`landingWatch`.** "Watch" is the established house noun
(`createPlaybackStallWatch`, `useRenderWatchdog`). **"Assertion" is unavailable** —
State Gates owns it for authenticated evidence from producer contexts, and
colliding on it would be a genuine conceptual confusion.

---

## 1. The primitive

`frontend/src/lib/watch/landingWatch.js` — pure. No timers, no DOM, no network,
injected clock. Same posture as `createPlaybackStallWatch`, which is explicitly
"a pure state machine over successive snapshots".

```js
createLandingWatch({ timeoutMs, now = () => Date.now() })
→ { claim(key, detail), confirm(key), sweep(), pending(), reset() }
```

- **`claim(key, detail)`** — "I have just caused X to be true." Arms a deadline.
- **`confirm(key)`** — "X is now observably true." Drops the claim.
- **`sweep()`** — returns claims past their deadline, **each at most once**
  (latched), so a caller reports once per episode rather than once per tick.
- **`pending()`** / **`reset()`** — introspection and teardown.

**Re-claiming an open key is a no-op; the first deadline stands.** This is the
one rule that decides whether the watch works at all: without it, a component
re-rendering every frame refreshes its own deadline forever and the watch can
never fire. That is the exact class of bug this exists to catch, so it must not
be reintroduced inside it.

The watch never decides what "landed" means. It knows only that something was
claimed and nothing confirmed it in time.

## 2. The React wrapper

`frontend/src/lib/watch/useLandingWatch.js` — owns the tick and the reporting,
mirroring how `useRenderWatchdog` wraps the pure `tickWatchdog` ("the decision
logic lives in the pure `tickWatchdog` so it is unit-testable without a DOM or
real frames").

On each missed claim, in a try/catch:

1. `logger.warn(event, detail)`
2. `autoReport({ app, reason, dedupeKey, detail })`
3. optional `onMissed(detail)` for self-heal

`autoReport` is the right sink and needs no change. Verified: `submitFeedback`
attaches `recent: getRecentEvents(150)` (`feedbackApi.js:35`) from the 300-event
ring in `Logger.js`, which is independent of every transport, level filter and
pruner — so the report carries the surrounding evidence at the moment it exists,
rather than requiring reconstruction from a log Docker may already have
truncated. `autoReport` also brings a 15-minute per-key cooldown and a hard cap
of 5 per page load.

---

## 3. Surface: chess (state landing)

**Claim** in `useChessOpponentTurn`'s `onReply`, immediately after
`setGame(committedState)`:

```js
landing.claim(`ply:${committedState.history.length}`, {
  san, engine, fen, gameId,
});
```

**Confirm** in `useChessAddressingProgress`'s effect — the one place that already
observes `game.history` advancing and logs `chess.move`. When it logs ply N, it
confirms `ply:N`. The confirm site is the existing observation of reality, and
it is precisely the effect whose silent rewind branch hid this bug.

**Timeout: 2s.** `onMissed` logs `chess.turn-not-landed`, files the report, and
calls `wakeOpponent()`.

**Division of labour with the 20s board watchdog** (shipped in `06832cdcd`) —
they answer different questions and both are needed:

| | question | sees |
|---|---|---|
| `OPPONENT_WAKE_MS` watchdog (20s) | "the opponent owes a move and none has arrived" | the request never returning — where **no claim is ever made**, so the landing watch is blind |
| landing watch (2s) | "we wrote ply 8 and the board didn't keep it" | the write being lost — and names it in 2s instead of 20 |

The landing watch is the diagnostic precision; the watchdog is the child-facing
backstop. Recovery arrives 18 seconds sooner when the landing watch is the one
that fires. Thrash is bounded by the once-per-key latch and `autoReport`'s caps.

## 4. Surface: the exercise cursor (paint landing, one-shot)

**Claim** on the first frame of a timed run where `visualCursor.index >= 0`;
key `cursor:${assessmentId}`, one claim per run.

**Confirm** from a `useLayoutEffect` in `ExerciseNotation` keyed on `decoration`
and latched to measure **once per run**. It must be a layout effect rather than
`paint()`: the lane rects are portalled, so they do not exist at the moment
`paint()` computes their geometry. `ScorePassage` creates its rects imperatively
in a layout effect already, so its measurement goes there directly.

**The check is containment, and that distinction is the entire point.** "A lane
exists" was TRUE throughout the eleven-day failure — it existed, at x=406 in a
viewBox 302 wide. Even "intersects the stage" would have caught the single-staff
case but **not** the grand staff, whose displaced lane sat comfortably inside the
stage, just over the wrong stave. Only "the lane encloses the notehead it points
at" catches both.

Cost: roughly five DOM reads, once per run.

**No self-heal.** You cannot redraw your way out of a coordinate-space bug.
Report only. The payload carries the lane rect, the notehead rect, the stage
rect, the `viewBox` string and the derived scale factor — the exact dump that
made the 2026-09-18 diagnosis a single measurement.

---

## 5. Failure posture

- **Never throws.** A telemetry failure must not become the user-visible
  failure — `autoReport`'s own stated rule, applied to every callback here.
- **Once per claim key per episode**, enforced in the pure core; `autoReport`'s
  cooldown and cap are the second line.
- **`warn`, not `error`.** A missed landing is a SUSPICION. The proof rides in
  the feedback item.
- A watch that cannot report is inert, never fatal.

## 6. Testing

- **Pure core:** unit tests with an injected clock — claim/confirm/sweep,
  the once-only latch, and specifically that **re-claiming an open key does not
  extend its deadline**.
- **Wrapper:** fake timers; asserts `logger.warn` + `autoReport` fire once and
  that `onMissed` is called, and that a throwing callback does not escape.
- **Chess:** extend `useChessOpponentTurn.test.jsx` — a reply that commits but
  whose confirm never arrives must fire within 2s and call `wakeOpponent`.
- **Cursor:** extend `ExerciseRun.measure.test.jsx` in real Chromium, using
  bank-shaped fixtures (`value: '8th'`, `staff: 'grand'`). Assert that the
  confirm passes on correct geometry — and, with the pre-fix coordinate maths,
  that it fires. A check that cannot fail is the thing that caused this.

## 7. What this does not catch

Stated plainly so nobody over-trusts it:

- Anything that never makes a claim. A code path that silently returns early is
  still invisible; the watch only sees intentions that were declared.
- A cursor that is painted correctly and later goes wrong mid-run — the one-shot
  check is deliberately not a loop.
- The wrong thing landing correctly. Confirming `ply:8` says the board reached
  ply 8, not that Qxd4 was the right move.

## 8. The open question this is built to close

Which of the three `setGame` writers loses the chess ply-8 state
(`docs/_wip/bugs/2026-09-18-chess-opponent-turn-lost-and-unrecoverable.md`).
Four candidate causes are eliminated there; the fifth cannot be found by reading
because no writer records the ply it wrote. With the landing watch in place, the
next occurrence files a report containing the claim, the 150 events around it,
and `chess.history-rewound` if the board went forward and back — which together
localise the writer.
