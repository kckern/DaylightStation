# Piano Chess — Takeback, Help Budget, and Opponent Thinking Time

**Date:** 2026-08-13
**Module:** `frontend/src/modules/Piano/PianoChessGame/`
**Related:** `shared/gaming/chess/ladder.mjs`, `backend/src/3_applications/chess/`

## Problem

Two complaints, one design.

**Players want to go back one.** A move committed by the second chord lands on
the wrong square and the opponent has already answered. There is no way to undo
it. The `Put it back` octave gesture handles the *other* half of the problem —
the wrong piece picked up — but it is not being found, and it cannot help once a
move has landed.

**The opponent answers too fast.** A flat 700ms reply reads as a reflex rather
than as an opponent. Every character on the 21-rung ladder answers at the same
speed, so strength is a number on a settings panel and nothing a player feels.

## What already exists

The module already has the shape this feature needs, and the design is mostly a
matter of not inventing a second one beside it.

- Help is asked for **at the keys**, never configured: a 3-semitone cluster
  shows legal moves, a 4-semitone cluster asks for the best move. A run of
  adjacent semitones is chosen because no square can ever sound like one.
- Help is **counted per game** in `helpUsed = { hints, bestMoves }`, written into
  the per-user record (`chessGameRecord.js`) and the household archive
  (`chessGameArchive.js`).
- The ladder **already enforces a legality context**. `DEFAULT_LADDER_POLICY`
  carries `max_hints: 1, max_best_moves: 0`, and `countsTowardPromotion()` drops
  a help-heavy game out of the promotion window. The game is still played, still
  archived; it just certifies nothing.

So "practice versus match" is not a mode anyone selects. It is an outcome of how
a game was played, and the ladder is the thing that decides.

### No practice/match toggle is added

`countsTowardPromotion()` also requires `record.level === currentLevel`. A game
against an opponent already beaten therefore certifies nothing **by
construction**. Practice mode already exists; a player enters it by choosing an
opponent in the roster they already open. Takebacks there cost nothing without a
single new concept, and no switch is added anywhere in the UI.

---

## 1. The rewind — `takeMoveBack(state)`

A new pure transition in `chessGameState.js`, alongside `applySquare` and
`commitMove`. Returns `{ state, event }` and never throws, matching the module's
existing contract.

**Unit of rewind:** the player's last move *and everything after it*. Two plies
once the opponent has answered; one if they have not. The player lands on
exactly the board they faced before they moved — anything else leaves them on a
position they never chose.

**Implementation:** `undoMove` from `@shared-gaming/chess/engine.mjs` already
drops one ply by replaying from `initial_fen`. Call it per ply. Then recompute
`status` via `describeGame`, trim `history` by the same count, re-derive
`lastMove` from the new last entry, and clear `origin` and `rejection`.

**Refusals** carry a reason, per the module's contract, and extend
`REJECTION_MESSAGES`:

| Reason | When | Message |
|---|---|---|
| `nothing_to_take_back` | history holds no move by this player | "There is nothing to take back yet." |
| `game_over` | game has ended | "The game is over." (existing string) |
| `no_takebacks_left` | per-game cap spent | "No takebacks left this game." |
| `takeback_cooling_down` | `cooldown_moves` not yet elapsed | "You can take another move back in N moves." |

**Event:** `{ type: 'took_back', plies, restoredFen, undone: [entries] }`.

**Where the rewound moves go.** They leave `history` — that list is the game
being played, and the board, the captured rail, and `move_count` all read it. So
`takeMoveBack` appends them to a separate `undoneHistory` array on the game
state, each entry keeping the `ply` it was played at. Nothing but the archive
reads that array; `createChessGameState` initialises it empty and `restart()`
starts a fresh one.

### Two properties that fall out for free

**The chord map returns correctly.** `schemeForPly()` is a pure function of
`seed` and the player's turn index, so rewinding to ply *n* re-derives exactly
the map the player was reading when they made the move. No special handling, and
no risk of resolving a chord against a map the player never saw.

**A takeback during the opponent's think time works.** That is the moment a child
actually realizes, so it must. The opponent effect's existing `cancelled` flag
and cleanup already kill a pending reply when the state change re-runs the
effect — the rewind needs no cancellation machinery of its own. In this case
only one ply is dropped, because the opponent has not moved.

---

## 2. The gesture — octave, twice

The game already teaches *play it twice to commit*: a chord once hovers a
square, the same chord again picks the piece up. The takeback is that idiom one
step further, so there is nothing new to learn.

`isOctave` (`chordCursor.js`) already recognises the shape, and `advanceCursor`
emits `escape` on release after a settle. Two settled `escape` events inside
`DOUBLE_WINDOW_MS` (800ms) is the takeback. A `lastEscapeAtRef` in
`PianoChessGame.jsx` holds the timestamp.

| Situation | First octave | Second octave, within 800ms |
|---|---|---|
| Holding a piece | Put it back *(unchanged)* | — window restarts after a put-back |
| Game over | Play again *(unchanged)* | — |
| Nothing in hand | **Arms.** Prompt: *"Play the octave again to take your move back."* | Rewinds |

**The armed prompt is load-bearing.** It makes the gesture discoverable at the
exact moment a frustrated child is already reaching for something, and it makes
an accidental rewind from idle octave-noodling essentially impossible — a stray
single octave now says what a second one would do instead of doing it. No
existing behaviour is displaced: today a lone octave with nothing in hand is a
no-op.

Because `advanceCursor` checks `addressed` before the octave, the reading (staff)
vocabulary — where an octave *can* be a legitimate square — keeps working
unchanged. The takeback inherits that guard.

**No confirmation dialog.** The double-play window is the confirmation, the
per-game cap bounds the damage, and the archive tells the truth afterwards.

### Gesture card

A fourth `GestureCards` entry: the same two-keys-an-octave-apart diagram with a
`×2` badge (a new optional `repeat` prop on the card). Its note carries the live
budget:

- `"2 left"` — remaining under the per-game cap
- `"none left"` — cap spent, card muted
- `"won't count toward beating Pip"` — when the next takeback would breach the
  ladder ceiling. Honest because `/api/v1/chess/ladder` already returns `policy`
  and the current opponent's name.

---

## 3. Configuration — every knob in `chess.yml`

No policy number is baked into code.

```yaml
help:
  takebacks:
    max_per_game: 3        # null = unlimited
    cooldown_moves: 0      # 0 = none
ladder:
  promotion:
    max_hints: 1
    max_best_moves: 0
    max_takebacks: 1
    unrestricted_below_level: 0   # early rungs ignore the ceilings entirely
```

**The split matters.** `max_per_game` and `cooldown_moves` are frontend — the cap
the player feels at the keys. The promotion ceilings stay server-side in
`countsTowardPromotion()`. The frontend counts and reports; the ladder decides.
This preserves the existing rule that the server is the sole authority on
promotion, which is what stops a reloaded tab or a crafted request from handing
out a rung.

`unrestricted_below_level` is the only new clause in the ladder domain: below
that level, the help ceilings are not applied at all, so the bottom of the ladder
teaches the game before it teaches the discipline. Default `0` preserves today's
behaviour exactly.

**Defaults chosen:** `max_per_game: 3` gives a felt constraint that teaches care.
`max_takebacks: 1` mirrors `max_hints: 1` — one slip is a child correcting
themselves, a second is being carried.

`helpUsed` becomes `{ hints, bestMoves, takebacks }` and flows unchanged into
`buildGameRecord` (new `takebacks` field) and `buildGameArchive`
(`help.takebacks`).

---

## 4. Archive — the rewound blunder survives

`buildGameArchive` merges `undoneHistory` back into the `moves` list, ordered by
the `ply` each move was played at, marking those entries `undone: true` and
carrying `undone_at_ply` so the ordering is recoverable. A replayer filters them
out to reconstruct the game that was actually played; an analyzer reads them to
find the moment that matters.

This is the reason the archive exists. *Played Qxd5, took it back, played Nf6
instead* is the single most teachable moment in a child's game, and it is
recoverable from nowhere else once it is dropped. `move_count` continues to
count only the surviving line, so nothing downstream that reads it changes
meaning.

---

## 5. Opponent thinking time, scaled by level

New pure module `opponentThinking.js`:

```yaml
opponent:
  think_ms: { floor: 600, ceiling: 4000, jitter: 0.25 }
```

`thinkTimeFor(level, config, ply)` interpolates across the 21 rungs, with jitter
derived from `seed + ply` rather than `Math.random` so the value is deterministic
and testable. Pip answers in well under a second; Malgrave broods for four. With
no ladder resolved — a guest, or before the fetch lands — it falls back to
today's `opponent_delay_ms`.

### A bug fixed on the way

The current effect waits `opponentDelayMs` and *then* sends the request, so a
slow network **adds** to the pause. It must fire the request immediately and
reply once `max(elapsed, thinkTime)` has passed: the think time becomes a floor,
not an addend. Malgrave brooding for four seconds is deliberate; Malgrave
brooding for four seconds plus three of WiFi is a hang, and on the piano tablet
that stall is a known failure mode.

### Settings panel

The `Opponent replies after 300 / 700 / 1200 ms` row becomes a pace multiplier —
**Quick / Natural / Slow** — scaling the whole curve. A flat millisecond count no
longer describes what happens, and three discrete tap targets remain (no
sliders, per the kiosk touch rules).

---

## 6. The thinking animation

`OpponentPortrait` takes a `thinking` prop, already available in
`PianoChessGame.jsx` as `opponentThinking` and already feeding
`opponentStatus()`.

The identicon is a 5×5 grid of SVG `<rect>` cells (`cardIdenticonModel.js`), so
it animates per-cell with no new artwork: a staggered pulse whose `animation-delay`
is derived from cell index, reading as a wave across the face. **`opacity` and
`transform` only — never `filter`.** Animated `filter` is a documented
frame-rate killer on the piano tablet.

The pulse period is driven from the computed think time through a CSS custom
property (`--pc-think-period`), so a strong opponent visibly broods slower and
heavier than a weak one — the latency and the animation say the same thing.

Rosters that ship artwork (the Pokémon override) have no cells to animate and get
a gentle breathing `transform: scale()` on the image instead. Both paths are
guarded by `prefers-reduced-motion`.

---

## Testing

| Area | Tests |
|---|---|
| `chessGameState.js` | Rewind of two plies and of one (opponent not yet replied); every refusal reason; chord map restored to the pre-move deal; `status`, `lastMove`, `history` all consistent after rewind |
| Gesture | Two settled octaves inside 800ms rewind; outside the window do not; octave while holding still puts back; octave at game over still restarts; staff-vocabulary octave square unaffected |
| Budget | Cap enforced; cooldown enforced; `null` cap means unlimited; tally reaches record and archive |
| `ladder.mjs` | `max_takebacks` breach drops a game from the window; `unrestricted_below_level` exempts low rungs; default config reproduces today's behaviour exactly |
| `chessGameArchive.js` | Undone plies retained with `undone` and `undone_at_ply`; `move_count` counts only the surviving line; replay from `initial_fen` through non-undone moves reaches `final_fen` |
| `opponentThinking.js` | Monotonic across levels; jitter deterministic for a given seed and ply; floor/ceiling respected; fallback when no ladder |
| Opponent effect | Request fires before the delay, not after; total wait is `max(elapsed, thinkTime)`; a takeback mid-think discards the pending reply |
| Portrait | `thinking` renders the animated state; art rosters take the breathing path |

## Logging

Per the project logging rules, on the `piano-chess` child logger:

- `takeback` — `{ plies, undone_san, remaining, will_count }`
- `takeback-refused` — `{ reason, remaining }`
- `takeback-armed` — `{ }` (first octave with nothing in hand)
- `opponent-think` — `{ level, think_ms, elapsed_ms, waited_ms }` at debug

## Out of scope

- A persistent cross-game coin wallet. The per-game tally is the currency; a
  balance that survives games needs server-side wallet state, earning rules, and
  a spend UI, and it risks turning chess into currency farming. Revisit only if
  the household economy absorbs games generally.
- Redo. A takeback that can itself be undone is a second history to explain.
- Under-promotion, position complexity heuristics for think time, and per-move
  latency variation beyond jitter.
