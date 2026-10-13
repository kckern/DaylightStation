# Chess round standing: making counted and practice wins legible

**Status:** design agreed and open questions resolved; not yet implemented
**Depends on:** `feat/chess-record-consolidation` — MERGED to `main` 2026-09-16 as `5c0ddd114`; dependency satisfied
**Date:** 2026-09-16

## The problem, in the player's words

> "I beat him six times and I'm still stuck."

A child on the piano chess ladder had beaten his current opponent six times and
had not advanced. He was right about the six wins. Four of them used the
best-move button, which asks a full-strength analysis engine what to play —
deliberately never handicapped, unlike the teaching opponent on the low rungs.
`countsTowardPromotion` therefore filed those four as `counted: false`, leaving
two counted wins against the five required.

Every part of that is working as designed. The failure is in the interface.

## What already exists (do not rebuild)

`feat/chess-record-consolidation` (14 commits, merged to `main` on 2026-09-16 as
`5c0ddd114`) already solved the retrospective half:

- `promotionIneligibility(record, policy, level)` returns `null` or
  `{ reason: 'best_moves'|'hints'|'takebacks'|'unfinished'|'other_level',
  used, allowed }` — the rule that decided a game, by name.
- `chessStandingLines.js` puts three lines on the result card: the head-to-head
  record ("You vs Weedle: 6 wins, 0 losses"), why a win didn't count ("8
  best-move requests, 0 allowed"), and the standing ("2 of 5 wins toward
  Rattata").
- Ladder results get real timestamps, which retires the `at: null` defect.
- (On `main` already, NOT branch work: the rail shows "Opponent {n} of {total}
  · {wins} of {needed} wins" — `game-platform/opponent/OpponentPanel.jsx:33`.)

That branch has landed. This design consumes `promotionIneligibility` rather
than reimplementing the predicate.

## What is still missing

Everything above explains the loss **after** it has happened. Nothing tells the
player beforehand, and nothing shows the shape of what he earned:

- **No warning before the demotion.** The best-move gesture fires immediately.
  The first he hears of it is the result card.
- **No live state during the match.** Nothing on screen says whether the match
  he is playing still counts.
- **The standing is a number, not a picture.** "2 of 5 wins" does not answer
  "but I beat him six times" the way seeing six trophies in two rows does.
- **The promotion banner still says "New opponent unlocked"**
  (`BoardGameResult.jsx`), which is video-game vocabulary for a tournament.

## Vocabulary

The ladder is a **tournament**, not a video game. Opponents are waiting in the
ring; a player goes through to the next round. Nothing is "unlocked".

| Use | Not |
|---|---|
| round, match, advance, through to the next round | unlock, level up |
| practice match | invalid / failed / doesn't count |
| demoted to a practice match | disqualified, voided |

The stored field `unlocked_through` keeps its name — it is persisted in every
player's ladder file and renaming it buys nothing. Only copy changes.

## What the player sees

### 1. The round card (lobby)

Two rows, never one. Every win appears; the rows say what kind each was.

```
  Round 2 — Weedle

  Match wins      T T o o o      2 of 5
                  3 more and you're through to Rattata

  Practice wins   * * * *          4
                  matches where you used help
```

"I beat him six times" stays true and visible. The gold row explains the stall
without deleting the rest. The practice row is stated as a thing he did, never
as a failure.

### 2. The rail (during play)

A persistent badge, so the state of the match is never a surprise:

```
  THIS MATCH COUNTS   ->   PRACTICE MATCH
```

### 3. The result screen

The badge resolves into a sentence and the trophy lands in its row. A practice
win keeps its confetti and its "Checkmate" line — he won, and we say so. The
standing is reported separately and factually:

> Practice match — your round wins stay at 2 of 5.

On promotion the banner reads:

> You're through to the next round — Rattata is waiting.

`BoardGameResult.jsx:18` holds the current "New opponent unlocked" literal, but
checkers and Connect Four render the same component and pass `promoted`. Pass
the sentence in as a prop from `ChessResult`; do not edit the shared literal and
silently restyle two other games.

Celebration and accounting do not compete. Confetti fires for both; withholding
it would denigrate a real win, and the trophy rows already carry the difference.

## The demotion mechanic

### Derive the badge, never track it

The rail badge calls the same `countsTowardPromotion` the ladder uses, against
live `helpUsed` and the loaded policy — both already on the client. One source of truth for the HELP CEILINGS, which is where drift would otherwise
bite.

It is not an absolute invariant, and this document previously overstated it. The
end-of-game verdict is the server running `applyGameToProgress` against the
record's `level`, and a ladder read that has not answered files `level: null`.
A badge derived from `helpUsed` alone will say COUNTS while the server files the
game uncounted. The badge must therefore also reflect ladder-not-loaded and
guest (`persisted: false`) states rather than asserting COUNTS by default;
specify that copy before building.

### Arm only when the next press would actually demote

Not a best-move special case. Ask the pure function whether this gesture would
cross a ceiling:

| Gesture | Against a policy of `max_hints: 1`, `max_best_moves: 0`, `max_takebacks: 1` |
|---|---|
| 1st hint | works, no warning |
| 2nd hint | arms |
| best move | arms — except where the press would be a no-op |
| 1st takeback | works, no warning |
| 2nd takeback | arms — **but see below** |

**Takebacks already have this feature.** `takebackBudget.js:91-99` renders
"won't count against {opponent}" on the gesture card before the spend, and
`willStillCount` (`:71-75`) already predicts the ceiling with its own mirrored
`DEFAULT_MAX_TAKEBACKS`. Its header comment states this design's own thesis:
let a player decide "BEFORE they do". So the claim that nothing warns before a
demotion is wrong for takebacks. This work must FOLD `willStillCount` and
`takebackNote` into the single arm predicate, not add a third implementation of
the same question.

Free help stays frictionless; the warning appears only when it means something.
Once a match is already practice, help works instantly — a match cannot be
demoted twice, so the warning stops.

### Confirm reuses the take-back idiom

The interface already teaches arm-then-confirm ("Play the octave again to take
your move back"), and these gestures are played on the piano, where there is no
hover and no dialog.

> Best move will demote this to a practice match. Play it again to use it.

Arming clears as soon as the player plays anything else. **But "backing out
costs nothing" is false today and must be fixed first.** `GESTURE_SIZES` is
`{ hint: 3, best: 4, replay: 5 }` adjacent semitones, and
`PianoChessGame.jsx:353` recomputes `recognizeGesture(heldNotes)` on every note
event with no settle window — so a four-key best press that does not land
perfectly flat passes through the three-key hint shape and charges a hint on the
way. A child who arms and then declines is still charged. This is a live defect,
not a consequence of this design; see "Pre-existing defects" below.

Note also that `gesture` goes null -> null across chord input, so a `[gesture]`
effect never observes "the player played something else". Clearing the arm needs
its own effect on held notes or move history, and the arm flag must be read
through a ref inside the gesture effect or it reads stale.

### Demotion lands when the counter does

The help controller increments `bestMoves` only once the engine has answered and
the position is still valid, so a player is never charged for help that never
arrived. Deriving the badge from that counter inherits the property for free: if
the engine times out there is no charge, no demotion, and the badge never flips.

## Data

One new pure function, beside the rule it describes, in the shared chess ladder
module:

```js
roundStanding(progress, policy)
// { round: 2, opponent: 'Weedle',
//   counted: 2, needed: 5, practice: 4, remaining: 3 }
```

**RESOLVED 2026-09-16: trophies are permanent, the gate is a sentence.**

`promotionStatus` windows to the last `policy.window` (7) counted games, so the
gate number FALLS after losses — verified that W W followed by six counted
losses reports `wins: 1`, not 2. A trophy is something you earned and keep, so
it is the wrong shape for a number that shrinks; drawing the window as trophies
would take back ground, which `ladder.mjs:11-13` says the ladder must never do.

So `roundStanding` returns two different things and the UI keeps them apart:

```js
roundStanding(progress, policy)
// {
//   round: 2,
//   counted: 2, practice: 4,        // CUMULATIVE at this round. Only ever grow.
//   gateWins: 2, gateNeeded: 5, gateWindow: 7,   // the windowed truth
// }
```

The two rows are drawn from `counted` and `practice` and never lose an item.
The gate lives in one sentence underneath, which is allowed to move both ways:

> Right now: 2 of your last 7 count. 3 more and you're through to Rattata.

The opponent's NAME is not in the return — it lives in the roster, which neither
argument carries. The caller supplies it. It belongs in that module because the module already argues that two
implementations of a promotion rule would eventually disagree.

No new endpoint and no migration: the ladder read already returns `results[]`
with a `counted` flag per game, and the policy already reaches the client.

## Tests

- `roundStanding` — zero wins, all-practice, exactly at threshold, promoted.
- The arm predicate — first hint silent, second arms, best move always arms,
  already-practice never arms, takeback ceiling respected.
- Component — the badge flips only when `helpUsed` crosses a ceiling; a
  timed-out engine request flips nothing.
- Copy — no surface renders the word "unlock".

## Pre-existing defects found while designing this

Both are live on `main`, independent of this work, and should be fixed before or
alongside it because this design's copy would otherwise lie to the player.

1. **A staggered help press charges a gesture the player did not ask for.**
   `recognizeGesture` returns `hint` at 3 adjacent semitones and `best` at 4
   (`chordGestures.js:15,47-48`), and nothing debounces the held set
   (`PianoChessGame.jsx:353`). Pressing the 4-key best cluster one key at a time
   charges a hint en route. By the same path the 5-key replay gesture passes
   through BOTH the hint and best shapes, so "show me that again" would fire an
   engine best-move request and demote the game — INFERRED, not yet run; confirm
   with a staggered five-key press against a stable position.

2. **An unknown-level game counts at rung 0.** `countsTowardPromotion` compares
   `Number(record.level) !== currentLevel`, and `Number(null)` is `0` — verified
   that a `level: null` record returns `true` at rung 0 and `false` at rung 1.
   Comments in `chessGameRecord.js` and `useChessPersistenceLifecycle.js` assert
   the ladder declines to count an unknown level. It declines everywhere except
   the first rung.

## Decisions taken 2026-09-16

**The promotion rule does not change.** `unrestricted_below_level` stays `0`.
The evidence: of the two learners with ladder files, one is a round AHEAD with
two counted wins and ZERO voided games, climbing clean under the same ceilings,
while the stuck learner has six wins at their round of which four are voided —
and has also beaten that opponent clean twice, once in twelve moves. The rule is not stopping a child who plays his own games; it is
stopping one who reaches for the button, which is what it is for. What failed
was telling him. So the UX does the whole job.

**Sequencing.** This is the second of three slices:

1. `fix/chess-phantom-help` — the two production defects below. Small,
   independent, and wrong in production right now. Ships first and alone.
2. `feat/chess-round-standing` — this document.
3. `fix/fitness-sensor-dnf` — see the companion fitness document.

## Out of scope

Changing the promotion rule itself. `unrestricted_below_level` exists in the
policy and is currently `0`, meaning the help ceilings apply from the very first
round; the module's own comment says the key exists so that "the first rungs
teach the game, not the discipline". Whether to relax the early rounds is a
household decision, not a UX one, and is deliberately left alone here.
