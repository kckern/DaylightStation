# Connect Four: the opponent always dropped in the far right column

**Reported:** 2026-09-16, by the learner, at the piano kiosk — "the opponent always
drops in the far right column."

**Status:** fixed. Root cause was in `shared/gaming/rulesets/connect-four/opponent.mjs`.

---

## What the logs said

The learner plays Connect Four at the **top rung**:

```
game.ladder-loaded   {gameId: connect-four, level: 7, opponent: Mew}
game.over            {gameId: connect-four, level: 7, plies: 8, ranked: true, result: loss}
```

`plies: 8` with `result: loss` recurs across 09-13, 09-15 and 09-16. Eight plies
is the opponent's fourth disc — the shortest loss the game allows. That is a
vertical four, dropped into one column, while the child was still reading notes.

The logs could not say **which** column, because the opponent's move was logged
nowhere: `connect-four.drop` fires only from the note-input handler, so the store
held the child's columns and the rung and nothing about the reply. See
"Second defect" below.

## Root cause

`chooseColumn` treated `level` as a **rotation of the column preference list**:

```js
const ORDER = [3, 2, 4, 1, 5, 0, 6];              // centre-first
const shift = Math.max(0, Number(level) - 1) % ORDER.length;
const preference = [...ORDER.slice(shift), ...ORDER.slice(0, shift)];
return preference.find((column) => legal.has(column)) ?? null;
```

At **level 7**, `shift` is 6 and the preference list becomes
`[6, 3, 2, 4, 1, 5, 0]` — column 6, the far right, is the first choice for every
move that is not an immediate win or block. Confirmed directly:

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| opening column | 3 | 2 | 4 | 1 | 5 | 0 | **6** |

Playing it out at level 7 against a child who does not block gives replies
`6, 6, 0, 6` — the `0` only because it was forced to block — and a vertical four
in column 6 on ply 8, exactly the losses in the log.

`level` was never wired to strength at all. Nothing searched: the function saw
one ply (win/block) and then took a list position. So the ladder ran **backwards**
— rung 7 was the weakest and most predictable setting in the game, and lost a
head-to-head match to rung 1 from both seats. The rest of the system had always
assumed depth: the roster declares `depth: index + 1`, the hint constant is named
`HINT_SEARCH_LEVEL = 5`, and its comment reads "at level 1 the search is one ply
and cannot see the reply" — of a search that did not exist.

## Fix

`level` is now the **search depth**, matching the checkers opponent next door:
minimax with alpha-beta to `level` plies, an open-lines heuristic at the horizon,
and the immediate win and block kept ahead of the search so rung 1 still plays
the two moves a child expects. Centre-first `ORDER` is retained as *move
ordering* and the tie-break — never as difficulty.

Result: every rung opens in the centre, and the deeper rung beats the shallower
one from both seats for 1v4, 1v7, 4v7, 2v5 and 3v6.

### Performance

The first implementation searched over the engine's own board API, which copies
the board and rescans all 69 lines per node: **2206ms** at rung 7. That is past
the adapter's 1000ms worker timeout — which hands the search back to the
backend's **main thread** — and far past what the piano tablet can do in its
local fallback without freezing.

The search now runs on a flat `Int8Array` with column heights, mutated and
un-mutated in place, checking only the lines through the disc just played.
Worst case at rung 7: **254ms**. The backend worker path serves it in 96–163ms
and reports `engine: "worker"`.

## Second defect found: the opponent's move was never logged

`connect-four.drop` is emitted from the note-input handler only, so the opponent's
column never reached the log store. That is why this report could not be checked
against the logs and had to be inferred from repeated 8-ply losses. Added
`connect-four.opponent-drop` (column, ply, level, source, engine) in `onReply`.

## Third defect found: these tests were gated by nothing

The whole `shared/` tree — the game rulesets included — was outside every gate:

- `scripts/gate-vitest.mjs` `ROOTS` listed `tests/unit`, `tests/isolated`,
  `backend`, `frontend`. Not `shared`.
- `backend/shared` is a symlink to `shared/`, and the gate's walk deliberately
  refuses to follow symlinks — so the tree was unreachable from both directions.
- The ruleset's own `engine.test.mjs` imported `node:test`, which the gate
  excludes by ownership, so it was run by no harness at all.

Fixed: `shared` added to `ROOTS`; `engine.test.mjs` and the adapter's
`ConnectFourEngineAdapter.test.mjs` converted to vitest; the new
`opponent.test.mjs` written as vitest so the gate owns it.

Adding `shared` to `ROOTS` then made the gate exit 2 with a population/run
mismatch — 3340 files claimed, 3376 run, 36 extra. **Vitest treats a path given
on the command line as a FILTER, not a literal file**, so every
`shared/x.test.mjs` in the population also matched the symlinked
`backend/shared/x.test.mjs` and both copies ran. (That is also why each ruleset
spec appeared twice in every run here.) `vitest.config.mjs` now excludes
`backend/shared/**` and `backend/shared-contracts/**`, keeping the real path —
the one the gate's own walk collects. The gate was right to refuse: an
unreconciled population is exactly what it exists to catch.

## Fourth: two boundary violations the ungated tree had been hiding

With `shared/` finally in the gate, `shared/gaming/testing/importBoundaries.test.mjs`
failed two of its four rules. Neither is related to Connect Four; both had been
failing silently for as long as the tree was ungated.

- `backend/src/2_domains/gaming/services/playEligibility.test.mjs` carried a
  franchise name as a per-title fixture id. It is an opaque key, so it was
  renamed to `retroarch:gb/story-rpg`.
- `frontend/src/modules/Gaming/platform/ui/Timer.test.jsx` held two tests that
  pin the **Fitness** Timer and imported `../../../Fitness/` from inside generic
  Gaming. Both tests moved, unchanged, to
  `frontend/src/modules/Fitness/shared/primitives/Timer/Timer.test.jsx` — the
  side that owns the component. Nothing was skipped or baselined; the same
  assertions still run. (Test-only: no Fitness runtime code changed, so the
  garage kiosk needs no reload on this account.)

## Tests

`shared/gaming/rulesets/connect-four/opponent.test.mjs` pins:

- every rung opens in the centre, and no rung parks in column 6;
- every rung still takes the immediate win and the immediate block;
- depth changes the move **and** the shallow move is the losing one — same
  position, same opponent, only the rung's depth differs, and it flips the winner;
- the ladder is monotonic across five rung pairs, from both seats;
- rung 7 answers well inside the adapter's worker budget;
- hints reason for red rather than inheriting the opponent's seat;
- a full column is never offered; unknown or missing levels still play centre.

An earlier draft of the depth test asserted only that rung 7 *held* a position —
which every rung did, making it vacuously true. It was replaced with the
position above, where rung 1 and rung 7 genuinely diverge and the result flips.

## Files

| File | Change |
|---|---|
| `shared/gaming/rulesets/connect-four/opponent.mjs` | `level` = search depth; alpha-beta search on a flat board |
| `shared/gaming/rulesets/connect-four/opponent.test.mjs` | new — pins the ladder's direction and the budget |
| `shared/gaming/rulesets/connect-four/engine.test.mjs` | converted `node:test` → vitest so it is gated |
| `frontend/src/modules/Piano/PianoConnectFour/PianoConnectFour.jsx` | log the opponent's drop |
| `backend/src/1_adapters/piano-games/ConnectFourEngineAdapter.test.mjs` | converted to vitest; now asserts the search really runs in the worker, not on the calling thread |
| `scripts/gate-vitest.mjs` | `shared` added to `ROOTS`; `GATE_WORKERS` may now LOWER (never raise) the worker count — the full run was OOM-killed on this box at the computed count, returning no verdict at all |
| `vitest.config.mjs` | exclude the `backend/shared*` symlink duplicates that the CLI-path filter was double-running |
| `backend/src/2_domains/gaming/services/playEligibility.test.mjs` | franchise fixture id renamed (boundary rule) |
| `frontend/src/modules/Gaming/platform/ui/Timer.test.jsx` | two Fitness-parity tests moved out (boundary rule) |
| `frontend/src/modules/Fitness/shared/primitives/Timer/Timer.test.jsx` | new — their home on the owning side |
| `docs/reference/piano/piano-game-platform.md` | a rung is a search depth |
