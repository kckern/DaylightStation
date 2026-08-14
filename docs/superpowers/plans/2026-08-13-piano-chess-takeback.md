# Piano Chess Takeback & Opponent Thinking Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player take back their last move with an octave played twice, budgeted and recorded like the existing hint gestures, and make the opponent's reply time scale with their ladder level while their portrait visibly thinks.

**Architecture:** The game already treats help as a gesture at the keys, counted per game into `helpUsed`, written to the record and archive, and judged by the ladder's promotion policy. Takebacks join that existing rail rather than building a second one: a new pure `takeMoveBack()` transition in `chessGameState.js`, a small `takebackBudget.js` for caps and cooldowns, and one new clause in the shared ladder policy. Opponent latency becomes a pure `thinkTimeFor()` curve across the 21 rungs, applied as a *floor* on the reply rather than as a delay added before the request.

**Tech Stack:** React 18 (frontend, `.jsx`/`.js`), ES modules (`.mjs` for shared/backend), Vitest, SCSS. Chess rules come from `shared/gaming/chess/` (chess.js underneath).

**Spec:** `docs/superpowers/specs/2026-08-13-piano-chess-takeback-design.md`

## Global Constraints

- **Test command (this worktree):** `./node_modules/.bin/vitest run <paths>`. Do NOT pass `--reporter=basic` — it does not exist in vitest 4 and fails with `ERR_LOAD_URL`.
- **Never use raw `console.*` for diagnostics.** Use the logging framework: `getLogger().child({ component: 'piano-chess' })` via the module's existing lazy `logger()` helper.
- **Never animate CSS `filter`.** It is a documented frame-rate killer on the piano tablet. `opacity` and `transform` only.
- **Inline SVG, never unicode glyphs.** The kiosk WebView renders unicode symbols as tofu.
- **No `Array.prototype.findLastIndex` / `findLast` / `at()` on new hot paths.** The kiosk runs a 2018 Android WebView; use explicit reverse loops.
- **No sliders in kiosk UI.** Discrete tap targets only.
- **snake_case in YAML and in records; camelCase in component state.** `chessCues.js` is the only place the two spellings meet for feedback flags; do not add a second translation site.
- **Comments explain *why*, not *what*.** This module's existing comments are long-form and explain the failure the code prevents. Match that register.
- Household chess config lives in the **data volume** at `data/household/config/chess.yml`, not in the repo. It is read via `docker exec` and cached in memory at backend startup.

---

### Task 1: Make the game record satisfy the promotion gate

**Why this is first:** `countsTowardPromotion()` requires `record.completed`, `record.level`, and `record.help`. `buildGameRecord()` emits none of them — it writes `hints`/`best_moves` flat. Verified: seven clean wins produce `counted: false` seven times and the player stays on level 0. **No player has ever been promoted.** Adding a takeback ceiling to that gate before fixing it would tighten a door that never opens.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessGameRecord.js`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx:624-628` (the `buildGameRecord` call) and `:785-798` (the end-screen summary)
- Test: `frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildGameRecord({ game, rungId, level, opponent, hints, bestMoves, takebacks, startedAt, endedAt })` returning `{ result, outcome, completed, level, moves, help: { hints, best_moves, takebacks }, rung, opponent, duration_ms }`. Later tasks read `record.help.takebacks`.

- [ ] **Step 1: Write the failing test**

Add to `chessGameRecord.test.js`:

```javascript
import { countsTowardPromotion, DEFAULT_LADDER_POLICY } from '@shared-gaming/chess/ladder.mjs';

const finished = {
  status: { game_over: true, outcome: 'checkmate', winner: 'w' },
  playerColor: 'w',
  history: new Array(30),
};

describe('the record the ladder actually reads', () => {
  it('carries the fields the promotion gate asks for', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 0,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(record.completed).toBe(true);
    expect(record.level).toBe(0);
    expect(record.help).toEqual({ hints: 0, best_moves: 0, takebacks: 0 });
  });

  it('a clean win counts toward promotion', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 0,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(countsTowardPromotion(record, DEFAULT_LADDER_POLICY, 0)).toBe(true);
  });

  it('reports the level it was played at, so a replay of a beaten opponent is not mistaken for a climb', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 2,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(countsTowardPromotion(record, DEFAULT_LADDER_POLICY, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`
Expected: FAIL — `record.completed` is `undefined`, `countsTowardPromotion` returns `false`.

- [ ] **Step 3: Rewrite `chessGameRecord.js`**

```javascript
/**
 * What a finished game leaves behind.
 *
 * Facts, not a score: moves and help are reported side by side rather than
 * compressed into one number, because a single number has to decide what a win
 * with three hints is worth — and whatever it decides, someone optimises the
 * number instead of the chess.
 *
 * The shape is not free. `completed`, `level` and the `help` block are exactly
 * what `countsTowardPromotion` in the shared ladder reads, and a record missing
 * any of them is silently uncounted — every game reads as help-heavy and nobody
 * is ever promoted. Help is nested here (rather than flat, as it once was) so
 * that this record and the archive's `help` block are the same shape, and a
 * reader of one can read the other.
 */
export function buildGameRecord({
  game, rungId, level = null, opponent = null, hints, bestMoves, takebacks = 0, startedAt, endedAt,
}) {
  if (!game?.status?.game_over) return null;
  const outcome = game.status.outcome;
  const result = outcome === 'checkmate'
    ? (game.status.winner === game.playerColor ? 'win' : 'loss')
    : 'draw';
  return {
    result,
    outcome,
    // Always true for a record that exists at all — the guard above refuses an
    // unfinished game. Written out because the ladder tests for it, and an
    // absent field there means "did not finish".
    completed: true,
    // Which rung this was played against. The ladder refuses to promote on a
    // game played against anyone other than the opponent being climbed, and
    // without this it cannot tell the difference.
    level: Number.isFinite(Number(level)) ? Number(level) : null,
    moves: Math.ceil((game.history?.length || 0) / 2),
    help: {
      hints: Math.max(0, hints || 0),
      best_moves: Math.max(0, bestMoves || 0),
      takebacks: Math.max(0, takebacks || 0),
    },
    rung: rungId || null,
    opponent,
    duration_ms: Math.max(0, (endedAt || 0) - (startedAt || 0)),
  };
}

export default { buildGameRecord };
```

- [ ] **Step 4: Update the two call sites in `PianoChessGame.jsx`**

Replace the `buildGameRecord` call (around line 624):

```javascript
    const record = buildGameRecord({
      game, rungId, level: ladderLevel,
      hints: helpUsed.hints, bestMoves: helpUsed.bestMoves, takebacks: helpUsed.takebacks,
      opponent: effectiveOpponentRef.current,
      startedAt: startedAtRef.current, endedAt: Date.now(),
    });
```

Replace the end-screen summary rows (around line 788) so they read the nested block:

```javascript
              {[
                ['Moves', finishedRecord.moves],
                ['Hints', finishedRecord.help.hints],
                ['Best moves', finishedRecord.help.best_moves],
                ['Takebacks', finishedRecord.help.takebacks],
              ].map(([label, value]) => (
```

`helpUsed.takebacks` does not exist yet and reads as `undefined` here; `buildGameRecord` clamps it to `0`. Task 7 adds the field.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS. `PianoChessGame.test.jsx` also exercises the summary — if an assertion there reads `finishedRecord.hints`, update it to `help.hints`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chessGameRecord.js \
        frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx
git commit -m "fix(piano-chess): game record carries the fields the promotion gate reads

countsTowardPromotion asks for completed, level and a help block; the record
wrote none of them, so every game was uncounted and no player could ever be
promoted off level 0."
```

---

### Task 2: Ladder policy — takeback ceiling and an unrestricted floor

**Files:**
- Modify: `shared/gaming/chess/ladder.mjs:71-79` (`DEFAULT_LADDER_POLICY`) and `:176-186` (`countsTowardPromotion`)
- Test: `shared/gaming/chess/ladder.test.mjs`

**Interfaces:**
- Consumes: `buildGameRecord`'s `help.takebacks` from Task 1.
- Produces: policy keys `max_takebacks` (default `1`) and `unrestricted_below_level` (default `0`), both honoured by `countsTowardPromotion(record, policy, currentLevel)`.

- [ ] **Step 1: Write the failing test**

Add to `ladder.test.mjs`, inside the `countsTowardPromotion` describe block (the file already defines `const game = (over = {}) => ({ completed: true, result: 'win', level: 0, help: { hints: 0, best_moves: 0 }, ...over })` and `POLICY`):

```javascript
  it('allows one takeback and refuses two', () => {
    expect(countsTowardPromotion(game({ help: { takebacks: 1 } }), POLICY, 0)).toBe(true);
    expect(countsTowardPromotion(game({ help: { takebacks: 2 } }), POLICY, 0)).toBe(false);
  });

  it('ignores every help ceiling below the unrestricted level', () => {
    const teaching = { ...POLICY, unrestricted_below_level: 3 };
    const leaned = game({ level: 2, help: { hints: 9, best_moves: 9, takebacks: 9 } });
    expect(countsTowardPromotion(leaned, teaching, 2)).toBe(true);
    expect(countsTowardPromotion({ ...leaned, level: 3 }, teaching, 3)).toBe(false);
  });

  it('defaults leave existing behaviour untouched', () => {
    expect(DEFAULT_LADDER_POLICY.max_takebacks).toBe(1);
    expect(DEFAULT_LADDER_POLICY.unrestricted_below_level).toBe(0);
    expect(countsTowardPromotion(game(), DEFAULT_LADDER_POLICY, 0)).toBe(true);
  });
```

Ensure `DEFAULT_LADDER_POLICY` is in the file's import list at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run shared/gaming/chess/ladder.test.mjs`
Expected: FAIL — `max_takebacks` is `undefined`, so `9 > undefined` is `false` and the two-takeback case wrongly counts.

- [ ] **Step 3: Extend the policy**

In `DEFAULT_LADDER_POLICY`, add the two keys and extend the doc comment above it:

```javascript
/**
 * Promotion policy. Every number here is a judgement call, which is why they
 * live in YAML rather than in this file's constants.
 *
 * `max_best_moves: 0` — asking the engine for the best move is the engine
 * taking the turn. `max_hints: 1` — one look at what can legally move is a
 * child orienting themselves, not being carried. `max_takebacks: 1` follows the
 * hint rather than the best move: one slip corrected is a child noticing their
 * own mistake, which is the thing we want to encourage; a second is being
 * carried through the game.
 *
 * `unrestricted_below_level` exempts the bottom of the ladder from all three
 * ceilings, so the first rungs can teach the game before they teach the
 * discipline. Zero — the default — means the ceilings apply everywhere, which
 * is the behaviour this policy had before the key existed.
 */
export const DEFAULT_LADDER_POLICY = Object.freeze({
  window: 7,
  wins_required: 5,
  max_hints: 1,
  max_best_moves: 0,
  max_takebacks: 1,
  unrestricted_below_level: 0,
  movetime_ms: 400,
});
```

Then `countsTowardPromotion`:

```javascript
export function countsTowardPromotion(record, policy, currentLevel) {
  if (!record || !record.completed) return false;
  if (Number(record.level) !== currentLevel) return false;
  // The first rungs teach the game, not the discipline. Below this level a
  // game counts however much help was leant on — the ceilings resume above it.
  if (currentLevel < Number(policy.unrestricted_below_level || 0)) return true;
  const help = record.help || {};
  if (Number(help.best_moves || 0) > Number(policy.max_best_moves)) return false;
  if (Number(help.hints || 0) > Number(policy.max_hints)) return false;
  if (Number(help.takebacks || 0) > Number(policy.max_takebacks)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run shared/gaming/chess/ladder.test.mjs`
Expected: PASS, all previously-passing cases included.

- [ ] **Step 5: Commit**

```bash
git add shared/gaming/chess/ladder.mjs shared/gaming/chess/ladder.test.mjs
git commit -m "feat(chess): ladder policy gains max_takebacks and unrestricted_below_level"
```

---

### Task 3: `takeMoveBack()` — the rewind itself

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessGameState.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessGameState.test.js`

**Interfaces:**
- Consumes: `undoMove` from `@shared-gaming/chess/index.mjs`.
- Produces: `takeMoveBack(state)` → `{ state, event }` where `event` is either `{ type: 'took_back', plies, restoredFen, undone }` or the standard `{ type: 'rejected', reason, square, seq }`. Game state gains `undoneHistory: []`, an array of history entries each carrying `ply`, `undone_at_ply`, and `undone_seq`. Task 5 reads it; Task 7 calls the function.

- [ ] **Step 1: Write the failing test**

Add to `chessGameState.test.js` (the file already has the `play` and `firstMovableSquare` helpers):

```javascript
import { takeMoveBack } from './chessGameState.js';

describe('taking a move back', () => {
  // A fixed seed keeps the dealt chord map stable so the assertions can name it.
  const start = () => createChessGameState({ seed: 7 });

  it('refuses when the player has not moved yet', () => {
    const { state, event } = takeMoveBack(start());
    expect(event.type).toBe('rejected');
    expect(event.reason).toBe('nothing_to_take_back');
    expect(state.history).toHaveLength(0);
  });

  it('rewinds the player move and the opponent answer together', () => {
    const state = start();
    const from = firstMovableSquare(state);
    const to = destinationsFor(state, from)[0];
    const afterMine = commitMove(state, from, to).state;
    const reply = Object.keys(legalDestinationsOf(afterMine))[0];
    const afterTheirs = commitMove(afterMine, reply, destinationsFor(afterMine, reply)[0]).state;
    expect(afterTheirs.history).toHaveLength(2);

    const { state: rewound, event } = takeMoveBack(afterTheirs);
    expect(event.type).toBe('took_back');
    expect(event.plies).toBe(2);
    expect(rewound.game.fen).toBe(state.game.fen);
    expect(rewound.history).toHaveLength(0);
    expect(rewound.undoneHistory).toHaveLength(2);
    expect(isPlayerTurn(rewound)).toBe(true);
  });

  it('rewinds one ply when the opponent has not answered', () => {
    const state = start();
    const from = firstMovableSquare(state);
    const afterMine = commitMove(state, from, destinationsFor(state, from)[0]).state;

    const { state: rewound, event } = takeMoveBack(afterMine);
    expect(event.plies).toBe(1);
    expect(rewound.game.fen).toBe(state.game.fen);
    expect(rewound.undoneHistory).toHaveLength(1);
  });

  it('restores the chord map the player was reading when they moved', () => {
    const state = createChessGameState({ seed: 7, shuffleEachTurn: true });
    const from = firstMovableSquare(state);
    const afterMine = commitMove(state, from, destinationsFor(state, from)[0]).state;
    const { state: rewound } = takeMoveBack(afterMine);
    expect(rewound.scheme.id).toBe(state.scheme.id);
  });

  it('clears anything in hand and any standing refusal', () => {
    const state = start();
    const from = firstMovableSquare(state);
    const afterMine = commitMove(state, from, destinationsFor(state, from)[0]).state;
    // A piece in hand and a refusal on screen both describe a board that is
    // about to be taken away, so neither may survive the rewind.
    const cluttered = { ...afterMine, origin: from, rejection: { reason: 'empty_square', seq: 3 } };
    const { state: rewound } = takeMoveBack(cluttered);
    expect(rewound.origin).toBe(null);
    expect(rewound.rejection).toBe(null);
  });

  it('records when each rewind happened', () => {
    const state = start();
    const from = firstMovableSquare(state);
    const afterMine = commitMove(state, from, destinationsFor(state, from)[0]).state;
    const { state: rewound } = takeMoveBack(afterMine);
    expect(rewound.undoneHistory[0].ply).toBe(1);
    expect(rewound.undoneHistory[0].undone_at_ply).toBe(1);
    expect(rewound.undoneHistory[0].undone_seq).toBe(1);
  });

  it('keeps two rewind episodes distinguishable even when they land on the same ply', () => {
    // The collision `undone_at_ply` alone cannot survive: a rewind trims
    // history, so playing and unplaying twice in a row produces two episodes
    // that both happened "at ply 1".
    const state = start();
    const first = firstMovableSquare(state);
    const afterFirst = commitMove(state, first, destinationsFor(state, first)[0]).state;
    const rewoundOnce = takeMoveBack(afterFirst).state;

    const second = firstMovableSquare(rewoundOnce);
    const afterSecond = commitMove(rewoundOnce, second, destinationsFor(rewoundOnce, second)[0]).state;
    const rewoundTwice = takeMoveBack(afterSecond).state;

    expect(rewoundTwice.undoneHistory).toHaveLength(2);
    expect(rewoundTwice.undoneHistory.map((entry) => entry.undone_at_ply)).toEqual([1, 1]);
    expect(rewoundTwice.undoneHistory.map((entry) => entry.undone_seq)).toEqual([1, 2]);
  });

  it('refuses once the game is over', () => {
    // Fool's mate: the game ends, and the board must not be rewindable past it.
    const mated = createChessGameState({
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
      playerColor: 'w',
    });
    const { event } = takeMoveBack(mated);
    expect(event.type).toBe('rejected');
    expect(event.reason).toBe('game_over');
  });
});
```

Add this helper next to `firstMovableSquare` in the same file:

```javascript
// Every square the side to move could lift right now, whoever that is.
// `playableSources` answers only for the player, and these tests need to drive
// the opponent's reply by hand.
import { legalDestinations } from '@shared-gaming/chess/index.mjs';
const legalDestinationsOf = (state) => legalDestinations(state.game.fen);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/chessGameState.test.js`
Expected: FAIL with `takeMoveBack is not a function`.

- [ ] **Step 3: Implement `takeMoveBack`**

Extend the import at the top of `chessGameState.js`:

```javascript
import {
  createGame, describeGame, fenToPosition, legalDestinations, playMove, undoMove,
} from '@shared-gaming/chess/index.mjs';
```

Add `undoneHistory: []` to the `base` object in `createChessGameState`, directly after `history: []`:

```javascript
    history: [],
    // Moves that were played and then taken back. They leave `history` — that
    // list is the game being played, and the board, the captured rail and the
    // move count all read it — but they are the most interesting thing in a
    // child's game, so they are kept here for the archive rather than dropped.
    undoneHistory: [],
```

Add the transition after `commitMove`:

```javascript
/**
 * Takes the player's last move back, and the opponent's answer with it.
 *
 * The unit is the round trip, not the ply. A player who undoes only their own
 * move lands on a board they never faced — the opponent's reply still standing,
 * their own piece back home — and there is no way to explain that position to a
 * child. Rewinding both puts them exactly where they were when they chose.
 *
 * Allowed while the opponent is thinking, and that is not an edge case: it is
 * the moment a player actually notices. Only one ply comes off then, because
 * the answer has not landed. The opponent effect's own cancellation handles the
 * request already in flight.
 *
 * The chord map needs no special handling. `schemeForPly` is a pure function of
 * the seed and the turn, so rewinding re-derives exactly the map the player was
 * reading when they moved — which is the only map their memory of the board
 * matches.
 */
export function takeMoveBack(state) {
  if (state.status?.game_over) return reject(state, 'game_over', null);

  const history = state.history;
  // An explicit reverse walk rather than findLastIndex: the kiosk runs a 2018
  // WebView, and this is on the path of a gesture that must never throw.
  let lastOwnIndex = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].color === state.playerColor) { lastOwnIndex = i; break; }
  }
  if (lastOwnIndex < 0) return reject(state, 'nothing_to_take_back', null);

  const plies = history.length - lastOwnIndex;
  let game = state.game;
  for (let i = 0; i < plies; i += 1) game = undoMove(game);

  // Which rewind this was, counted from the ones already recorded rather than
  // held in a field of its own. `undone_at_ply` cannot do this job alone: a
  // rewind TRIMS history, so a player who plays one move, takes it back, plays
  // a different move and takes that back produces two episodes both reading
  // `undone_at_ply: 1` — the same number for two unrelated moments.
  let priorSeq = 0;
  for (const entry of state.undoneHistory || []) {
    if ((entry.undone_seq || 0) > priorSeq) priorSeq = entry.undone_seq;
  }
  const undone = history.slice(lastOwnIndex).map((entry, offset) => ({
    ...entry,
    ply: lastOwnIndex + offset + 1,
    // Where the board stood when this came off. Both plies of one rewind share
    // it, and it is true of the position — but it repeats across episodes.
    undone_at_ply: history.length,
    // Which rewind took it. Both plies of one rewind share this too, and no
    // two episodes ever do, so a reader can group and order them.
    undone_seq: priorSeq + 1,
  }));
  const nextHistory = history.slice(0, lastOwnIndex);
  const previous = nextHistory.length ? nextHistory[nextHistory.length - 1] : null;

  const next = {
    ...state,
    game,
    origin: null,
    rejection: null,
    lastMove: previous ? { from: previous.from, to: previous.to } : null,
    status: describeGame(game),
    history: nextHistory,
    undoneHistory: [...(state.undoneHistory || []), ...undone],
  };
  return {
    state: { ...next, scheme: schemeForPly(next, game.moves.length) },
    event: { type: 'took_back', plies, restoredFen: game.fen, undone },
  };
}
```

Add the refusal string to `REJECTION_MESSAGES`:

```javascript
  nothing_to_take_back: 'There is nothing to take back yet.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/chessGameState.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chessGameState.js \
        frontend/src/modules/Piano/PianoChessGame/chessGameState.test.js
git commit -m "feat(piano-chess): takeMoveBack rewinds the player move and the reply together"
```

---

### Task 4: The takeback budget

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/takebackBudget.js`
- Test (create): `frontend/src/modules/Piano/PianoChessGame/takebackBudget.test.js`

**Interfaces:**
- Consumes: the merged chess config object (as fetched by `fetchChessConfig`) and the ladder's `policy` block (as returned by `GET /api/v1/chess/ladder`).
- Produces: `takebackLimits(config)`, `checkTakeback({ config, used, movesSinceLast })` → `{ allowed, reason, remaining, movesLeft, limits }`, `willStillCount({ policy, used })` → boolean, `takebackRefusalMessage(check)` → string, `takebackNote({ check, willCount, opponentName })` → string, `playerMoveCount(history, playerColor)` → number.

- [ ] **Step 1: Write the failing test**

Create `takebackBudget.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import {
  checkTakeback, playerMoveCount, takebackLimits, takebackNote,
  takebackRefusalMessage, willStillCount,
} from './takebackBudget.js';

describe('takeback limits from config', () => {
  it('defaults to three a game and no cooldown', () => {
    expect(takebackLimits(null)).toEqual({ max_per_game: 3, cooldown_moves: 0 });
  });

  it('reads the config', () => {
    const config = { help: { takebacks: { max_per_game: 1, cooldown_moves: 4 } } };
    expect(takebackLimits(config)).toEqual({ max_per_game: 1, cooldown_moves: 4 });
  });

  it('treats an explicit null cap as unlimited, which a missing key is not', () => {
    expect(takebackLimits({ help: { takebacks: { max_per_game: null } } }).max_per_game).toBe(null);
    expect(takebackLimits({ help: { takebacks: {} } }).max_per_game).toBe(3);
  });

  it('refuses a nonsense cap rather than passing it on', () => {
    expect(takebackLimits({ help: { takebacks: { max_per_game: 'lots' } } }).max_per_game).toBe(3);
    expect(takebackLimits({ help: { takebacks: { max_per_game: -2 } } }).max_per_game).toBe(0);
  });
});

describe('whether a takeback may be played now', () => {
  const config = { help: { takebacks: { max_per_game: 2, cooldown_moves: 0 } } };

  it('allows one while the budget holds and reports what is left', () => {
    expect(checkTakeback({ config, used: 0 })).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkTakeback({ config, used: 1 })).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('refuses once the budget is spent', () => {
    const check = checkTakeback({ config, used: 2 });
    expect(check).toMatchObject({ allowed: false, reason: 'no_takebacks_left', remaining: 0 });
  });

  it('never runs out when the cap is null', () => {
    const unlimited = { help: { takebacks: { max_per_game: null } } };
    expect(checkTakeback({ config: unlimited, used: 99 })).toMatchObject({ allowed: true, remaining: null });
  });

  it('holds a takeback back until the cooldown has run', () => {
    const cooling = { help: { takebacks: { max_per_game: 3, cooldown_moves: 3 } } };
    expect(checkTakeback({ config: cooling, used: 1, movesSinceLast: 1 }))
      .toMatchObject({ allowed: false, reason: 'cooling_down', movesLeft: 2 });
    expect(checkTakeback({ config: cooling, used: 1, movesSinceLast: 3 })).toMatchObject({ allowed: true });
  });

  it('does not cool down before the first takeback of a game', () => {
    const cooling = { help: { takebacks: { max_per_game: 3, cooldown_moves: 3 } } };
    expect(checkTakeback({ config: cooling, used: 0, movesSinceLast: null })).toMatchObject({ allowed: true });
  });
});

describe('whether the next takeback keeps the game counting', () => {
  it('follows the ladder ceiling', () => {
    expect(willStillCount({ policy: { max_takebacks: 1 }, used: 0 })).toBe(true);
    expect(willStillCount({ policy: { max_takebacks: 1 }, used: 1 })).toBe(false);
    expect(willStillCount({ policy: { max_takebacks: 0 }, used: 0 })).toBe(false);
  });

  it('assumes the default ceiling when no policy has loaded', () => {
    expect(willStillCount({ policy: null, used: 0 })).toBe(true);
  });
});

describe('what the game says about it', () => {
  it('names the number of moves left to wait, in the plural it needs', () => {
    expect(takebackRefusalMessage({ reason: 'cooling_down', movesLeft: 1 }))
      .toBe('You can take another move back in 1 move.');
    expect(takebackRefusalMessage({ reason: 'cooling_down', movesLeft: 2 }))
      .toBe('You can take another move back in 2 moves.');
  });

  it('says plainly when the budget is gone', () => {
    expect(takebackRefusalMessage({ reason: 'no_takebacks_left' })).toBe('No takebacks left this game.');
  });

  it('warns on the card when the next one would stop the game counting', () => {
    const check = { allowed: true, remaining: 2 };
    expect(takebackNote({ check, willCount: true, opponentName: 'Pip' })).toBe('2 left');
    expect(takebackNote({ check, willCount: false, opponentName: 'Pip' }))
      .toBe("won't count against Pip");
    expect(takebackNote({ check: { allowed: false, reason: 'no_takebacks_left', remaining: 0 }, willCount: false }))
      .toBe('none left');
  });
});

describe('counting the player own moves', () => {
  it('counts only theirs', () => {
    const history = [{ color: 'w' }, { color: 'b' }, { color: 'w' }];
    expect(playerMoveCount(history, 'w')).toBe(2);
    expect(playerMoveCount(history, 'b')).toBe(1);
    expect(playerMoveCount(null, 'w')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/takebackBudget.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `takebackBudget.js`**

```javascript
/**
 * What a takeback costs, and whether one may be played right now.
 *
 * Two different questions, deliberately kept apart. The CAP is what the player
 * feels at the keys — three a game, or a cooldown between them — and it is
 * answered here, on the kiosk, because it has to be answered instantly and
 * because getting it wrong costs nothing but a toast. The CEILING is whether a
 * game still counts toward beating the opponent being climbed, and that is
 * decided by the server's ladder, never here: `willStillCount` only predicts
 * it, so the card can warn honestly before the player spends one.
 *
 * Knows nothing about chess. The caller supplies the tallies.
 */

export const DEFAULT_TAKEBACK_LIMITS = Object.freeze({ max_per_game: 3, cooldown_moves: 0 });

/** The ladder's own default, mirrored so a card can warn before the ladder loads. */
const DEFAULT_MAX_TAKEBACKS = 1;

function wholeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export function takebackLimits(config) {
  const limits = config?.help?.takebacks || {};
  // `null` is a real answer here — "no cap" — and it must not be confused with
  // an absent key, which means "use the house default".
  const max = limits.max_per_game === null
    ? null
    : wholeNumber(limits.max_per_game, DEFAULT_TAKEBACK_LIMITS.max_per_game);
  return {
    max_per_game: max,
    cooldown_moves: wholeNumber(limits.cooldown_moves, DEFAULT_TAKEBACK_LIMITS.cooldown_moves),
  };
}

/**
 * @param {object}      args
 * @param {object}      args.config          merged chess config
 * @param {number}      args.used            takebacks already spent this game
 * @param {number|null} args.movesSinceLast  the player's own moves since the
 *   last takeback, or null when there has not been one yet
 */
export function checkTakeback({ config, used = 0, movesSinceLast = null }) {
  const limits = takebackLimits(config);
  const remaining = limits.max_per_game === null ? null : Math.max(0, limits.max_per_game - used);

  if (limits.max_per_game !== null && used >= limits.max_per_game) {
    return { allowed: false, reason: 'no_takebacks_left', remaining: 0, movesLeft: 0, limits };
  }
  if (limits.cooldown_moves > 0 && movesSinceLast !== null && movesSinceLast < limits.cooldown_moves) {
    return {
      allowed: false,
      reason: 'cooling_down',
      remaining,
      movesLeft: limits.cooldown_moves - movesSinceLast,
      limits,
    };
  }
  return { allowed: true, reason: null, remaining, movesLeft: 0, limits };
}

/**
 * Would the NEXT takeback leave this game still counting toward promotion?
 *
 * A prediction of the server's decision, used only to warn. The ladder is still
 * the authority, and it re-decides from the record when the game is filed.
 */
export function willStillCount({ policy, used = 0 }) {
  const ceiling = Number(policy?.max_takebacks ?? DEFAULT_MAX_TAKEBACKS);
  if (!Number.isFinite(ceiling)) return true;
  return used + 1 <= ceiling;
}

export function takebackRefusalMessage(check) {
  if (check?.reason === 'cooling_down') {
    const moves = Math.max(1, Number(check.movesLeft) || 1);
    return `You can take another move back in ${moves} ${moves === 1 ? 'move' : 'moves'}.`;
  }
  if (check?.reason === 'no_takebacks_left') return 'No takebacks left this game.';
  return 'You cannot take a move back right now.';
}

/**
 * The line under the gesture card. It has one job: let a player decide whether
 * to spend one BEFORE they do, which means the cost that actually matters —
 * the game no longer counting — has to outrank the number remaining.
 */
export function takebackNote({ check, willCount, opponentName = null }) {
  if (!check?.allowed) {
    return check?.reason === 'cooling_down' ? 'not yet' : 'none left';
  }
  if (!willCount && opponentName) return `won't count against ${opponentName}`;
  if (!willCount) return "won't count toward the climb";
  if (check.remaining === null) return 'as many as you like';
  return `${check.remaining} left`;
}

/** How many moves the player themselves has made — the unit the cooldown counts in. */
export function playerMoveCount(history, playerColor) {
  return (history || []).filter((entry) => entry?.color === playerColor).length;
}

export default {
  DEFAULT_TAKEBACK_LIMITS, takebackLimits, checkTakeback, willStillCount,
  takebackRefusalMessage, takebackNote, playerMoveCount,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/takebackBudget.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/takebackBudget.js \
        frontend/src/modules/Piano/PianoChessGame/takebackBudget.test.js
git commit -m "feat(piano-chess): takeback budget — per-game cap, cooldown, and ladder warning"
```

---

### Task 5: The archive keeps the rewound blunder

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessGameArchive.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessGameArchive.test.js`

**Interfaces:**
- Consumes: `game.undoneHistory` from Task 3.
- Produces: `buildGameArchive({ ..., takebacks })` whose `moves` array interleaves undone plies (`undone: true`, `undone_at_ply`) with the surviving line, and whose `help` block gains `takebacks`.

- [ ] **Step 1: Write the failing test**

Add to `chessGameArchive.test.js`:

```javascript
describe('rewound moves in the archive', () => {
  const game = {
    playerColor: 'w',
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    game: { fen: 'after', moves: ['Nf3'] },
    status: { game_over: false },
    scheme: { id: 'chords-default' },
    history: [{ san: 'Nf3', from: 'g1', to: 'f3', color: 'w', captured: null, chords: ['G', 'F'] }],
    undoneHistory: [
      { san: 'Qh5', from: 'd1', to: 'h5', color: 'w', captured: null, chords: ['D', 'H'], ply: 1, undone_at_ply: 1 },
    ],
  };

  it('keeps the taken-back move, marked, in the order it was played', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive.moves).toHaveLength(2);
    expect(archive.moves[0]).toMatchObject({ san: 'Qh5', undone: true, undone_at_ply: 1, ply: 1 });
    expect(archive.moves[1]).toMatchObject({ san: 'Nf3', undone: false, ply: 1 });
  });

  it('counts only the line that was actually played', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive.move_count).toBe(1);
    expect(archive.help).toEqual({ hints: 0, best_moves: 0, takebacks: 1 });
  });

  it('replays cleanly once the undone moves are filtered out', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    const played = archive.moves.filter((move) => !move.undone).map((move) => move.san);
    expect(played).toEqual(['Nf3']);
  });

  it('is still a game when every move was taken back', () => {
    const allRewound = { ...game, history: [], undoneHistory: game.undoneHistory };
    const archive = buildGameArchive({
      game: allRewound, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive).not.toBe(null);
    expect(archive.move_count).toBe(0);
    expect(archive.moves).toHaveLength(1);
  });

  it('is still not a game when nothing was played at all', () => {
    const untouched = { ...game, history: [], undoneHistory: [] };
    expect(buildGameArchive({
      game: untouched, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    })).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/chessGameArchive.test.js`
Expected: FAIL — `moves` has one entry, `help` has no `takebacks`.

- [ ] **Step 3: Update `buildGameArchive`**

Change the signature to accept `takebacks = 0`, extend the guard, replace the `moves` construction, and extend `help`. Replace the `if (!history.length) return null;` guard with:

```javascript
  const history = Array.isArray(game?.history) ? game.history : [];
  const rewound = Array.isArray(game?.undoneHistory) ? game.undoneHistory : [];
  // A game with no moves is not a game. Recording it would bury the real ones
  // under a file per accidental visit to the screen. A game whose every move
  // was taken back IS one, though — a child who played and unplayed a move sat
  // down and tried something, and that is the thing worth knowing.
  if (!history.length && !rewound.length) return null;
```

Add this serializer above `buildGameArchive`:

```javascript
/** One move, in both notations. Shared by the played line and the rewound one. */
function serializeMove(entry, ply, undone) {
  return {
    ply,
    san: entry.san,
    from: entry.from,
    to: entry.to,
    color: entry.color,
    captured: entry.captured || null,
    // The two addresses the player performed it with, origin then destination.
    played: Array.isArray(entry.chords) ? entry.chords.filter(Boolean) : [],
    undone,
    ...(undone ? { undone_at_ply: entry.undone_at_ply ?? ply } : {}),
  };
}
```

Replace the `move_count` and `moves` fields:

```javascript
    move_count: history.length,
    // The played line and the abandoned ones, in the order they happened. A
    // replayer filters `undone` out and reaches `final_fen`; an analyzer reads
    // them and finds the moment the game actually turned. Sorted by the ply
    // each was played at, with the rewound move first when both share one —
    // because it was played first, and then unplayed.
    moves: [
      ...rewound.map((entry) => serializeMove(entry, entry.ply, true)),
      ...history.map((entry, index) => serializeMove(entry, index + 1, false)),
    ].sort((a, b) => (a.ply - b.ply) || (a.undone === b.undone ? 0 : (a.undone ? -1 : 1))),
```

And the help block:

```javascript
    help: {
      hints: Math.max(0, hints || 0),
      best_moves: Math.max(0, bestMoves || 0),
      takebacks: Math.max(0, takebacks || 0),
    },
```

Update the JSDoc block above the function to document `@param {number} args.takebacks`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/chessGameArchive.test.js`
Expected: PASS, existing archive tests included.

- [ ] **Step 5: Note the router guard still holds**

`POST /api/v1/chess/history` rejects a body whose `moves` array is empty. An all-rewound game now sends a non-empty `moves`, so it is accepted — that is intended. No backend change.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chessGameArchive.js \
        frontend/src/modules/Piano/PianoChessGame/chessGameArchive.test.js
git commit -m "feat(piano-chess): archive keeps taken-back moves, marked and in order"
```

---

### Task 6: A gesture card that can say "twice"

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/GestureCards.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/GestureCards.scss`
- Test (create): `frontend/src/modules/Piano/PianoChessGame/GestureCards.test.jsx`

**Interfaces:**
- Produces: `GestureCards` accepts an optional `repeat` number per gesture; when `> 1` it renders `<span className="gesture-card__repeat">×N</span>` inside a new `.gesture-card__figure` wrapper.

- [ ] **Step 1: Write the failing test**

Create `GestureCards.test.jsx`:

```javascript
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GestureCards from './GestureCards.jsx';

describe('gesture cards', () => {
  it('draws the keys and the words for each gesture', () => {
    render(<GestureCards gestures={[{ id: 'octave', pressed: [0, 12], title: 'Put it back', note: 'when holding a piece' }]} />);
    expect(screen.getByText('Put it back')).toBeInTheDocument();
    expect(screen.getByText('when holding a piece')).toBeInTheDocument();
  });

  it('marks a gesture that has to be played more than once', () => {
    const { container } = render(
      <GestureCards gestures={[{ id: 'takeback', pressed: [0, 12], repeat: 2, title: 'Take it back', note: '3 left' }]} />,
    );
    expect(container.querySelector('.gesture-card__repeat').textContent).toBe('×2');
  });

  it('says nothing about repeats for a gesture played once', () => {
    const { container } = render(
      <GestureCards gestures={[{ id: 'octave', pressed: [0, 12], title: 'Put it back' }]} />,
    );
    expect(container.querySelector('.gesture-card__repeat')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/GestureCards.test.jsx`
Expected: FAIL — `.gesture-card__repeat` is null in the second test.

- [ ] **Step 3: Add the badge**

In `GestureCards.jsx`, replace the bare `<KeyDiagram ... />` inside the list item with a wrapper:

```jsx
          <div className="gesture-card__figure">
            <KeyDiagram pressed={gesture.pressed} />
            {gesture.repeat > 1 && (
              /* Drawn rather than written into the title: "play this twice" is
                 the same instruction the board already gives for picking a
                 piece up, and a child who has learned that reads the badge
                 without being told what it means. */
              <span className="gesture-card__repeat">{`×${gesture.repeat}`}</span>
            )}
          </div>
```

Update the JSDoc above the component: `{id, pressed, title, note, active, muted, repeat}`.

In `GestureCards.scss`, add after `.gesture-card__keys`:

```scss
.gesture-card__figure {
  position: relative;
  display: block;
}

/* Sits on the diagram rather than beside it: the column is 4.6rem wide and a
   second element in it would squeeze the keys until they stopped reading as
   keys. */
.gesture-card__repeat {
  position: absolute;
  right: -0.1rem;
  bottom: -0.35rem;
  padding: 0 0.25rem;
  border-radius: var(--r-sm, 6px);
  background: var(--piano-accent);
  color: var(--piano-bg, #16161b);
  font-size: var(--t-cap);
  line-height: 1.4;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/GestureCards.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/GestureCards.jsx \
        frontend/src/modules/Piano/PianoChessGame/GestureCards.scss \
        frontend/src/modules/Piano/PianoChessGame/GestureCards.test.jsx
git commit -m "feat(piano-chess): gesture cards can mark a gesture played twice"
```

---

### Task 7: Wire the takeback into the game

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx`
- Test: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`

**Interfaces:**
- Consumes: `takeMoveBack` (Task 3), `checkTakeback`/`willStillCount`/`takebackRefusalMessage`/`takebackNote`/`playerMoveCount` (Task 4), `DOUBLE_WINDOW_MS` (already imported from `chordSelection.js`), `repeat` on gesture cards (Task 6).
- Produces: `helpUsed` gains `takebacks`; `promptFor` gains a fifth argument `takebackArmed`.

- [ ] **Step 1: Write the failing test**

`PianoChessGame.test.jsx` already drives the component through a fake MIDI context — read its existing helpers first and reuse them rather than inventing a second harness. Add:

```javascript
import { promptFor } from './PianoChessGame.jsx';

describe('the takeback prompt', () => {
  const playing = {
    status: { game_over: false, turn: 'w', check: false },
    playerColor: 'w',
    origin: null,
  };

  it('says what a second octave will do once the first has been played', () => {
    expect(promptFor(playing, null, null, false, true))
      .toBe('Play the octave again to take your move back.');
  });

  it('says so even while the opponent is thinking, which is when it is wanted', () => {
    const theirTurn = { ...playing, status: { ...playing.status, turn: 'b' } };
    expect(promptFor(theirTurn, null, null, false, true))
      .toBe('Play the octave again to take your move back.');
  });

  it('goes back to the ordinary instruction when nothing is armed', () => {
    expect(promptFor(playing, null, null, false, false))
      .toBe("Play a piece's chord twice to pick it up.");
  });

  it('never talks over a refusal', () => {
    expect(promptFor(playing, { reason: 'empty_square' }, null, false, true))
      .toBe('Nothing on that square.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`
Expected: FAIL — the armed cases return the ordinary instruction.

- [ ] **Step 3: Extend `promptFor`**

```javascript
export function promptFor(state, rejection, hoveredChord = null, reading = false, takebackArmed = false) {
  if (state.status?.game_over) {
    if (state.status.outcome === 'checkmate') {
      return state.status.winner === state.playerColor ? 'Checkmate. You win.' : 'Checkmate. Your opponent wins.';
    }
    return `Draw — ${state.status.outcome.replace(/_/g, ' ')}.`;
  }
  if (rejection) return REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.';
  // Before the turn check on purpose: the moment a player wants this most is
  // while the opponent is still answering the move they regret.
  if (takebackArmed) return 'Play the octave again to take your move back.';
  if (!isPlayerTurn(state)) return 'Your opponent is thinking.';
  ...unchanged...
}
```

- [ ] **Step 4: Add the imports and the state**

Imports:

```javascript
import {
  REJECTION_MESSAGES, applySquare, capturedPieces, clearSelection, commitMove,
  createChessGameState, destinationsFor, isPlayerTurn, playableSources, takeMoveBack,
} from './chessGameState.js';
import {
  checkTakeback, playerMoveCount, takebackNote, takebackRefusalMessage, willStillCount,
} from './takebackBudget.js';
```

Change the `helpUsed` initial state:

```javascript
  const [helpUsed, setHelpUsed] = useState({ hints: 0, bestMoves: 0, takebacks: 0 });
```

Add, next to the other refs near `gameRef`:

```javascript
  // The takeback is the octave gesture played twice, which means the tick loop
  // has to remember the first one. A ref rather than state: the tick reads it
  // on the same pass it writes it, and a re-render in between would lose the
  // window.
  const lastEscapeAtRef = useRef(0);
  // Where the cooldown counts from — the player's own move count at the last
  // takeback, or null when there has not been one this game.
  const lastTakebackAtRef = useRef(null);
  const [takebackArmed, setTakebackArmed] = useState(false);
  // The tick effect and the takeback callback are both mount-stable, so
  // everything they read of the render's values has to arrive by ref.
  const chessConfigRef = useRef(null);
  chessConfigRef.current = chessConfig;
  const helpUsedRef = useRef(helpUsed);
  helpUsedRef.current = helpUsed;
  const ladderPolicyRef = useRef(null);
  ladderPolicyRef.current = ladder?.policy ?? null;
```

- [ ] **Step 5: Add the takeback callback**

Place it just above `cancelSelection`:

```javascript
  /**
   * The rewind, budget first.
   *
   * The budget is checked before the rules are, so a player out of takebacks is
   * told that rather than being told there is nothing to take back — two very
   * different sentences, and only one of them is true.
   */
  const attemptTakeback = useCallback(() => {
    const current = gameRef.current;
    const used = helpUsedRef.current.takebacks;
    const since = lastTakebackAtRef.current === null
      ? null
      : playerMoveCount(current.history, current.playerColor) - lastTakebackAtRef.current;
    const check = checkTakeback({ config: chessConfigRef.current, used, movesSinceLast: since });
    if (!check.allowed) {
      setToast({ text: takebackRefusalMessage(check), seq: `takeback-${Date.now()}` });
      logger().info('takeback-refused', { reason: check.reason, remaining: check.remaining });
      return;
    }

    const { state, event } = takeMoveBack(current);
    if (event.type === 'rejected') {
      setToast({
        text: REJECTION_MESSAGES[event.reason] ?? 'You cannot take a move back right now.',
        seq: `takeback-${Date.now()}`,
      });
      logger().info('takeback-refused', { reason: event.reason, remaining: check.remaining });
      return;
    }

    const willCount = willStillCount({ policy: ladderPolicyRef.current, used });
    setGame(state);
    setHelpUsed((prev) => ({ ...prev, takebacks: prev.takebacks + 1 }));
    lastTakebackAtRef.current = playerMoveCount(state.history, state.playerColor);
    setToast({
      text: `Took back ${event.undone.map((entry) => entry.san).join(' and ')}.`,
      seq: `takeback-${Date.now()}`,
    });
    logger().info('takeback', {
      plies: event.plies,
      undone_san: event.undone.map((entry) => entry.san),
      remaining: check.remaining === null ? null : check.remaining - 1,
      will_count: willCount,
    });
  }, []);
```

- [ ] **Step 6: Route the octave in the cursor tick**

Replace the existing `escape` branch inside `tick`:

```javascript
      if (event.type === 'escape') {
        setCursor(null);
        const current = gameRef.current;
        const at = Date.now();
        if (current.status?.game_over) {
          restart();
        } else if (current.origin) {
          // A piece in hand is the first thing an octave means, and always has
          // been. Putting it back also restarts the double window, so the very
          // next octave arms the takeback rather than firing it.
          cancelSelection();
          lastEscapeAtRef.current = 0;
          setTakebackArmed(false);
        } else if (at - lastEscapeAtRef.current <= DOUBLE_WINDOW_MS) {
          lastEscapeAtRef.current = 0;
          setTakebackArmed(false);
          attemptTakeback();
        } else {
          // With nothing in hand this used to do nothing at all, silently. Now
          // it says what a second one would do — which is both how the gesture
          // is discovered and why an idle octave can never rewind a game by
          // accident.
          lastEscapeAtRef.current = at;
          setTakebackArmed(true);
          logger().info('takeback-armed', { moves_played: current.history.length });
        }
      }
```

Add `attemptTakeback` to the tick effect's dependency array.

- [ ] **Step 7: Disarm when the window lapses**

Add near the other effects:

```javascript
  // The armed prompt has to expire with the window it describes, or it would
  // stand there offering a takeback that the next octave no longer performs.
  useEffect(() => {
    if (!takebackArmed) return undefined;
    const timer = setTimeout(() => setTakebackArmed(false), DOUBLE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [takebackArmed]);
```

- [ ] **Step 8: Add the card, the prompt argument, and the reset**

Compute above the return, near `hintTargets`:

```javascript
  const takebackCheck = checkTakeback({
    config: chessConfig,
    used: helpUsed.takebacks,
    movesSinceLast: lastTakebackAtRef.current === null
      ? null
      : playerMoveCount(game.history, game.playerColor) - lastTakebackAtRef.current,
  });
  const takebackWillCount = willStillCount({ policy: ladder?.policy ?? null, used: helpUsed.takebacks });
```

Add a fourth entry to the `GestureCards` `gestures` array:

```javascript
              {
                id: 'takeback',
                pressed: [0, 12],
                repeat: 2,
                title: 'Take it back',
                note: takebackNote({
                  check: takebackCheck,
                  willCount: takebackWillCount,
                  opponentName: opponent?.name ?? null,
                }),
                active: takebackArmed,
                muted: !takebackCheck.allowed,
              },
```

Pass the new prompt argument:

```javascript
  const prompt = promptFor(game, game.rejection, pickupChord, reading, takebackArmed);
```

Pass the tally to the archive inputs — add `takebacks: helpUsed.takebacks` to `archiveInputsRef.current` and to the `buildGameArchive` call in the game-over effect.

In `restart()`, add:

```javascript
    setHelpUsed({ hints: 0, bestMoves: 0, takebacks: 0 });
    lastEscapeAtRef.current = 0;
    lastTakebackAtRef.current = null;
    setTakebackArmed(false);
```

(The existing `setHelpUsed({ hints: 0, bestMoves: 0 })` line is replaced by the first of these.)

- [ ] **Step 9: Run the full module suite**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx
git commit -m "feat(piano-chess): octave twice takes the last move back"
```

---

### Task 8: The thinking-time curve

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/opponentThinking.js`
- Test (create): `frontend/src/modules/Piano/PianoChessGame/opponentThinking.test.js`

**Interfaces:**
- Consumes: `TOP_LEVEL` from `@shared-gaming/chess/ladder.mjs`.
- Produces: `thinkTimeFor({ level, config, seed, ply, pace })` → milliseconds, or `null` when `level` is not a number; `thinkMsConfig(config)` → `{ floor, ceiling, jitter }`; `DEFAULT_THINK_MS`.

- [ ] **Step 1: Write the failing test**

Create `opponentThinking.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { DEFAULT_THINK_MS, thinkMsConfig, thinkTimeFor } from './opponentThinking.js';

const noJitter = { opponent: { think_ms: { floor: 600, ceiling: 4000, jitter: 0 } } };

describe('how long the opponent thinks', () => {
  it('answers fast at the bottom of the ladder and slowly at the top', () => {
    expect(thinkTimeFor({ level: 0, config: noJitter })).toBe(600);
    expect(thinkTimeFor({ level: 20, config: noJitter })).toBe(4000);
  });

  it('never goes backwards as the ladder climbs', () => {
    let previous = -1;
    for (let level = 0; level <= 20; level += 1) {
      const ms = thinkTimeFor({ level, config: noJitter });
      expect(ms).toBeGreaterThanOrEqual(previous);
      previous = ms;
    }
  });

  it('clamps a level outside the ladder rather than extrapolating', () => {
    expect(thinkTimeFor({ level: -5, config: noJitter })).toBe(600);
    expect(thinkTimeFor({ level: 99, config: noJitter })).toBe(4000);
  });

  it('is deterministic for a seed and ply, so a test can pin it', () => {
    const jittered = { opponent: { think_ms: { floor: 600, ceiling: 4000, jitter: 0.25 } } };
    const first = thinkTimeFor({ level: 10, config: jittered, seed: 42, ply: 3 });
    expect(thinkTimeFor({ level: 10, config: jittered, seed: 42, ply: 3 })).toBe(first);
    expect(thinkTimeFor({ level: 10, config: jittered, seed: 42, ply: 4 })).not.toBe(first);
  });

  it('keeps jitter inside the band it was given', () => {
    const jittered = { opponent: { think_ms: { floor: 1000, ceiling: 1000, jitter: 0.25 } } };
    for (let ply = 0; ply < 50; ply += 1) {
      const ms = thinkTimeFor({ level: 5, config: jittered, seed: 1, ply });
      expect(ms).toBeGreaterThanOrEqual(750);
      expect(ms).toBeLessThanOrEqual(1250);
    }
  });

  it('scales by the pace the player chose', () => {
    expect(thinkTimeFor({ level: 20, config: noJitter, pace: 0.5 })).toBe(2000);
    expect(thinkTimeFor({ level: 0, config: noJitter, pace: 2 })).toBe(1200);
  });

  it('refuses to guess when there is no ladder to read', () => {
    expect(thinkTimeFor({ level: null, config: noJitter })).toBe(null);
    expect(thinkTimeFor({ level: undefined, config: noJitter })).toBe(null);
  });

  it('falls back to the house curve when the config says nothing', () => {
    expect(thinkMsConfig(null)).toEqual(DEFAULT_THINK_MS);
    expect(thinkMsConfig({ opponent: { think_ms: { floor: 100 } } }))
      .toEqual({ ...DEFAULT_THINK_MS, floor: 100 });
  });

  it('will not let a bad config invert the curve', () => {
    const inverted = { opponent: { think_ms: { floor: 5000, ceiling: 1000, jitter: 0 } } };
    expect(thinkTimeFor({ level: 0, config: inverted }))
      .toBeLessThanOrEqual(thinkTimeFor({ level: 20, config: inverted }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/opponentThinking.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `opponentThinking.js`**

```javascript
import { TOP_LEVEL } from '@shared-gaming/chess/ladder.mjs';

/**
 * How long the opponent takes to answer.
 *
 * A flat delay makes every character on a 21-rung ladder answer alike, so
 * strength is a number on a settings panel and nothing a player ever feels. Pip
 * replying almost at once and Malgrave brooding for four seconds says what a
 * blurb cannot: the pause IS the difficulty, read without reading.
 *
 * Jitter is drawn from the seed and the ply rather than from Math.random, so a
 * game replays identically and a test can pin a value. A metronomic pause reads
 * as a timer; a varying one reads as a mind.
 *
 * Pure, and knows nothing about the network. The caller applies this as a FLOOR
 * on the reply, never as a delay before the request — see the opponent effect.
 */

export const DEFAULT_THINK_MS = Object.freeze({ floor: 600, ceiling: 4000, jitter: 0.25 });

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function thinkMsConfig(config) {
  const think = config?.opponent?.think_ms || {};
  return {
    floor: positive(think.floor, DEFAULT_THINK_MS.floor),
    ceiling: positive(think.ceiling, DEFAULT_THINK_MS.ceiling),
    // A jitter above 1 would let a reply arrive before it was asked for.
    jitter: Math.min(1, positive(think.jitter, DEFAULT_THINK_MS.jitter)),
  };
}

/**
 * ±jitter, deterministic in the seed and the ply.
 *
 * Math.imul rather than plain multiplication: the intermediate products exceed
 * 2^53 and would lose their low bits, which are the only ones that vary.
 */
function jitterFactor(seed, ply, jitter) {
  if (!jitter) return 1;
  const mixed = Math.imul((Number(seed) >>> 0) ^ Math.imul(Number(ply) + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  const unit = (mixed % 1000) / 1000;
  return 1 + ((unit * 2) - 1) * jitter;
}

export function thinkTimeFor({ level, config = null, seed = 0, ply = 0, pace = 1 }) {
  // No ladder has resolved — a guest, or the fetch has not landed. Refusing to
  // guess lets the caller fall back to the flat setting rather than inventing a
  // strength this player is not actually facing.
  if (!Number.isFinite(Number(level))) return null;
  const { floor, ceiling, jitter } = thinkMsConfig(config);
  // A config with the ends the wrong way round should be dull, not inverted.
  const low = Math.min(floor, ceiling);
  const high = Math.max(floor, ceiling);
  const climbed = Math.min(TOP_LEVEL, Math.max(0, Math.floor(Number(level)))) / TOP_LEVEL;
  const base = low + ((high - low) * climbed);
  const scaled = base * jitterFactor(seed, ply, jitter) * positive(pace, 1);
  return Math.max(0, Math.round(scaled));
}

export default { DEFAULT_THINK_MS, thinkMsConfig, thinkTimeFor };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/opponentThinking.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/opponentThinking.js \
        frontend/src/modules/Piano/PianoChessGame/opponentThinking.test.js
git commit -m "feat(piano-chess): opponent thinking time scales across the ladder"
```

---

### Task 9: Ask first, wait after

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx:590-616` (the opponent effect)
- Test: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`

**Interfaces:**
- Consumes: `thinkTimeFor` (Task 8).
- Produces: component state `thinkMs` (the pause the current reply is being held for, or `null`), consumed by Task 10's portrait.

**The bug being fixed:** the effect currently waits `opponentDelayMs` and *then* sends the request, so network time is added to the pause. On the piano tablet, where WiFi is known to stall, that turns a deliberate four-second brood into a hang. The think time must be a floor on the total, not an addend.

- [ ] **Step 1: Write the failing test**

Add to `PianoChessGame.test.jsx`. Reuse the file's existing render harness and its `requestOpponentMove` mock; if it does not already mock `chessApi.js`, add:

```javascript
vi.mock('./chessApi.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requestOpponentMove: vi.fn(), fetchChessConfig: vi.fn(), fetchLadder: vi.fn() };
});
```

```javascript
describe('the opponent asks before it waits', () => {
  it('sends the move request without waiting out the think time first', async () => {
    vi.useFakeTimers();
    requestOpponentMove.mockResolvedValue(null);
    fetchChessConfig.mockResolvedValue({ opponent: { think_ms: { floor: 3000, ceiling: 3000, jitter: 0 } } });
    fetchLadder.mockResolvedValue(null);

    renderGame();                        // the file's existing helper
    await playAnyLegalMove();            // the file's existing helper

    // Not one tick of the think time has elapsed, and the request is already out.
    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

If the existing test file has no such helpers, write the smallest equivalent using its established rendering pattern — do not build a second harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`
Expected: FAIL — `requestOpponentMove` has not been called, because the effect is still inside its `setTimeout`.

- [ ] **Step 3: Rewrite the opponent effect**

```javascript
  // The opponent answers on a delay so its move reads as a reply, not a
  // flicker — and the delay is the character's, not one number for all of them.
  //
  // The request goes out FIRST and the pause is applied to what is left over.
  // Waiting and then asking adds the network to the pause, which on the kiosk
  // tablet (where WiFi stalls silently) turns a four-second brood into a hang.
  // The server is the strong opponent; the bundled engine keeps the game
  // playable when it cannot be reached.
  useEffect(() => {
    if (game.status?.game_over || game.status?.turn === playerColor) return undefined;
    let cancelled = false;
    let timer = null;
    setOpponentThinking(true);

    const startedAt = Date.now();
    const ply = gameRef.current.history.length;
    const pace = chessConfig?.opponent?.pace ?? 1;
    const thinkMs = thinkTimeFor({ level: ladderLevel, config: chessConfig, seed: gameSeed, ply, pace })
      ?? opponentDelayMs;
    setThinkMs(thinkMs);

    const fen = gameRef.current.game.fen;
    (async () => {
      // The ladder's level, when there is one, is the strength this character
      // plays at — the server clamps it to what the player has actually
      // unlocked, so this is a request, not an authority.
      const served = await requestOpponentMove({
        fen, rung: rungId, level: ladderLevel, gameId, userId: lockedUser,
      });
      if (cancelled) return;
      if (served?.opponent) effectiveOpponentRef.current = served.opponent;
      const reply = served
        || chooseMove(fen, { difficulty: localFallbackDifficulty, seed: gameRef.current.history.length });
      if (!reply) return;

      const elapsed = Date.now() - startedAt;
      const waited = Math.max(0, thinkMs - elapsed);
      timer = setTimeout(() => {
        if (cancelled) return;
        const { state } = commitMove(gameRef.current, reply.from, reply.to, reply.promotion);
        setGame(state);
        setOpponentThinking(false);
        logger().info('opponent-replied', {
          san: reply.san,
          engine: served ? served.engine : 'local',
          opponent: served?.opponent || null,
        });
        logger().debug('opponent-think', {
          level: ladderLevel, think_ms: thinkMs, elapsed_ms: elapsed, waited_ms: waited,
        });
      }, waited);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setOpponentThinking(false);
    };
  }, [
    game.status, playerColor, rungId, ladderLevel, gameId, opponentDelayMs,
    lockedUser, localFallbackDifficulty, chessConfig, gameSeed,
  ]);
```

Add the state declaration next to `opponentThinking`:

```javascript
  // How long the current reply is being held for. Drives the portrait's pulse,
  // so a strong opponent visibly broods slower as well as longer.
  const [thinkMs, setThinkMs] = useState(null);
```

Add the import:

```javascript
import { thinkTimeFor } from './opponentThinking.js';
```

**A takeback mid-think needs no new code:** rewinding changes `game.status`, the effect re-runs, its cleanup sets `cancelled` and clears the timer, and the new run early-returns because it is the player's turn again.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS. If a pre-existing test asserted the old "wait then request" ordering, update it — the ordering was the bug.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx
git commit -m "fix(piano-chess): request the opponent move before the pause, not after

The delay was added on top of the round trip, so a slow network extended every
think. It is now a floor on the total."
```

---

### Task 10: A face that visibly thinks

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.scss`
- Modify: `frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (pass `thinking` and `thinkMs`)

**Interfaces:**
- Consumes: `opponentThinking` and `thinkMs` from Task 9.
- Produces: `OpponentPortrait` accepts `thinking` (boolean) and `thinkMs` (number|null).

- [ ] **Step 1: Write the failing test**

Add to `OpponentPortrait.test.jsx`:

```javascript
describe('the thinking face', () => {
  it('marks itself while the opponent is thinking', () => {
    const { container } = render(<OpponentPortrait opponent={{ name: 'Pip', art: null }} level={0} thinking />);
    expect(container.querySelector('.chess-opponent--thinking')).not.toBe(null);
  });

  it('is still when it is not', () => {
    const { container } = render(<OpponentPortrait opponent={{ name: 'Pip', art: null }} level={0} />);
    expect(container.querySelector('.chess-opponent--thinking')).toBe(null);
  });

  it('paces the pulse from how long it is thinking for', () => {
    const { container } = render(
      <OpponentPortrait opponent={{ name: 'Malgrave', art: null }} level={20} thinking thinkMs={3200} />,
    );
    expect(container.querySelector('.chess-opponent').style.getPropertyValue('--pc-think-period')).toBe('3200ms');
  });

  it('gives every cell its own place in the wave', () => {
    const { container } = render(<OpponentPortrait opponent={{ name: 'Pip', art: null }} level={0} thinking />);
    const cells = container.querySelectorAll('.chess-opponent__identicon rect');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0].style.getPropertyValue('--i')).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.test.jsx`
Expected: FAIL — no `--thinking` class.

- [ ] **Step 3: Update the component**

```jsx
export function OpponentPortrait({ opponent, level, size = 'md', status = null, thinking = false, thinkMs = null }) {
  const name = opponent?.name || `Level ${level ?? 0}`;
  // The pulse borrows the pause's own length, so a strong opponent broods
  // slowly and a weak one twitches — the animation and the latency say the
  // same thing, and a player reads the difficulty without being told it.
  const style = Number.isFinite(Number(thinkMs))
    ? { '--pc-think-period': `${Math.max(600, Math.round(Number(thinkMs)))}ms` }
    : undefined;
  return (
    <figure
      className={`chess-opponent chess-opponent--${size}${thinking ? ' chess-opponent--thinking' : ''}`}
      style={style}
    >
      <div className="chess-opponent__face">
        {opponent?.art ? (
          <img className="chess-opponent__art" src={opponent.art} alt="" />
        ) : (
          <svg
            className="chess-opponent__identicon"
            viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
            aria-hidden="true"
            data-identicon={name}
          >
            {cardIdenticonCells(name).flatMap((row, rowIndex) => row.map((visible, columnIndex) => (
              visible ? (
                <rect
                  key={`${columnIndex}-${rowIndex}`}
                  // Its place in the wave. The stagger lives in CSS so the
                  // delay can be a fraction of the period rather than a fixed
                  // number of milliseconds that would desynchronise from it.
                  style={{ '--i': rowIndex * GRID_SIZE + columnIndex }}
                  x={columnIndex + 0.08}
                  y={rowIndex + 0.08}
                  width="0.84"
                  height="0.84"
                  rx="0.16"
                />
              ) : null
            )))}
          </svg>
        )}
      </div>
      ...figcaption unchanged...
    </figure>
  );
}
```

Note the test asserts `cells[0].style.getPropertyValue('--i') === '0'`, which requires the first *rendered* cell to be at row 0, column 0. `cardIdenticonCells` returns a sparse grid, so if that cell is not visible the assertion fails — in that case change the assertion to read the first cell's `--i` as a non-empty string rather than `'0'`.

- [ ] **Step 4: Add the styles**

Append to `OpponentPortrait.scss`:

```scss
/**
 * Thinking, drawn on the face itself.
 *
 * Opacity and transform only. Animating `filter` here would be the obvious
 * reach — a blur or a brightness sweep — and it is the one thing that must not
 * happen: on the piano tablet an animated filter drops the whole screen's frame
 * rate with no long tasks to show for it, which makes it invisible in the
 * profiler and very expensive on the bench.
 */
.chess-opponent--thinking {
  .chess-opponent__identicon rect {
    animation: pc-think-pulse var(--pc-think-period, 1400ms) ease-in-out infinite;
    /* Spread across the period rather than a fixed step, so the wave completes
       exactly once per pulse whatever the opponent's pace. */
    animation-delay: calc(var(--i, 0) * var(--pc-think-period, 1400ms) / 25);
  }

  /* A roster with artwork has no cells to animate, so the whole face breathes. */
  .chess-opponent__art {
    animation: pc-think-breathe var(--pc-think-period, 1400ms) ease-in-out infinite;
  }
}

@keyframes pc-think-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

@keyframes pc-think-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

@media (prefers-reduced-motion: reduce) {
  .chess-opponent--thinking .chess-opponent__identicon rect,
  .chess-opponent--thinking .chess-opponent__art {
    animation: none;
  }
}
```

- [ ] **Step 5: Pass it through from the game**

In `PianoChessGame.jsx`, the portrait call becomes:

```jsx
                <OpponentPortrait
                  opponent={opponent}
                  level={ladderLevel}
                  status={opponentLine}
                  size="lg"
                  thinking={opponentThinking}
                  thinkMs={thinkMs}
                />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.jsx \
        frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.scss \
        frontend/src/modules/Piano/PianoChessGame/OpponentPortrait.test.jsx \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx
git commit -m "feat(piano-chess): the opponent's face pulses while it thinks"
```

---

### Task 11: Pace, not milliseconds

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (`applySetting`)
- Modify: `backend/src/3_applications/chess/ChessConfigService.mjs:10` (`MERGE_BLOCKS`)
- Modify: `backend/src/3_applications/chess/ChessConfigService.test.mjs`

**Why the merge blocks change:** `mergeChessConfig` replaces every block wholesale except `feedback`. A user tapping "Slow" writes `{ opponent: { pace: 1.6 } }`, which would erase the household's `opponent.think_ms` for that player. `help` has the same exposure.

- [ ] **Step 1: Write the failing backend test**

Add to `ChessConfigService.test.mjs`:

```javascript
  it('merges the opponent block rather than replacing it', () => {
    const merged = mergeChessConfig(
      { opponent: { think_ms: { floor: 600, ceiling: 4000 }, pace: 1 } },
      { opponent: { pace: 1.6 } },
    );
    expect(merged.opponent.pace).toBe(1.6);
    expect(merged.opponent.think_ms).toEqual({ floor: 600, ceiling: 4000 });
  });

  it('merges the help block too', () => {
    const merged = mergeChessConfig(
      { help: { takebacks: { max_per_game: 3, cooldown_moves: 0 } } },
      { help: { hint_sound: false } },
    );
    expect(merged.help.takebacks).toEqual({ max_per_game: 3, cooldown_moves: 0 });
    expect(merged.help.hint_sound).toBe(false);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `./node_modules/.bin/vitest run backend/src/3_applications/chess/ChessConfigService.test.mjs`
Expected: FAIL — `think_ms` and `takebacks` are gone from the merged result.

- [ ] **Step 3: Extend `MERGE_BLOCKS`**

```javascript
/**
 * Blocks a user override merges INTO rather than replaces.
 *
 * The ladder is replaced wholesale on purpose — a half-merged ladder (rung 2
 * from the user, rung 3 from the house) is never what anyone means. These three
 * are the opposite case: the panel writes one key at a time, so replacing the
 * block would make a single tap on "Slow" erase the household's think_ms curve
 * for that child and leave no sign of where it went.
 */
const MERGE_BLOCKS = ['feedback', 'opponent', 'help'];
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `./node_modules/.bin/vitest run backend/src/3_applications/chess/ChessConfigService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing panel test**

Add to `ChessSettingsPanel.test.jsx`, following the file's existing render-and-click pattern:

```javascript
  it('offers a pace rather than a millisecond count', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={{ rungs: [] }} rungId="learner" onChange={onChange} onClose={() => {}} />);
    expect(screen.getByText('Natural')).toBeInTheDocument();
    expect(screen.queryByText('700 ms')).toBe(null);
  });

  it('writes the pace under the opponent block', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={{ rungs: [] }} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Slow'));
    expect(onChange).toHaveBeenCalledWith({ opponent: { pace: 1.6 } });
  });

  it('shows which pace is already chosen', () => {
    render(
      <ChessSettingsPanel
        config={{ rungs: [], opponent: { pace: 0.6 } }}
        rungId="learner" onChange={() => {}} onClose={() => {}}
      />,
    );
    expect(screen.getByText('Quick').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`
Expected: FAIL — "Natural" is not in the document.

- [ ] **Step 7: Replace the delay row**

Replace `const DELAY_CHOICES_MS = [300, 700, 1200];` with:

```javascript
/**
 * How long the opponent takes, as a pace rather than a number.
 *
 * The pause is no longer one value — it is a curve across the ladder, so a
 * character's own strength sets it. What is left for a player to choose is
 * whether the whole ladder runs fast or slow, which is a feeling, not a
 * millisecond count.
 */
const PACE_CHOICES = [
  { id: 0.6, label: 'Quick' },
  { id: 1, label: 'Natural' },
  { id: 1.6, label: 'Slow' },
];
```

Replace `const delayMs = config?.opponent_delay_ms ?? 700;` with:

```javascript
  const pace = Number(config?.opponent?.pace ?? 1);
```

Replace the "Opponent replies after" section:

```jsx
      <h3 className="chess-settings__group">Opponent pace</h3>
      <div className="chess-settings__row">
        {PACE_CHOICES.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`chess-settings__opt${pace === opt.id ? ' is-active' : ''}`}
            aria-pressed={pace === opt.id}
            onClick={() => onChange({ opponent: { pace: opt.id } })}
          >
            {opt.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 8: Teach `applySetting` to merge the block**

In `PianoChessGame.jsx`, `applySetting` merges only `feedback`. Extend it:

```javascript
  const applySetting = useCallback((patch) => {
    setChessConfig((prev) => ({
      ...(prev || {}),
      ...patch,
      // Same reason as MERGE_BLOCKS on the server: the panel writes one key at
      // a time, and a whole-block replace would drop the rest of the block on
      // the floor until the next reload put it back.
      feedback: { ...(prev?.feedback || {}), ...(patch.feedback || {}) },
      opponent: { ...(prev?.opponent || {}), ...(patch.opponent || {}) },
      help: { ...(prev?.help || {}), ...(patch.help || {}) },
    }));
    if (patch.default_rung) setRungId(patch.default_rung);
    if (lockedUser) saveChessConfig(lockedUser, patch);
    logger().info('setting-applied', { patch, persisted: !!lockedUser });
  }, [lockedUser]);
```

- [ ] **Step 9: Run the full suite**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoChessGame/ backend/src/3_applications/chess/ shared/gaming/chess/`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.jsx \
        frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx \
        frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx \
        backend/src/3_applications/chess/ChessConfigService.mjs \
        backend/src/3_applications/chess/ChessConfigService.test.mjs
git commit -m "feat(piano-chess): opponent pace replaces the flat reply delay"
```

---

### Task 12: Configuration and documentation

**Files:**
- Modify (data volume, via docker): `data/household/config/chess.yml`
- Modify: `docs/reference/piano/chess.md`

- [ ] **Step 1: Read the live config before touching it**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/chess.yml' > /tmp/chess.yml.bak
wc -l /tmp/chess.yml.bak
```

The file is long — it carries the full 21-entry Pokémon roster. **Do not rewrite it from memory.** Edit the backup, then copy the whole file back.

- [ ] **Step 2: Add the new blocks to the backup**

Insert after the `feedback:` block:

```yaml
# Help a player can ask for at the keys. The gestures themselves are not
# configurable — a run of three semitones shows legal moves, four asks for the
# best move, and the octave played twice takes the last move back — but what
# they cost is.
help:
  takebacks:
    max_per_game: 3    # null for no cap at all
    cooldown_moves: 0  # the player's own moves between takebacks; 0 for none
```

Replace the `opponent_delay_ms: 700` line with:

```yaml
# How long the opponent takes to answer. Interpolated across the 21 rungs, so a
# character's strength is something a player feels before they are told it.
# `pace` scales the whole curve and is what the in-game settings panel writes.
# opponent_delay_ms below is the fallback for a guest, who has no ladder.
opponent:
  think_ms:
    floor: 600
    ceiling: 4000
    jitter: 0.25
  pace: 1
opponent_delay_ms: 700
```

In `ladder.promotion`, add the two new keys next to the existing ceilings:

```yaml
    max_takebacks: 1   # one slip corrected is fine; a second is being carried
    unrestricted_below_level: 0  # raise to let the first rungs teach without limits
```

- [ ] **Step 3: Write it back and restart the backend**

```bash
sudo docker exec -i daylight-station sh -c 'cat > data/household/config/chess.yml' < /tmp/chess.yml.bak
sudo docker exec daylight-station sh -c 'head -40 data/household/config/chess.yml'
```

Config is cached in memory at startup, so the change is inert until the backend reloads. On a dev server, touch a watched backend file; in the container, redeploy.

- [ ] **Step 4: Verify the file still parses as the app reads it**

```bash
curl -s http://localhost:3111/api/v1/chess/config | head -c 400
```

Expected: JSON including `"help"`, `"opponent"`, and `max_takebacks` under `ladder.promotion`. If the roster vanished, the write truncated the file — restore from `/tmp/chess.yml.bak` and retry.

- [ ] **Step 5: Update `docs/reference/piano/chess.md`**

Read the file first and match its voice — reference docs here are written in the present tense as an endstate, never as a changelog and never naming classes. Cover:

- The takeback: octave twice, what it rewinds, that the first octave arms and says so, and that it is refused when the budget is spent.
- The budget: `help.takebacks.max_per_game` and `cooldown_moves`, and that the cap is felt at the keys while the ladder ceiling decides whether the game counts.
- The promotion ceilings: `max_takebacks`, and `unrestricted_below_level` for the early rungs.
- Practice: replaying an opponent already beaten never counts toward promotion, so takebacks there cost nothing — there is no mode to switch.
- Opponent pace: the curve across the ladder, the `pace` multiplier, and that the pause is a floor applied after the request rather than a delay before it.
- The archive: taken-back moves are kept, marked `undone`, and `move_count` counts only the surviving line.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/piano/chess.md
git commit -m "docs(piano-chess): takebacks, help budget, and opponent pace"
```

---

## Verification

Run before declaring the work done, and paste the real output rather than describing it:

```bash
./node_modules/.bin/vitest run \
  frontend/src/modules/Piano/PianoChessGame/ \
  shared/gaming/chess/ \
  backend/src/3_applications/chess/ \
  backend/src/4_api/v1/routers/chess.test.mjs
```

Then confirm on the instrument, because none of this is provable from a test runner:

1. Play a move, let the opponent answer, play the octave once — the prompt offers the takeback.
2. Play it again — both moves come off, the board is the one you faced, the chord map is the one you read.
3. Do it a fourth time in one game — refused, with the reason said out loud.
4. Watch the portrait during a reply at the bottom of the ladder and near the top — the pulse is visibly slower and longer at the top.
5. Finish a game and check the archive on disk: the taken-back moves are there, marked.

## Out of scope

- A persistent cross-game coin wallet.
- Redo.
- Under-promotion, position-complexity heuristics for think time.
