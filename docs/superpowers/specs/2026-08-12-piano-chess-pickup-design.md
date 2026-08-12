# Piano Chess — Hover, Pick Up, Drop — Design

**Date:** 2026-08-12
**Status:** Approved, not yet implemented.
**Surface:** `/piano/games/chess` (`frontend/src/modules/Piano/PianoChessGame/`, `frontend/src/modules/Chess/`)
**Follows:** `2026-08-12-piano-chess-chrome-design.md` (narrowing, the four channels, gesture-asked help, the game record)

## Problem

Addressing a square and committing to it are the same act. A chord resolves, the player releases,
and the game immediately picks up that piece. In a game where squares are *chords*, that is
backwards: a player needs to try a chord and see where it lands. Experimenting is the point, and
right now every experiment is a commitment.

The same collapse makes refusals noisy. Playing a chord that names an empty square while exploring
earns a red shake and a sentence, when the player was only looking.

Two smaller gaps follow from it. Once a piece *is* picked up, nothing marks it as being in hand — it
sits on its square looking like every other piece. And the squares it can reach are identified only
by the rim, so a player must read a file label, read a rank label, and intersect them in their head
mid-game.

## The model

Three levels of intent, each with its own cost.

**Hover — one chord.** Playing a chord lights its square. Nothing is committed. A player can wander
the board this way indefinitely, at no cost and with no scolding.

**Pick up — the same chord twice.** Two hovers of the same square in a row, where the second is
*recognised* within **800ms** of the first release, lifts the piece. Hovering a different square in
between resets it.

**Drop — one chord.** With a piece in hand, hovering an eligible square moves it there.

The asymmetry is deliberate. Picking up can land on any of 64 squares, so it needs the deliberate
double. Dropping can only reach a handful of squares, which are lit and labelled, and the player has
already declared intent by holding the piece. A symmetric rule would cost four chord-plays per move,
which is real fatigue for a five-year-old.

### Why the window ends at recognition

800ms is measured from the first chord's release to the moment the second is **recognised**, not to
its release. A repeat needs no new fingering — the hand stays in the shape and re-strikes — so the
budget only has to cover the lift, the re-strike, and the 140ms settle. Ending the window at
recognition means a player who then *holds* the second chord to study the board never silently fails
the double, which would be a rule with no visible cause.

### Consequences that must be built deliberately

**The piece lifts while the second chord is still held.** Recognition happens under the fingers, so
the release that follows must be swallowed — otherwise it registers as a third hover on the square
the piece just left.

**Release stops committing anything.** The old "preview you can correct while still holding"
mechanic retires: under a hover model there is nothing to correct, because nothing has happened yet.

**Hovering an ineligible square while holding a piece is silent.** It lights, like any hover.
Refusing a player who is exploring is the noise this design exists to remove, and an unlit,
unlabelled square already says "not here" without a scolding. Refusals shrink to acts that are
genuinely wrong: double-playing an empty square, or an opponent's piece.

**The octave still puts the piece back.** It is the one gesture that must keep working unchanged,
because it is the visible escape.

## The piece in hand

Marching ants crawl the held square's border. They are an animated variant of the **outline**
channel rather than a fifth visual language — solid outline still means the last move, and the crawl
means "this one is in the air".

They animate `background-position`, not `filter`: on the 2018 tablet an animated filter is a known
paint-cost trap. The animation runs only while a piece is held. Under `prefers-reduced-motion` it
falls back to a static brass outline, following the pattern already used for the refusal shake.

## Labelled destinations

Every eligible square carries a **corner badge** naming the chord that sends the piece there. The
corner is the one placement that never covers the piece, which matters most on a capture, where the
square already holds an enemy man.

The green destination dot stays. A corner badge is small, and the dot is what reads from across the
room; the badge is what you read when you are deciding.

Labels are config-driven in `chess.yml`, **default on**, with the usual per-user override, and the
settings panel gains a fourth control for them.

**Showing them is free.** The double-play *was* the request, so nothing here is charged to the game
record. The three-note cluster keeps a job the pick-up model does not cover — which of your pieces
can move at all, before you have picked anything up — and four notes still asks the engine for the
best move. Those two remain the only things the record counts as help.

## What this changes in the existing code

Almost all of it is in one place: the surface stops calling `handleSquare` on every `commit` event
and routes commits through a small hover/pick-up state machine instead. `advanceCursor` itself does
not change — it already emits exactly the events this needs.

Untouched: candidate narrowing (still what lights up while a chord is being spelled), the gesture
recogniser, the four channels, the config plumbing, and the record's shape.

The state machine is worth its own module — `chordSelection.js`, pure, taking the previous selection
state plus a commit event and returning the next state with an action (`hover`, `pickup`, `drop`,
`refuse`). Keeping it out of the component is what makes the 800ms window, the reset-on-different-
square rule, and the swallowed post-pickup release testable without rendering anything.

## Testing

- **The selection machine**, pure and exhaustively: a single hover commits nothing; the same square
  twice inside the window picks up; the same square twice *outside* the window does not; a different
  square in between resets; the release after a pick-up is swallowed; with a piece held, an eligible
  square drops and an ineligible one only hovers; the octave puts it back at every stage.
- **The window boundary** asserted from both sides with a controlled clock — at 799ms it picks up, at
  801ms it does not — so the rule is pinned rather than approximated.
- **The record still counts only real help**: a game played entirely through hovers, pick-ups and
  drops records `hints: 0`.
- **The marching ants** are present while a piece is held, absent otherwise, and replaced by a static
  outline under `prefers-reduced-motion`.
- **Labels** appear on eligible squares when the config says so, disappear when it does not, and do
  not obscure a piece on a capture square.

Every test must be able to fail. Prove the timing tests in particular by moving the boundary and
watching them go red — a window test that passes at any duration is worse than none.

## Scope

**In:** the hover/pick-up/drop machine, the 800ms double, the swallowed post-pickup release, the
narrowed refusal cases, marching ants, corner-badge labels with their config and panel control.

**Out:** the addressing vocabulary — the reading level (bass-clef ranks, treble-clef files) and
inversions as distinct squares, both still queued behind this. Also out: any change to narrowing,
the gesture recogniser, or the record's fields.
