# Chess Record Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One archive of chess games, derived ladder and rivalry files rebuilt from it, no dead per-player scorecard, and a result card that says the head-to-head record and why a win did or did not count.

**Architecture:** The household archive (`household/gaming/log/chess/YYYY-MM-DD/*.yml`) becomes the only per-game record. The ladder file and rivalry memory stay as derived per-player state, and a new pure planner replays archived games through the live ladder and rivalry rules to rebuild them. A CLI does the file moves and writes, dry run by default. `POST /games` stops writing scorecards and instead answers with the facts the result card needs.

**Tech Stack:** Node ES modules, Express, React, vitest with Testing Library, the `yaml` package.

**Spec:** No spec file. The design was approved in chat on 2026-09-15 and is restated here:

1. **One archive.** Move every file from the pre-reorganisation directory `household/gaming/log/pianochess/` into `household/gaming/log/chess/` under the same day folder. Rename the 24 files that still carry the old `user-timestamp.yml` name to the current naming, so filename-prefix filters in the review and calibrate CLIs find them. Retire the emptied old directory to `_deleteme/`.
2. **Retire the scorecard.** Stop writing `users/{id}/apps/chess/games/`. Move each existing scorecard to `_deleteme/` only once the archive is shown to hold the same game. Delete the two chess modules nothing imports, since one of them is a second scorecard writer.
3. **Backfill derived state.** Rebuild `users/{id}/apps/chess/ladder.yml` and `rivalries.yml` from the archive with real timestamps and counted flags under the current policy. Never lower `unlocked_through`.
4. **Result card.** Under the tallies, show the head-to-head record, the progress toward the next opponent, and, for a win that did not count, the rule it broke.

Correction to the chat design: the in-game rail already shows "Opponent 2 of 21 · 2 of 5 wins". What no screen shows is the head-to-head record or why a win did not count.

## Global Constraints

- Never `rm` anything under the data tree. Anything that leaves its place goes to `data/_deleteme/<YYYY-MM-DD>-chess-record-consolidation/`.
- Writes made through `docker exec` run as root. Every file or directory the CLI creates takes the uid and gid of its parent directory.
- Never lower a player's `unlocked_through`.
- Frontend code logs through `frontend/src/lib/logging/`, never raw `console.*`. The CLI prints its report to stdout like the other chess CLIs.
- No instance-specific hosts, ports or container names in docs. Use `{env.docker_container}` and the like.
- Deploy only after `./scripts/deploy-gate.sh` exits 0, and re-run it after the build.
- Kid-facing copy uses straight apostrophes and whole sentences.
- Run single test files with `npx vitest run <paths>` from the repository root. The repo gate `npm run test:unit:vitest` does not walk `shared/` or `cli/`, so those test files must be run explicitly.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm
  ```

## File Map

| File | Change | Responsibility |
|---|---|---|
| `shared/gaming/rulesets/chess/ladder.mjs` | Modify | Add `promotionIneligibility` and `mergeLadderConfig` |
| `backend/src/3_applications/chess/ChessLadderService.mjs` | Modify | Timestamp results; report `counted`, `not_counted`, `up_next` |
| `backend/src/3_applications/piano-games/GameRivalryMemoryService.mjs` | Modify | Add `projectHeadToHead` |
| `backend/src/4_api/v1/routers/chess.mjs` | Modify | `POST /games` without a scorecard; add `head_to_head` |
| `backend/src/app.mjs` | Modify | Drop scorecard wiring; use `mergeLadderConfig`; add `headToHead` |
| `backend/src/1_adapters/persistence/chess/ChessRecordNames.mjs` | Modify | Drop `buildGameRecordFilename` |
| `backend/src/1_adapters/persistence/chess/DataServiceChessRecordStores.mjs` | Delete | Unused scorecard store |
| `backend/src/3_applications/chess/ChessOperations.mjs` | Delete | Unused second scorecard writer |
| `backend/src/3_applications/chess/ChessRecordBackfill.mjs` | Create | Pure replay of archive into ladder and rivalry |
| `cli/chess-backfill.cli.mjs` | Create | File moves, scorecard retirement, derived-file writes |
| `frontend/src/modules/Piano/PianoChessGame/chessStandingLines.js` | Create | Result-card sentences from the save response |
| `frontend/src/modules/Piano/game-platform/host/BoardGameResult.jsx` | Modify | Optional `notes` list |
| `frontend/src/modules/Piano/PianoChessGame/ChessResult.jsx` | Modify | Pass standing lines as notes |
| `frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.js` | Modify | Keep `head_to_head` with the ladder outcome; log it |
| `docs/reference/piano/chess.md`, `docs/reference/piano/piano-games.md` | Modify | Archive path, no scorecard, backfill, standing lines |

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree from main**

```bash
cd /opt/Code/DaylightStation
git worktree add .claude/worktrees/chess-records -b feat/chess-record-consolidation main
cd .claude/worktrees/chess-records
MAIN="$(git worktree list --porcelain | awk 'NR==1{print $2}')"
[ -e node_modules ] || ln -s "$MAIN/node_modules" node_modules
[ -e frontend/node_modules ] || [ ! -d "$MAIN/frontend/node_modules" ] || ln -s "$MAIN/frontend/node_modules" frontend/node_modules
```

- [ ] **Step 2: Confirm tests run in the worktree**

Run: `npx vitest run shared/gaming/rulesets/chess/ladder.test.mjs`
Expected: PASS.

All later paths are relative to the worktree root.

---

### Task 1: Ladder rules name why a game did not count

**Files:**
- Modify: `shared/gaming/rulesets/chess/ladder.mjs`
- Modify: `backend/src/app.mjs` (the `readChessLadderConfig` closure)
- Test: `shared/gaming/rulesets/chess/ladder.test.mjs`

**Interfaces:**
- Produces: `promotionIneligibility(record, policy, currentLevel)` returns `null` when the game counts, else one of `{ reason: 'unfinished' }`, `{ reason: 'other_level', level: number|null }`, `{ reason: 'best_moves'|'hints'|'takebacks', used: number, allowed: number }`.
- Produces: `countsTowardPromotion(record, policy, currentLevel)` keeps its signature and becomes `promotionIneligibility(...) === null`.
- Produces: `mergeLadderConfig(household, user)` returns the household config with `ladder` shallow-merged from `user.ladder`.

- [ ] **Step 1: Write the failing tests**

Add `mergeLadderConfig` and `promotionIneligibility` to the import list at the top of `ladder.test.mjs`, then append:

```js
describe('promotionIneligibility', () => {
  it('names nothing for a clean finished game at the current level', () => {
    expect(promotionIneligibility(game(), POLICY, 0)).toBe(null);
  });

  it('names the first broken ceiling: best moves, then hints, then takebacks', () => {
    expect(promotionIneligibility(game({ help: { hints: 11, best_moves: 14, takebacks: 1 } }), POLICY, 0))
      .toEqual({ reason: 'best_moves', used: 14, allowed: 0 });
    expect(promotionIneligibility(game({ help: { hints: 3, best_moves: 0, takebacks: 2 } }), POLICY, 0))
      .toEqual({ reason: 'hints', used: 3, allowed: 1 });
    expect(promotionIneligibility(game({ help: { hints: 0, best_moves: 0, takebacks: 2 } }), POLICY, 0))
      .toEqual({ reason: 'takebacks', used: 2, allowed: 1 });
  });

  it('calls a game against an already-beaten opponent practice', () => {
    expect(promotionIneligibility(game({ level: 0 }), POLICY, 1)).toEqual({ reason: 'other_level', level: 0 });
  });

  it('refuses an unfinished game', () => {
    expect(promotionIneligibility(game({ completed: false }), POLICY, 0)).toEqual({ reason: 'unfinished' });
  });

  it('agrees with countsTowardPromotion on every case', () => {
    const cases = [
      [game(), 0], [game({ completed: false }), 0], [game({ level: 0 }), 1],
      [game({ help: { hints: 2, best_moves: 0 } }), 0], [game({ help: { hints: 9, best_moves: 9 } }), 0],
    ];
    for (const [record, level] of cases) {
      expect(countsTowardPromotion(record, POLICY, level)).toBe(promotionIneligibility(record, POLICY, level) === null);
    }
  });
});

describe('mergeLadderConfig', () => {
  it('lays the player ladder block over the household one and leaves the rest alone', () => {
    const merged = mergeLadderConfig(
      { default_rung: 'learner', ladder: { roster_pack: 'generic', promotion: { window: 7 } } },
      { ladder: { roster_pack: 'pokemon' } },
    );
    expect(merged).toEqual({ default_rung: 'learner', ladder: { roster_pack: 'pokemon', promotion: { window: 7 } } });
  });

  it('tolerates a missing household or player layer', () => {
    expect(mergeLadderConfig(null, null)).toEqual({ ladder: {} });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/gaming/rulesets/chess/ladder.test.mjs`
Expected: FAIL, because `promotionIneligibility` and `mergeLadderConfig` are not exported.

- [ ] **Step 3: Implement**

In `ladder.mjs`, replace the whole `countsTowardPromotion` function and its doc comment with:

```js
/**
 * Why a finished game does not count toward promotion, or null when it does.
 *
 * Unfinished games never count, because you cannot be promoted for walking
 * away. Neither do games against anyone but the opponent being climbed, which
 * is what "no skipping ahead" means in arithmetic. The help ceilings are
 * checked in a fixed order and the first one broken is the one named, so the
 * result card tells a child the rule that actually decided it.
 */
export function promotionIneligibility(record, policy, currentLevel) {
  if (!record || !record.completed) return { reason: 'unfinished' };
  if (Number(record.level) !== currentLevel) {
    return { reason: 'other_level', level: record.level ?? null };
  }
  // The first rungs teach the game, not the discipline. Below this level a
  // game counts however much help was leant on — the ceilings resume above it.
  if (currentLevel < Number(policy.unrestricted_below_level || 0)) return null;
  const help = record.help || {};
  for (const [reason, limit] of [['best_moves', 'max_best_moves'], ['hints', 'max_hints'], ['takebacks', 'max_takebacks']]) {
    const used = Number(help[reason] || 0);
    const allowed = Number(policy[limit]);
    if (used > allowed) return { reason, used, allowed };
  }
  return null;
}

/** Does this game count toward promotion? See `promotionIneligibility` for why not. */
export function countsTowardPromotion(record, policy, currentLevel) {
  return promotionIneligibility(record, policy, currentLevel) === null;
}

/**
 * The ladder config one player climbs under: the household's, with that
 * player's own `ladder` block laid over it. Only the ladder block merges,
 * because that is the only block a player's file overrides for promotion.
 */
export function mergeLadderConfig(household, user) {
  const base = household || {};
  return { ...base, ladder: { ...(base.ladder || {}), ...(user?.ladder || {}) } };
}
```

Add both names to the default export object at the bottom of the file:

```js
  countsTowardPromotion, promotionIneligibility, mergeLadderConfig, promotionStatus, applyGameToProgress, availableOpponents, rungForLevel,
```

In `backend/src/app.mjs`, add next to the other chess imports:

```js
import { mergeLadderConfig } from '#shared/gaming/rulesets/chess/ladder.mjs';
```

Replace the body of `readChessLadderConfig`:

```js
  const readChessLadderConfig = async (userId) => mergeLadderConfig(
    configService.getHouseholdAppConfig(null, 'chess') || {},
    userId ? (dataService.user.read('apps/chess/config', userId) || {}) : {},
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run shared/gaming/rulesets/chess/ladder.test.mjs backend/src/3_applications/chess/ChessLadderService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/gaming/rulesets/chess/ladder.mjs shared/gaming/rulesets/chess/ladder.test.mjs backend/src/app.mjs
git commit -m "feat(chess): the ladder names the rule that kept a game from counting

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 2: The ladder service reports what the result card needs

**Files:**
- Modify: `backend/src/3_applications/chess/ChessLadderService.mjs`
- Test: `backend/src/3_applications/chess/ChessLadderService.test.mjs`

**Interfaces:**
- Consumes: `promotionIneligibility`, `TOP_LEVEL` from Task 1.
- Produces: `createChessLadderService({ readConfig, readProgress, writeProgress, logger, now })`, where `now` is optional and defaults to `() => new Date()`.
- Produces: a successful `recordGame(userId, record)` returns `{ promoted, persisted: true, from, to, next_opponent, counted: boolean, not_counted: object|null, up_next: { level, name }|null, status }`. Every result it writes carries `at` as `record.ended_at` or the current time.

- [ ] **Step 1: Write the failing tests**

In `ChessLadderService.test.mjs`, add this import:

```js
import { DEFAULT_ROSTER, TOP_LEVEL } from '#shared/gaming/rulesets/chess/ladder.mjs';
```

Change `makeService` so it can take a clock:

```js
function makeService({ config = {}, progress = {}, writable = true, now = undefined } = {}) {
  const store = { ...progress };
  const service = createChessLadderService({
    readConfig: async () => config,
    readProgress: async (userId) => store[userId] ?? null,
    writeProgress: async (userId, value) => {
      if (!writable) return false;
      store[userId] = value;
      return true;
    },
    ...(now ? { now } : {}),
  });
  return { service, store };
}
```

Append:

```js
describe('what the result card is told', () => {
  it('says whether the game counted, which rule decided it, and who is next', async () => {
    const { service } = makeService({ progress: { kid: { unlocked_through: 1, results: [] } } });
    const clean = await service.recordGame('kid', win(1, { hints: 0, best_moves: 0, takebacks: 0 }));
    expect(clean).toMatchObject({ counted: true, not_counted: null, up_next: { level: 2, name: DEFAULT_ROSTER[2].name } });
    const heavy = await service.recordGame('kid', win(1, { hints: 11, best_moves: 14, takebacks: 1 }));
    expect(heavy).toMatchObject({ counted: false, not_counted: { reason: 'best_moves', used: 14, allowed: 0 } });
  });

  it('has nobody up next at the top of the ladder', async () => {
    const { service } = makeService({ progress: { kid: { unlocked_through: TOP_LEVEL, results: [] } } });
    expect((await service.recordGame('kid', win(TOP_LEVEL))).up_next).toBe(null);
  });

  it('stamps each result with when it was filed, unless the record says when it ended', async () => {
    const { service, store } = makeService({ now: () => new Date('2026-09-15T20:22:02.154Z') });
    await service.recordGame('kid', win(0));
    expect(store.kid.results.at(-1).at).toBe('2026-09-15T20:22:02.154Z');
    await service.recordGame('kid', { ...win(0), ended_at: '2026-09-15T20:00:00.000Z' });
    expect(store.kid.results.at(-1).at).toBe('2026-09-15T20:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/3_applications/chess/ChessLadderService.test.mjs`
Expected: FAIL, because `counted` and `up_next` are undefined and `at` is null.

- [ ] **Step 3: Implement**

Replace the import block at the top of `ChessLadderService.mjs`:

```js
import {
  TOP_LEVEL, applyGameToProgress, availableOpponents, createLadderProgress, normalizeProgress,
  promotionIneligibility, promotionStatus, resolvePolicy, resolveRoster, rungForLevel,
} from '#shared/gaming/rulesets/chess/ladder.mjs';
```

Change the factory signature:

```js
export function createChessLadderService({ readConfig, readProgress, writeProgress, logger = null, now = () => new Date() }) {
```

Replace the whole `recordGame` method:

```js
    /**
     * Fold a finished game in, and report where it left the player.
     *
     * Refuses to write for a guest rather than pretending: there is no file to
     * write, and a silent no-op that returns "promoted" would put a character on
     * screen that vanishes on the next load.
     *
     * The answer carries what the result card says: whether this game counted,
     * which rule decided it when it did not, and who the player is climbing
     * toward. The ladder file is the player's only per-game history outside the
     * household archive, so every result is stamped with a real time.
     */
    async recordGame(userId, record) {
      const config = await readConfig(userId);
      const policy = resolvePolicy(config);
      if (!userId) return { promoted: false, persisted: false, status: null };

      const stamped = { ...record, ended_at: record?.ended_at || now().toISOString() };
      const stored = await readProgress(userId);
      const notCounted = promotionIneligibility(stamped, policy, normalizeProgress(stored).unlocked_through);
      const outcome = applyGameToProgress(stored, stamped, policy);
      const saved = await writeProgress(userId, outcome.progress);
      if (!saved) {
        logger?.warn?.('chess.ladder.write-failed', { userId, level: outcome.to });
        return { promoted: false, persisted: false, status: promotionStatus(outcome.progress, policy) };
      }
      if (outcome.promoted) {
        logger?.info?.('chess.ladder.promoted', { userId, from: outcome.from, to: outcome.to });
      }
      const roster = resolveRoster(config);
      return {
        promoted: outcome.promoted,
        persisted: true,
        from: outcome.from,
        to: outcome.to,
        next_opponent: outcome.promoted ? roster[outcome.to] : null,
        counted: notCounted === null,
        not_counted: notCounted,
        up_next: outcome.to < TOP_LEVEL
          ? { level: outcome.to + 1, name: roster[outcome.to + 1]?.name ?? null }
          : null,
        status: promotionStatus(outcome.progress, policy),
      };
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/3_applications/chess/ChessLadderService.test.mjs`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/chess/ChessLadderService.mjs backend/src/3_applications/chess/ChessLadderService.test.mjs
git commit -m "feat(chess): a recorded game says if it counted, why not, and who is next

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 3: Head-to-head projection from rivalry memory

**Files:**
- Modify: `backend/src/3_applications/piano-games/GameRivalryMemoryService.mjs`
- Test: `backend/src/3_applications/piano-games/GameRivalryMemoryService.test.mjs`

**Interfaces:**
- Consumes: the rival shape returned by `GameRivalryMemoryService.recall`, `{ opponent: { id, name }, record: { win, loss, draw }, recent: [{ gameId, result, ... }] }` or `null`.
- Produces: `projectHeadToHead(rival, game)` where `game = { gameId, completed, result, opponent }`. It returns `{ opponent: { id, name }, win, loss, draw }` and writes nothing.

- [ ] **Step 1: Write the failing tests**

Change the import line of the test file to:

```js
import { GameRivalryMemoryService, projectHeadToHead } from './GameRivalryMemoryService.mjs';
```

Append:

```js
describe('projectHeadToHead', () => {
  const rival = {
    opponent: { id: 'pokemon:level-2', name: 'Weedle' },
    record: { win: 5, loss: 0, draw: 0 },
    recent: [{ gameId: 'g5', result: 'win' }],
  };

  it('folds in a finished game memory has not recorded yet', () => {
    expect(projectHeadToHead(rival, { gameId: 'g6', completed: true, result: 'win', opponent: { id: 'pokemon:level-2', name: 'Weedle' } }))
      .toEqual({ opponent: { id: 'pokemon:level-2', name: 'Weedle' }, win: 6, loss: 0, draw: 0 });
  });

  it('does not count a game twice when the archive write already recorded it', () => {
    expect(projectHeadToHead(rival, { gameId: 'g5', completed: true, result: 'win' })).toMatchObject({ win: 5 });
  });

  it('starts a first meeting from zero', () => {
    expect(projectHeadToHead(null, { gameId: 'g1', completed: true, result: 'loss', opponent: { id: 'pokemon:level-3', name: 'Kakuna' } }))
      .toEqual({ opponent: { id: 'pokemon:level-3', name: 'Kakuna' }, win: 0, loss: 1, draw: 0 });
  });

  it('ignores an unfinished game', () => {
    expect(projectHeadToHead(rival, { gameId: 'g7', completed: false, result: 'win' })).toMatchObject({ win: 5 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/3_applications/piano-games/GameRivalryMemoryService.test.mjs`
Expected: FAIL, because `projectHeadToHead` is not a function.

- [ ] **Step 3: Implement**

In `GameRivalryMemoryService.mjs`, directly after `summarizeGameArchive`, add:

```js
/**
 * A rival's lifetime record with one just-finished game folded in, written
 * nowhere.
 *
 * The result card asks the moment a game ends, and that request races the
 * archive write that records the game in memory. So the game is added unless
 * memory already lists it among the recent games, which is where a game that
 * won the race would be.
 */
export function projectHeadToHead(rival, game) {
  const totals = {
    win: Number(rival?.record?.win || 0),
    loss: Number(rival?.record?.loss || 0),
    draw: Number(rival?.record?.draw || 0),
  };
  const known = (rival?.recent || []).some((entry) => entry?.gameId && entry.gameId === game?.gameId);
  if (!known && game?.completed && ['win', 'loss', 'draw'].includes(game?.result)) totals[game.result] += 1;
  return {
    opponent: {
      id: clean(game?.opponent?.id, 80) || rival?.opponent?.id || null,
      name: clean(game?.opponent?.name, 40) || rival?.opponent?.name || null,
    },
    ...totals,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/3_applications/piano-games/GameRivalryMemoryService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/piano-games/GameRivalryMemoryService.mjs backend/src/3_applications/piano-games/GameRivalryMemoryService.test.mjs
git commit -m "feat(piano-games): project a head-to-head record including the game just played

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 4: POST /games stops writing scorecards and answers with standing

**Files:**
- Modify: `backend/src/4_api/v1/routers/chess.mjs` (router params and the `POST /games` handler)
- Modify: `backend/src/app.mjs` (remove `recordStore`; add `headToHead` to `sharedChessRivalry`; trim the `ChessRecordNames` import)
- Modify: `backend/src/1_adapters/persistence/chess/ChessRecordNames.mjs`
- Modify: `backend/src/4_api/v1/routers/lib/chessGameFilename.test.mjs`
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessApi.js` (the doc comment above `archiveGame`)
- Delete: `backend/src/1_adapters/persistence/chess/DataServiceChessRecordStores.mjs`
- Delete: `backend/src/3_applications/chess/ChessOperations.mjs`
- Modify: `docs/reference/piano/piano-games.md` (section "The game record")
- Test: `backend/src/4_api/v1/routers/chess.test.mjs`

**Interfaces:**
- Consumes: the `ladderService.recordGame` output from Task 2 and `projectHeadToHead` from Task 3.
- Produces: `createChessRouter({ ..., ladderService, rivalryMemory, ... })` with no `recordStore`. `rivalryMemory.headToHead(userId, record)` is optional and returns the Task 3 shape or null.
- Produces: `POST /api/v1/piano-games/chess/games?user={id}` answers `201 { saved: true, ladder, head_to_head, boardGameDay }`. It answers 400 without a user, 501 without a ladder service, and 5xx when the ladder did not persist.

- [ ] **Step 1: Write the failing tests**

In `chess.test.mjs`, replace `appWith` with:

```js
function appWith({ engine, configService, ladderService, rivalryMemory, analyst, commentaryService, boardGameDayService, logger = silentLogger }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano-games/chess', createChessRouter({
    engine, configService, ladderService, rivalryMemory, analyst, commentaryService, boardGameDayService, logger,
  }));
  return app;
}

const ladderStub = (recordGame) => ({
  recordGame: vi.fn(recordGame || (async () => ({
    promoted: false, persisted: true, counted: true, not_counted: null,
    up_next: { level: 2, name: 'Kakuna' }, status: { wins: 3, needed: 5, at_top: false },
  }))),
});
```

Replace the whole `describe('POST /api/v1/piano-games/chess/games', ...)` block with:

```js
describe('POST /api/v1/piano-games/chess/games', () => {
  const body = {
    game_id: 'game-1', completed: true, result: 'win', moves: 24, level: 1,
    help: { hints: 0, best_moves: 0, takebacks: 0 }, opponent: { id: 'pokemon:level-2', name: 'Weedle' },
  };

  it('folds a finished game into the ladder and answers with where it left the player', async () => {
    const ladderService = ladderStub();
    const rivalryMemory = { headToHead: vi.fn(async () => ({ opponent: { id: 'pokemon:level-2', name: 'Weedle' }, win: 6, loss: 0, draw: 0 })) };
    const recordDay = vi.fn(() => ({ studyDate: '2026-08-28', completedGames: 3, counted: true }));
    const app = appWith({ engine: {}, configService: stubConfig(), ladderService, rivalryMemory, boardGameDayService: { record: recordDay } });
    const res = await request(app).post('/api/v1/piano-games/chess/games?user=learner4').send(body);
    expect(res.status).toBe(201);
    expect(ladderService.recordGame).toHaveBeenCalledWith('learner4', expect.objectContaining({ game_id: 'game-1', result: 'win' }));
    expect(rivalryMemory.headToHead).toHaveBeenCalledWith('learner4', expect.objectContaining({ game_id: 'game-1' }));
    expect(res.body).toMatchObject({
      saved: true,
      ladder: { counted: true, up_next: { name: 'Kakuna' } },
      head_to_head: { win: 6, loss: 0 },
    });
    expect(recordDay).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'learner4', gameId: 'chess', gameSessionId: 'game-1', completed: true, result: 'win',
    }));
    expect(res.body.boardGameDay).toMatchObject({ completedGames: 3, counted: true });
  });

  it('refuses without a user, so nothing is filed anonymously', async () => {
    const ladderService = ladderStub();
    const app = appWith({ engine: {}, configService: stubConfig(), ladderService });
    const res = await request(app).post('/api/v1/piano-games/chess/games').send(body);
    expect(res.status).toBe(400);
    expect(ladderService.recordGame).not.toHaveBeenCalled();
  });

  it('rejects a traversal in the user segment', async () => {
    const ladderService = ladderStub();
    const app = appWith({ engine: {}, configService: stubConfig(), ladderService });
    const res = await request(app).post('/api/v1/piano-games/chess/games?user=../../../../tmp').send(body);
    expect(res.status).toBe(400);
    expect(ladderService.recordGame).not.toHaveBeenCalled();
  });

  it('answers honestly when the ladder fails to persist, instead of claiming success', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const app = appWith({
      engine: {}, configService: stubConfig(), logger,
      ladderService: ladderStub(async () => ({ promoted: false, persisted: false, status: null })),
    });
    const res = await request(app).post('/api/v1/piano-games/chess/games?user=learner4').send(body);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    expect(res.body).not.toMatchObject({ saved: true });
    expect(logger.info).not.toHaveBeenCalledWith('chess.game.recorded', expect.anything());
    expect(logger.warn).toHaveBeenCalledWith('chess.game.record-failed', expect.anything());
  });

  it('still answers 201 when head-to-head memory throws, because it is cosmetic', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const app = appWith({
      engine: {}, configService: stubConfig(), logger, ladderService: ladderStub(),
      rivalryMemory: { headToHead: vi.fn(async () => { throw new Error('disk'); }) },
    });
    const res = await request(app).post('/api/v1/piano-games/chess/games?user=learner4').send(body);
    expect(res.status).toBe(201);
    expect(res.body.head_to_head).toBe(null);
    expect(logger.warn).toHaveBeenCalledWith('chess.game.head-to-head-failed', expect.objectContaining({ reason: 'disk' }));
  });

  it('is unavailable without a ladder service', async () => {
    const app = appWith({ engine: {}, configService: stubConfig() });
    const res = await request(app).post('/api/v1/piano-games/chess/games?user=learner4').send(body);
    expect(res.status).toBe(501);
  });
});
```

In `chessGameFilename.test.mjs`, delete the whole `describe('buildGameRecordFilename', ...)` block and change the import to:

```js
import { buildChessArchiveFilename } from '../../../../1_adapters/persistence/chess/ChessRecordNames.mjs';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs`
Expected: FAIL. The handler still calls `recordStore.save`, and `head_to_head` is missing.

- [ ] **Step 3: Implement the router**

In `chess.mjs`, change the factory parameter line from `engine, configService, recordStore = null, archiveStore = null, ladderService = null,` to:

```js
  engine, configService, archiveStore = null, ladderService = null,
```

Replace the whole `router.post('/games', ...)` handler with:

```js
  /**
   * A finished game, folded into the player's ladder.
   *
   * No per-game file is written here. The household archive (POST /history)
   * is the only per-game record; the ladder is derived state, and it is what
   * this endpoint must get right, so its write is the success condition.
   */
  router.post('/games', asyncHandler(async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === undefined) return undefined; // resolveUser already answered
    if (!userId) return res.status(400).json({ error: 'user_required' });
    if (!ladderService) return res.status(501).json({ error: 'ladder_unavailable' });
    const record = req.body || {};
    // Promotion is decided here, on the server, not by the kiosk: a reloaded tab
    // mid-write would otherwise lose a rung the child had earned.
    const ladder = await ladderService.recordGame(userId, record);
    if (!ladder?.persisted) {
      logger?.warn?.('chess.game.record-failed', { userId, result: record.result, moves: record.moves });
      return sendInternalError(res, { error: 'save_failed' });
    }
    logger?.info?.('chess.game.recorded', {
      userId, result: record.result, moves: record.moves, opponent: record.opponent || null,
      counted: ladder.counted, promoted: ladder.promoted,
    });
    // Cosmetic, so it can never turn a saved game into a failure.
    let headToHead = null;
    if (rivalryMemory?.headToHead) {
      try {
        headToHead = await rivalryMemory.headToHead(userId, record);
      } catch (error) {
        logger?.warn?.('chess.game.head-to-head-failed', { userId, reason: error.message });
      }
    }
    const boardGameDay = boardGameDayService?.record({
      learnerId: userId,
      gameId: 'chess',
      gameSessionId: record.game_id,
      completed: record.completed,
      result: record.result,
    }) ?? null;
    return res.status(201).json({ saved: true, ladder, head_to_head: headToHead, boardGameDay });
  }));
```

- [ ] **Step 4: Implement the wiring and removals**

In `backend/src/app.mjs`, change the `ChessRecordNames` import to:

```js
import { buildChessArchiveFilename } from '#adapters/persistence/chess/ChessRecordNames.mjs';
```

Add next to the other chess imports:

```js
import { projectHeadToHead, rivalryOpponentId } from '#apps/piano-games/GameRivalryMemoryService.mjs';
```

Replace `sharedChessRivalry` with:

```js
  const sharedChessRivalry = {
    recordArchive: (record) => pianoGamesModule.container.recordRivalry('chess', record),
    // The record against this opponent, counting the game just finished even
    // if its archive write has not reached rivalry memory yet.
    headToHead: async (userId, record) => {
      const opponentId = rivalryOpponentId(record, 'chess');
      if (!userId || !opponentId) return null;
      const rival = await pianoGamesModule.container.rivalry('chess', userId, opponentId);
      return projectHeadToHead(rival, {
        gameId: record?.game_id, completed: record?.completed, result: record?.result, opponent: record?.opponent,
      });
    },
  };
```

In the `createChessRouter({ ... })` call, delete the whole `recordStore: { save: ... },` property, which is the six lines that write `apps/chess/games/`.

In `ChessRecordNames.mjs`, delete `buildGameRecordFilename` and change the default export to:

```js
export default { buildChessArchiveFilename };
```

Delete the unused modules:

```bash
git rm backend/src/1_adapters/persistence/chess/DataServiceChessRecordStores.mjs backend/src/3_applications/chess/ChessOperations.mjs
```

Confirm nothing still references what was removed:

```bash
grep -rn "buildGameRecordFilename\|recordStore\|ChessOperations\|DataServiceChessRecordStores" backend/src cli shared --include=*.mjs | grep -v "WorkingMemory\|bootstrap.mjs"
```

Expected: no output.

In `frontend/src/modules/Piano/PianoChessGame/chessApi.js`, replace the two sentences of the `archiveGame` doc comment that begin "Separate from `saveGameRecord`, and deliberately:" with:

```js
 * Separate from `saveGameRecord`, and deliberately: that one folds a finished
 * game into the player's ladder, this one is the replayable account of ANY game,
```

- [ ] **Step 5: Update the reference doc**

In `docs/reference/piano/piano-games.md`, replace the body of `### The game record` with:

```markdown
Each finished game posts one record to `POST /api/v1/piano-games/chess/games?user={id}`. It holds
facts, never a score: result, outcome, move count, the help block, the rung and opponent, and
duration. The server folds it into the player's ladder (`apps/chess/ladder.yml`) and answers with
where the game left them:

- `ladder.counted` and `ladder.not_counted`, naming the rule that kept it from counting
  (`best_moves`, `hints`, `takebacks` with `used` and `allowed`, or `other_level` for practice
  against an opponent already beaten)
- `ladder.up_next`, the opponent being climbed toward, and `ladder.status`, the counted wins so far
- `head_to_head`, the lifetime record against this opponent including this game

No per-game file is written by this endpoint. The household archive is the only per-game record
(see [chess.md](chess.md#the-game-history)), and the ladder and rivalry files are derived from it.
Guests are not recorded; they never reach the per-user endpoints.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs backend/src/4_api/v1/routers/lib/chessGameFilename.test.mjs backend/src/3_applications/chess/ backend/src/3_applications/piano-games/`
Expected: PASS.

Run: `npm run check:parse`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A backend/src/4_api/v1/routers/chess.mjs backend/src/4_api/v1/routers/chess.test.mjs backend/src/app.mjs \
  backend/src/1_adapters/persistence/chess/ backend/src/3_applications/chess/ \
  backend/src/4_api/v1/routers/lib/chessGameFilename.test.mjs frontend/src/modules/Piano/PianoChessGame/chessApi.js \
  docs/reference/piano/piano-games.md
git commit -m "feat(chess): the archive is the only game record; POST /games answers with standing

Stops writing users/{id}/apps/chess/games, which nothing read. The ladder
write is now the success condition, and the answer carries whether the game
counted, why not, who is next, and the head-to-head record.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 5: Backfill planner

**Files:**
- Create: `backend/src/3_applications/chess/ChessRecordBackfill.mjs`
- Test: `backend/src/3_applications/chess/ChessRecordBackfill.test.mjs`

**Interfaces:**
- Consumes: `applyGameToProgress`, `createLadderProgress`, `normalizeProgress`, `promotionStatus`, `TOP_LEVEL` from `ladder.mjs`; `GameRivalryMemoryService`; `chessNotableFacts`.
- Produces:
  - `isFinishedGame(record) -> boolean`, true for `completed === true`, `ended_by === 'game_over'` and a non-empty `user_id`.
  - `recordLevel(record) -> number|null`, from `record.level`, else `record.opponent.level`.
  - `chronological(records) -> records[]`, sorted by `ended_at || archived_at || played_on`.
  - `withOpponentIds(records, rosterPackFor: (userId) => string) -> records[]`
  - `replayLadder(records, policy, storedLadder) -> { unlocked_through, results }`
  - `rebuildRivalries(records) -> Promise<{ version: 2, rivals }>`
  - `planUserBackfill({ userId, records, policy, storedLadder }) -> Promise<{ ladder, rivalries }>`
  - `matchScorecards(cards: [{ file, record }], archive: records[]) -> { matched, unmatched }`
  - `summarizeLadder(progress|null, policy) -> { unlocked_through, wins, needed, results }|null`
  - `summarizeRivalries(memory|null) -> { 'Name (id)': 'W-L-D' }`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/3_applications/chess/ChessRecordBackfill.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { DEFAULT_LADDER_POLICY } from '#shared/gaming/rulesets/chess/ladder.mjs';
import {
  chronological, isFinishedGame, matchScorecards, planUserBackfill, recordLevel, replayLadder,
  summarizeLadder, summarizeRivalries, withOpponentIds,
} from './ChessRecordBackfill.mjs';

const POLICY = DEFAULT_LADDER_POLICY;
let clock = 0;
/** An archived game played to checkmate, one hour after the previous one. */
function finished(over = {}) {
  clock += 1;
  return {
    game_id: `chess-${clock}`, user_id: 'kid', completed: true, ended_by: 'game_over',
    result: 'win', outcome: 'checkmate', duration_ms: 60_000 + clock,
    ended_at: new Date(Date.UTC(2026, 7, 13) + clock * 3_600_000).toISOString(),
    help: { hints: 0, best_moves: 0, takebacks: 0 },
    opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    moves: [{ san: 'e4' }, { san: 'Qxf7#' }], move_count: 2,
    ...over,
  };
}

describe('isFinishedGame and recordLevel', () => {
  it('accepts only a named player’s game played to the end', () => {
    expect(isFinishedGame(finished())).toBe(true);
    expect(isFinishedGame(finished({ completed: false, ended_by: 'left' }))).toBe(false);
    expect(isFinishedGame(finished({ user_id: null }))).toBe(false);
  });

  it('reads the level from the record, then from its opponent, else unknown', () => {
    expect(recordLevel(finished({ level: 3 }))).toBe(3);
    expect(recordLevel(finished())).toBe(0);
    expect(recordLevel(finished({ opponent: null }))).toBe(null);
  });
});

describe('withOpponentIds', () => {
  it('gives an old record the id a later record used for the same opponent', () => {
    const [legacy] = withOpponentIds([
      finished({ opponent: { level: 0, name: 'Caterpie' } }),
      finished(),
    ], () => 'generic');
    expect(legacy.opponent.id).toBe('pokemon:level-1');
  });

  it('falls back to the player’s roster pack and a one-based position', () => {
    const [record] = withOpponentIds([finished({ opponent: { level: 3, name: 'Beedrill' } })], (userId) => `${userId}-pack`);
    expect(record.opponent.id).toBe('kid-pack:level-4');
  });

  it('leaves a record with no opponent alone, since nobody can say who it was', () => {
    const record = finished({ opponent: null });
    expect(withOpponentIds([record], () => 'generic')[0]).toBe(record);
  });
});

describe('replayLadder', () => {
  it('promotes on five clean wins and keeps real times', () => {
    const games = Array.from({ length: 5 }, () => finished());
    const ladder = replayLadder(games, POLICY, null);
    expect(ladder.unlocked_through).toBe(1);
    expect(ladder.results.map((entry) => entry.at)).toEqual(games.map((game) => game.ended_at));
  });

  it('records help-heavy wins without counting them', () => {
    const ladder = replayLadder([finished({ help: { hints: 11, best_moves: 14, takebacks: 1 } })], POLICY, null);
    expect(ladder.results).toEqual([expect.objectContaining({ level: 0, result: 'win', counted: false })]);
  });

  it('treats a game played at a level as proof that level was unlocked', () => {
    const strict = { ...POLICY, max_hints: 0 };
    const early = Array.from({ length: 5 }, () => finished({ help: { hints: 1, best_moves: 0, takebacks: 0 } }));
    const later = [finished({ opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } }), finished({ opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } })];
    const ladder = replayLadder([...early, ...later], strict, null);
    expect(ladder.unlocked_through).toBe(1);
    expect(ladder.results.filter((entry) => entry.level === 1 && entry.counted)).toHaveLength(2);
  });

  it('never lowers the stored level', () => {
    expect(replayLadder([finished()], POLICY, { unlocked_through: 3, results: [] }).unlocked_through).toBe(3);
  });

  it('files a game of unknown level at the current level and does not count it', () => {
    const ladder = replayLadder([finished({ opponent: null, result: 'loss' })], POLICY, null);
    expect(ladder.results).toEqual([expect.objectContaining({ level: 0, result: 'loss', counted: false })]);
  });

  it('replays in the order games ended, not the order given', () => {
    const first = finished({ result: 'loss' });
    const second = finished();
    expect(replayLadder([second, first], POLICY, null).results.map((entry) => entry.result)).toEqual(['loss', 'win']);
    expect(chronological([second, first])[0]).toBe(first);
  });
});

describe('planUserBackfill', () => {
  it('rebuilds rivalry totals per opponent from this player’s finished games only', async () => {
    const records = withOpponentIds([
      finished({ opponent: { level: 0, name: 'Caterpie' } }),
      finished(),
      finished({ result: 'loss', opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } }),
      finished({ completed: false, ended_by: 'left', result: null }),
      finished({ user_id: 'sibling' }),
    ], () => 'generic');
    const plan = await planUserBackfill({ userId: 'kid', records, policy: POLICY, storedLadder: null });
    expect(summarizeRivalries(plan.rivalries)).toEqual({
      'Caterpie (pokemon:level-1)': '2-0-0',
      'Weedle (pokemon:level-2)': '0-1-0',
    });
    expect(plan.ladder.results).toHaveLength(3);
  });
});

describe('matchScorecards', () => {
  it('matches by game id, else by result and duration within 50ms', () => {
    const archive = [finished({ game_id: 'a', duration_ms: 3_499_621, result: 'loss' }), finished({ game_id: 'b' })];
    const cards = [
      { file: 'one.yml', record: { user_id: 'kid', result: 'loss', duration_ms: 3_499_617 } },
      { file: 'two.yml', record: { user_id: 'kid', game_id: 'b', result: 'win' } },
      { file: 'three.yml', record: { user_id: 'kid', game_id: 'zzz', result: 'win', duration_ms: 1 } },
    ];
    const { matched, unmatched } = matchScorecards(cards, archive);
    expect(matched.map((card) => card.file)).toEqual(['one.yml', 'two.yml']);
    expect(unmatched.map((card) => card.file)).toEqual(['three.yml']);
  });
});

describe('summarizeLadder', () => {
  it('reports level, counted wins and history length, or null for no file', () => {
    expect(summarizeLadder(null, POLICY)).toBe(null);
    const ladder = replayLadder([finished(), finished({ help: { hints: 5, best_moves: 0, takebacks: 0 } })], POLICY, null);
    expect(summarizeLadder(ladder, POLICY)).toEqual({ unlocked_through: 0, wins: 1, needed: 5, results: 2 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/3_applications/chess/ChessRecordBackfill.test.mjs`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/3_applications/chess/ChessRecordBackfill.mjs`:

```js
import {
  TOP_LEVEL, applyGameToProgress, createLadderProgress, normalizeProgress, promotionStatus,
} from '#shared/gaming/rulesets/chess/ladder.mjs';
import { chessNotableFacts } from '#shared/gaming/rulesets/chess/dialogueAdapter.mjs';
import { GameRivalryMemoryService } from '#apps/piano-games/GameRivalryMemoryService.mjs';

/**
 * Rebuild a player's derived chess state from the household archive.
 *
 * The ladder file and rivalry memory are both folds over games that were
 * played. They went wrong in the ordinary ways: rivalry memory started after
 * the first wins, ladder results were written without times, and the archive
 * itself lived in two directories. The archive is the one record that holds
 * every game, so replaying it through the live rules is the repair.
 *
 * Pure: no files. `cli/chess-backfill.cli.mjs` does the reading and writing.
 */

/** A game the ladder and rivalry memory would have seen: a named player's, played to the end. */
export function isFinishedGame(record) {
  return !!record && record.completed === true && record.ended_by === 'game_over'
    && typeof record.user_id === 'string' && record.user_id.length > 0;
}

/** The level a game was played at, or null when the record never said. */
export function recordLevel(record) {
  const raw = record?.level ?? record?.opponent?.level;
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.floor(Number(raw)));
}

const endedAt = (record) => String(record?.ended_at || record?.archived_at || record?.played_on || '');

/** Oldest first, by when each game ended. */
export function chronological(records) {
  return [...records].sort((a, b) => endedAt(a).localeCompare(endedAt(b)));
}

/**
 * Opponent ids for games archived before records carried one.
 *
 * Rivalry memory is keyed by id, and an old record has only a level and a
 * name. Where a later record used an id for that same level and name, that id
 * is the right one. Otherwise it is the id the live roster would build: the
 * player's roster pack and a one-based position. A record with no opponent at
 * all is left alone, because nothing can say who it was.
 */
export function withOpponentIds(records, rosterPackFor) {
  const known = new Map();
  for (const record of records) {
    const level = recordLevel(record);
    if (record?.opponent?.id && record.opponent.name && level !== null) {
      known.set(`${level}|${record.opponent.name}`, record.opponent.id);
    }
  }
  return records.map((record) => {
    if (!record?.opponent?.name || record.opponent.id) return record;
    const level = recordLevel(record);
    if (level === null) return record;
    const id = known.get(`${level}|${record.opponent.name}`) || `${rosterPackFor(record.user_id)}:level-${level + 1}`;
    return { ...record, opponent: { ...record.opponent, id } };
  });
}

/**
 * Replay finished games through the live promotion rule.
 *
 * Two floors keep a replay from taking anything away. A game played at level L
 * proves L was unlocked, because the move endpoint refuses to play above the
 * unlocked level, so the replay is raised to L before that game is applied.
 * And the stored level is never lowered, whatever the replay concludes.
 */
export function replayLadder(records, policy, storedLadder) {
  let progress = createLadderProgress();
  for (const record of chronological(records)) {
    const level = recordLevel(record);
    const floor = level === null ? progress.unlocked_through : Math.min(TOP_LEVEL, Math.max(progress.unlocked_through, level));
    // An unknown level must not read as level 0: `Number(null)` is 0, and that
    // would count a game nobody can place.
    const input = { ...record, level: level === null ? undefined : level };
    progress = applyGameToProgress({ ...progress, unlocked_through: floor }, input, policy).progress;
  }
  const stored = storedLadder ? normalizeProgress(storedLadder).unlocked_through : 0;
  return { unlocked_through: Math.max(stored, progress.unlocked_through), results: progress.results };
}

/** Rivalry memory as the live service would have built it, had it seen every game. */
export async function rebuildRivalries(records) {
  let memory = null;
  const service = new GameRivalryMemoryService({
    readMemory: async () => memory,
    writeMemory: async (_gameId, _userId, next) => { memory = structuredClone(next); return true; },
    notableFacts: { chess: chessNotableFacts },
  });
  for (const record of chronological(records)) await service.recordArchive('chess', record);
  return memory || { version: 2, rivals: {} };
}

/** Everything derived for one player, from their finished games. */
export async function planUserBackfill({ userId, records, policy, storedLadder }) {
  const finished = chronological(records.filter((record) => isFinishedGame(record) && record.user_id === userId));
  return {
    ladder: replayLadder(finished, policy, storedLadder),
    rivalries: await rebuildRivalries(finished),
  };
}

/**
 * Pair each per-player scorecard with the archived game it duplicates, so none
 * is retired unaccounted for.
 *
 * Scorecards from before game ids carry none. Those match on player, result
 * and a duration within 50ms: both writers took the duration from the same
 * game clock, and the measured drift between them is a few milliseconds.
 */
export function matchScorecards(cards, archive) {
  const byId = new Map(archive.filter((record) => record?.game_id).map((record) => [record.game_id, record]));
  const matched = [];
  const unmatched = [];
  for (const card of cards) {
    const record = card.record || {};
    const hit = (record.game_id && byId.get(record.game_id))
      || archive.find((game) => game?.user_id === record.user_id && game?.result === record.result
        && Number.isFinite(Number(record.duration_ms))
        && Math.abs(Number(game?.duration_ms) - Number(record.duration_ms)) <= 50);
    (hit ? matched : unmatched).push(card);
  }
  return { matched, unmatched };
}

/** One line's worth of a ladder file, for a before-and-after report. */
export function summarizeLadder(progress, policy) {
  if (!progress) return null;
  const normalized = normalizeProgress(progress);
  const status = promotionStatus(normalized, policy);
  return { unlocked_through: normalized.unlocked_through, wins: status.wins, needed: status.needed, results: normalized.results.length };
}

/** Each rival's lifetime record as `W-L-D`, keyed by name and id. */
export function summarizeRivalries(memory) {
  const summary = {};
  for (const [id, rival] of Object.entries(memory?.rivals || {})) {
    const record = rival?.record || {};
    summary[`${rival?.opponent?.name || 'unnamed'} (${id})`] = `${record.win || 0}-${record.loss || 0}-${record.draw || 0}`;
  }
  return summary;
}

export default {
  isFinishedGame, recordLevel, chronological, withOpponentIds, replayLadder, rebuildRivalries,
  planUserBackfill, matchScorecards, summarizeLadder, summarizeRivalries,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/3_applications/chess/ChessRecordBackfill.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/chess/ChessRecordBackfill.mjs backend/src/3_applications/chess/ChessRecordBackfill.test.mjs
git commit -m "feat(chess): replay the archive into ladder and rivalry state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 6: Backfill CLI

**Files:**
- Create: `cli/chess-backfill.cli.mjs`
- Test: `cli/chess-backfill.cli.test.mjs`
- Modify: `docs/reference/piano/chess.md` (section "The game history")

**Interfaces:**
- Consumes: every export of Task 5; `mergeLadderConfig` and `resolvePolicy` from `ladder.mjs`; `buildChessArchiveFilename(record, userSlug, date)`; `CHESS_ARCHIVE_DIR`.
- Produces:
  - `parseArgs(argv) -> { data, user, write, help }`
  - `loadArchive(roots: string[]) -> records[]`
  - `consolidateArchive({ householdDir, deleteDir, write }) -> { moved, renamed, conflicts: string[], retiredDir }`
  - `retireScorecards({ dataDir, archive, deleteDir, write, users }) -> { [userId]: { matched, unmatched: string[] } }`
  - `rebuildDerived({ dataDir, archive, users, write }) -> Promise<{ [userId]: { games, ladder: { before, after }, rivalries: { before, after } } | { games, skipped } }>`
  - `run({ data, user, write, now }) -> Promise<report>`
  - `renderReport(report) -> string`

- [ ] **Step 1: Write the failing tests**

Create `cli/chess-backfill.cli.test.mjs`:

```js
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, renderReport, run } from './chess-backfill.cli.mjs';

const NOW = new Date('2026-09-15T12:00:00');
const DELETED = '_deleteme/2026-09-15-chess-record-consolidation';

const put = (root, rel, value) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value));
};
const read = (root, rel) => YAML.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const tree = (root) => {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  };
  walk(root);
  return files;
};
const game = (over) => ({
  completed: true, ended_by: 'game_over', user_id: 'kid', result: 'win', outcome: 'checkmate',
  help: { hints: 0, best_moves: 0, takebacks: 0 }, moves: [{ san: 'e4' }], move_count: 1, ...over,
});

let data;

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-backfill-'));
  put(data, 'household/gaming/chess.yml', { ladder: { roster_pack: 'generic', promotion: { window: 7, wins_required: 5 } } });
  put(data, 'users/kid/apps/chess/config.yml', { ladder: { roster_pack: 'pokemon' } });
  put(data, 'users/kid/apps/chess/ladder.yml', { unlocked_through: 0, results: [] });
  put(data, 'users/kid/apps/chess/rivalries.yml', { version: 2, rivals: {} });
  // Old directory, old filename, no opponent: from before ladder telemetry.
  put(data, 'household/gaming/log/pianochess/2026-08-13/kid-2026-08-13T17-03-53-612Z.yml', game({
    game_id: 'chess-1', result: 'loss', ended_at: '2026-08-13T17:03:52.804Z', archived_at: '2026-08-13T17:03:53.612Z',
    duration_ms: 3_499_621, help: { hints: 21, best_moves: 30, takebacks: 0 },
  }));
  // Old directory, current filename, an opponent with a name but no id yet.
  put(data, 'household/gaming/log/pianochess/2026-08-23/kid_level0_31m29s_1ply_win_checkmate_2026-08-23T23-44-11-865Z-aaaa.yml', game({
    game_id: 'chess-2', ended_at: '2026-08-23T23:44:11.850Z', duration_ms: 1_889_550, opponent: { level: 0, name: 'Caterpie' },
  }));
  // An abandoned game, which neither the ladder nor rivalry memory ever saw.
  put(data, 'household/gaming/log/pianochess/2026-08-24/kid_level0_2m38s_7ply_quit_quit_2026-08-24T16-30-30-633Z-bbbb.yml', game({
    game_id: 'chess-3', completed: false, ended_by: 'left', result: null, ended_at: '2026-08-24T16:30:30.000Z',
    opponent: { level: 0, name: 'Caterpie' },
  }));
  // Current directory, carrying the id the old records lacked.
  put(data, 'household/gaming/log/chess/2026-09-13/kid_level0_18m31s_1ply_win_checkmate_2026-09-13T16-12-09-595Z-cccc.yml', game({
    game_id: 'chess-4', ended_at: '2026-09-13T16:12:08.352Z', duration_ms: 1_111_425,
    opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
  }));
  // Scorecards: one from before game ids, one with an id, one the archive never received.
  put(data, 'users/kid/apps/chess/games/2026-08-23-1111.yml', { result: 'win', duration_ms: 1_889_550, user_id: 'kid' });
  put(data, 'users/kid/apps/chess/games/2026-09-13-2222.yml', { game_id: 'chess-4', result: 'win', duration_ms: 1_111_425, user_id: 'kid' });
  put(data, 'users/kid/apps/chess/games/2026-09-14-3333.yml', { game_id: 'chess-99', result: 'win', duration_ms: 5, user_id: 'kid' });
});

afterEach(() => fs.rmSync(data, { recursive: true, force: true }));

describe('parseArgs', () => {
  it('is a dry run unless told to write', () => {
    expect(parseArgs(['--data', '/srv/data'])).toMatchObject({ data: '/srv/data', write: false, user: null });
    expect(parseArgs(['--data', '/srv/data', '--write', '--user', 'kid'])).toMatchObject({ write: true, user: 'kid' });
  });

  it('refuses a flag without its value, and an unknown flag', () => {
    expect(() => parseArgs(['--data'])).toThrow('--data requires a value');
    expect(() => parseArgs(['--force'])).toThrow('Unknown argument: --force');
  });
});

describe('dry run', () => {
  it('reports the whole plan and changes nothing on disk', async () => {
    const before = tree(data);
    const report = await run({ data, now: NOW });
    expect(tree(data)).toEqual(before);
    expect(report.consolidation).toMatchObject({ moved: 3, renamed: 1, conflicts: [] });
    expect(report.scorecards.kid).toEqual({ matched: 2, unmatched: ['2026-09-14-3333.yml'] });
    expect(report.derived.kid.rivalries.after).toEqual({ 'Caterpie (pokemon:level-1)': '2-0-0' });
    expect(renderReport(report)).toContain('DRY RUN');
  });
});

describe('--write', () => {
  it('moves the old archive in under current names and retires the old directory', async () => {
    await run({ data, write: true, now: NOW });
    const files = tree(data);
    expect(files.some((file) => file.startsWith('household/gaming/log/pianochess'))).toBe(false);
    expect(fs.existsSync(path.join(data, DELETED, 'pianochess-archive'))).toBe(true);
    const aug13 = files.filter((file) => file.startsWith('household/gaming/log/chess/2026-08-13/'));
    expect(aug13).toHaveLength(1);
    expect(path.basename(aug13[0])).toMatch(/^kid_levelunknown_58m19s_1ply_loss_checkmate_2026-08-13T17-03-53-612Z-.+\.yml$/);
    expect(files).toContain('household/gaming/log/chess/2026-08-23/kid_level0_31m29s_1ply_win_checkmate_2026-08-23T23-44-11-865Z-aaaa.yml');
  });

  it('retires only the scorecards the archive holds', async () => {
    await run({ data, write: true, now: NOW });
    expect(fs.readdirSync(path.join(data, 'users/kid/apps/chess/games'))).toEqual(['2026-09-14-3333.yml']);
    expect(fs.readdirSync(path.join(data, DELETED, 'scorecards/kid')).sort()).toEqual(['2026-08-23-1111.yml', '2026-09-13-2222.yml']);
  });

  it('rebuilds the ladder and rivalry files from every finished game, with real times', async () => {
    await run({ data, write: true, now: NOW });
    const ladder = read(data, 'users/kid/apps/chess/ladder.yml');
    expect(ladder).toEqual({
      unlocked_through: 0,
      results: [
        { level: 0, result: 'loss', counted: false, at: '2026-08-13T17:03:52.804Z' },
        { level: 0, result: 'win', counted: true, at: '2026-08-23T23:44:11.850Z' },
        { level: 0, result: 'win', counted: true, at: '2026-09-13T16:12:08.352Z' },
      ],
    });
    const rivalries = read(data, 'users/kid/apps/chess/rivalries.yml');
    expect(Object.keys(rivalries.rivals)).toEqual(['pokemon:level-1']);
    expect(rivalries.rivals['pokemon:level-1'].record).toEqual({ win: 2, loss: 0, draw: 0 });
  });

  it('creates no chess profile for a player who never had one', async () => {
    put(data, 'users/visitor/profile.yml', { name: 'Visitor' });
    put(data, 'household/gaming/log/chess/2026-09-13/visitor_level0_1s_1ply_win_checkmate_2026-09-13T10-00-00-000Z-dddd.yml', game({
      game_id: 'chess-5', user_id: 'visitor', ended_at: '2026-09-13T10:00:00.000Z', opponent: { level: 0, name: 'Pip' },
    }));
    const report = await run({ data, write: true, now: NOW });
    expect(report.derived.visitor).toEqual({ games: 1, skipped: 'no chess profile' });
    expect(fs.existsSync(path.join(data, 'users/visitor/apps'))).toBe(false);
  });

  it('is safe to run twice', async () => {
    await run({ data, write: true, now: NOW });
    const once = tree(data);
    const again = await run({ data, write: true, now: NOW });
    expect(tree(data)).toEqual(once);
    expect(again.consolidation.moved).toBe(0);
    expect(again.scorecards.kid).toEqual({ matched: 0, unmatched: ['2026-09-14-3333.yml'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run cli/chess-backfill.cli.test.mjs`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

Create `cli/chess-backfill.cli.mjs`:

```js
#!/usr/bin/env node
/**
 * Consolidate chess game records into the household archive, and rebuild the
 * ladder and rivalry files derived from it.
 *
 * Game records once lived in three places: the archive's current directory,
 * the directory it had before the household reorganisation, and a per-player
 * scorecard that nothing read. This moves the old archive into the current one
 * under current filenames, retires scorecards whose games the archive already
 * holds, and replays every finished game so each player's ladder and rivalry
 * files match what was actually played.
 *
 * Dry run by default. Nothing is deleted: whatever leaves its place goes to
 * `_deleteme/`. Run it where the data tree is writable as the app's owner; the
 * files and directories it creates take their parent directory's owner.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { CHESS_ARCHIVE_DIR } from '../shared/gaming/rulesets/chess/archivePaths.mjs';
import { mergeLadderConfig, resolvePolicy } from '../shared/gaming/rulesets/chess/ladder.mjs';
import { buildChessArchiveFilename } from '../backend/src/1_adapters/persistence/chess/ChessRecordNames.mjs';
import {
  isFinishedGame, matchScorecards, planUserBackfill, summarizeLadder, summarizeRivalries, withOpponentIds,
} from '../backend/src/3_applications/chess/ChessRecordBackfill.mjs';

/** Where the archive lived before the household reorganisation, under the household root. */
export const LEGACY_ARCHIVE_DIR = 'gaming/log/pianochess';
/** The household chess config, under the household root. */
export const HOUSEHOLD_CHESS_CONFIG = 'gaming/chess.yml';

const USAGE = `Consolidate chess records and rebuild ladder and rivalry files.

  node cli/chess-backfill.cli.mjs [--data <data dir>] [--user <id>] [--write]

  --data <dir>   The data directory (default: $DAYLIGHT_BASE_PATH/data)
  --user <id>    Retire scorecards and rebuild derived files for one player only.
                 Consolidating the archive is always household-wide.
  --write        Apply. Without it, report what would change and touch nothing.
  -h, --help     Show this help
`;

export function parseArgs(argv) {
  const options = { data: null, user: null, write: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data' || token === '--user') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
      index += 1;
    } else if (token === '--write') options.write = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.data && process.env.DAYLIGHT_BASE_PATH) options.data = path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  return options;
}

const readYaml = (file) => (fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) : null);

/**
 * Give a created path its reference's owner. Inside the container this runs as
 * root, and a root-owned file is one the app can read but never write again.
 * Outside it, chown to our own uid changes nothing and to anyone else's fails;
 * in both cases there is nothing to fix.
 */
function matchOwner(target, reference) {
  try {
    const { uid, gid } = fs.statSync(reference);
    fs.chownSync(target, uid, gid);
  } catch { /* see above */ }
}

function ensureDir(dir, reference) {
  if (fs.existsSync(dir)) return;
  ensureDir(path.dirname(dir), reference);
  fs.mkdirSync(dir);
  matchOwner(dir, reference);
}

function writeYaml(file, value) {
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, YAML.stringify(value));
  if (!existed) matchOwner(file, path.dirname(file));
}

function ymlFilesByDay(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const day of fs.readdirSync(root).sort()) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir).sort()) {
      if (name.endsWith('.yml')) files.push({ day, name, file: path.join(dayDir, name) });
    }
  }
  return files;
}

/** Every archived game under these roots, each game once. */
export function loadArchive(roots) {
  const seen = new Set();
  const records = [];
  for (const root of roots) {
    for (const entry of ymlFilesByDay(root)) {
      const record = readYaml(entry.file);
      if (!record || typeof record !== 'object') continue;
      const key = `${record.game_id || entry.name}|${record.started_at || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
  }
  return records;
}

/** Current names lead with `user_level…_`; the oldest files are `user-timestamp.yml`. */
const isLegacyName = (name) => !/_level(\d+|unknown)_/.test(name);

/**
 * Move the pre-reorganisation archive into the current one.
 *
 * Old-style names are rebuilt with the current scheme, stamped with when the
 * game was archived, so filename filters in the review CLIs see them. A file
 * whose destination already exists is a conflict and stays where it is, and
 * then the old directory is not retired either.
 */
export function consolidateArchive({ householdDir, deleteDir, write }) {
  const legacyRoot = path.join(householdDir, ...LEGACY_ARCHIVE_DIR.split('/'));
  const root = path.join(householdDir, ...CHESS_ARCHIVE_DIR.split('/'));
  const report = { moved: 0, renamed: 0, conflicts: [], retiredDir: null };
  if (!fs.existsSync(legacyRoot)) return report;
  for (const { day, name, file } of ymlFilesByDay(legacyRoot)) {
    const record = readYaml(file) || {};
    const target = isLegacyName(name)
      ? `${buildChessArchiveFilename(record, record.user_id || 'guest', new Date(record.archived_at || record.ended_at || `${day}T12:00:00Z`))}.yml`
      : name;
    const destination = path.join(root, day, target);
    if (fs.existsSync(destination)) {
      report.conflicts.push(path.relative(householdDir, file));
      continue;
    }
    report.moved += 1;
    if (target !== name) report.renamed += 1;
    if (!write) continue;
    ensureDir(path.join(root, day), root);
    fs.renameSync(file, destination);
  }
  if (write && report.conflicts.length === 0) {
    ensureDir(deleteDir, path.dirname(deleteDir));
    report.retiredDir = path.join(deleteDir, 'pianochess-archive');
    fs.renameSync(legacyRoot, report.retiredDir);
  }
  return report;
}

/** Move each player's scorecards whose games the archive holds to `_deleteme/`. */
export function retireScorecards({ dataDir, archive, deleteDir, write, users }) {
  const report = {};
  for (const userId of users) {
    const gamesDir = path.join(dataDir, 'users', userId, 'apps', 'chess', 'games');
    if (!fs.existsSync(gamesDir)) continue;
    const cards = fs.readdirSync(gamesDir).filter((name) => name.endsWith('.yml')).sort()
      .map((name) => ({ file: path.join(gamesDir, name), record: readYaml(path.join(gamesDir, name)) || {} }));
    const { matched, unmatched } = matchScorecards(cards, archive);
    report[userId] = { matched: matched.length, unmatched: unmatched.map((card) => path.basename(card.file)) };
    if (!write || matched.length === 0) continue;
    const target = path.join(deleteDir, 'scorecards', userId);
    ensureDir(target, path.dirname(deleteDir));
    for (const card of matched) fs.renameSync(card.file, path.join(target, path.basename(card.file)));
    if (fs.readdirSync(gamesDir).length === 0) fs.renameSync(gamesDir, path.join(target, 'games-dir'));
  }
  return report;
}

/** Rebuild each player's ladder and rivalry files from their finished games. */
export async function rebuildDerived({ dataDir, archive, users, write }) {
  const householdConfig = readYaml(path.join(dataDir, 'household', ...HOUSEHOLD_CHESS_CONFIG.split('/')));
  if (!householdConfig) throw new Error(`No household chess config at household/${HOUSEHOLD_CHESS_CONFIG}`);
  const configFor = (userId) => mergeLadderConfig(
    householdConfig,
    readYaml(path.join(dataDir, 'users', String(userId), 'apps', 'chess', 'config.yml')) || {},
  );
  const records = withOpponentIds(archive, (userId) => configFor(userId).ladder.roster_pack || 'chess');
  const report = {};
  for (const userId of users) {
    const games = records.filter((record) => isFinishedGame(record) && record.user_id === userId).length;
    if (games === 0) continue;
    const chessDir = path.join(dataDir, 'users', userId, 'apps', 'chess');
    // A player with games but no chess profile has nothing to repair, and
    // creating one here would invent state the app never wrote.
    if (!fs.existsSync(chessDir)) {
      report[userId] = { games, skipped: 'no chess profile' };
      continue;
    }
    const policy = resolvePolicy(configFor(userId));
    const ladderFile = path.join(chessDir, 'ladder.yml');
    const rivalriesFile = path.join(chessDir, 'rivalries.yml');
    const storedLadder = readYaml(ladderFile);
    const plan = await planUserBackfill({ userId, records, policy, storedLadder });
    report[userId] = {
      games,
      ladder: { before: summarizeLadder(storedLadder, policy), after: summarizeLadder(plan.ladder, policy) },
      rivalries: { before: summarizeRivalries(readYaml(rivalriesFile)), after: summarizeRivalries(plan.rivalries) },
    };
    if (!write) continue;
    writeYaml(ladderFile, plan.ladder);
    writeYaml(rivalriesFile, plan.rivalries);
  }
  return report;
}

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function run({ data, user = null, write = false, now = new Date() }) {
  if (!data) throw new Error('Pass --data <data dir> or set DAYLIGHT_BASE_PATH');
  const householdDir = path.join(data, 'household');
  const archiveRoot = path.join(householdDir, ...CHESS_ARCHIVE_DIR.split('/'));
  // Loudly, not emptily: a wrong path must never look like an empty archive.
  if (!fs.existsSync(archiveRoot)) throw new Error(`No chess archive at ${archiveRoot}`);
  const legacyRoot = path.join(householdDir, ...LEGACY_ARCHIVE_DIR.split('/'));
  const deleteDir = path.join(data, '_deleteme', `${localDay(now)}-chess-record-consolidation`);
  const usersDir = path.join(data, 'users');
  const allUsers = fs.existsSync(usersDir)
    ? fs.readdirSync(usersDir).filter((id) => fs.statSync(path.join(usersDir, id)).isDirectory()).sort()
    : [];
  const users = user ? allUsers.filter((id) => id === user) : allUsers;

  // Read every game before anything moves, so a dry run and a write judge the same games.
  const archive = loadArchive([archiveRoot, legacyRoot]);
  const consolidation = consolidateArchive({ householdDir, deleteDir, write });
  const scorecards = retireScorecards({ dataDir: data, archive, deleteDir, write, users });
  const derived = await rebuildDerived({ dataDir: data, archive, users, write });
  return { write, archive: { games: archive.length }, consolidation, scorecards, derived };
}

export function renderReport(report) {
  const lines = [report.write ? 'Chess record backfill: WRITTEN' : 'Chess record backfill: DRY RUN (pass --write to apply)'];
  lines.push(`Archive: ${report.archive.games} games read`);
  const { consolidation } = report;
  lines.push(`Old archive directory: ${consolidation.moved} files to move, ${consolidation.renamed} renamed from old names, ${consolidation.conflicts.length} conflicts`);
  for (const conflict of consolidation.conflicts) lines.push(`  conflict, left in place: ${conflict}`);
  if (consolidation.retiredDir) lines.push(`  old directory moved to ${consolidation.retiredDir}`);
  for (const [userId, cards] of Object.entries(report.scorecards)) {
    lines.push(`Scorecards ${userId}: ${cards.matched} held by the archive, ${cards.unmatched.length} not`);
    for (const name of cards.unmatched) lines.push(`  not in archive, kept: ${name}`);
  }
  const ladderText = (ladder) => (ladder
    ? `level ${ladder.unlocked_through}, ${ladder.wins} of ${ladder.needed} wins, ${ladder.results} results`
    : 'no file');
  for (const [userId, entry] of Object.entries(report.derived)) {
    if (entry.skipped) {
      lines.push(`Ladder ${userId}: skipped, ${entry.skipped} (${entry.games} finished games)`);
      continue;
    }
    lines.push(`Ladder ${userId} (${entry.games} finished games): ${ladderText(entry.ladder.before)} -> ${ladderText(entry.ladder.after)}`);
    const rivals = new Set([...Object.keys(entry.rivalries.before), ...Object.keys(entry.rivalries.after)]);
    for (const rival of rivals) {
      lines.push(`  ${rival}: ${entry.rivalries.before[rival] || '0-0-0'} -> ${entry.rivalries.after[rival] || '0-0-0'}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    process.stdout.write(`${renderReport(await run(options))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run cli/chess-backfill.cli.test.mjs backend/src/3_applications/chess/ChessRecordBackfill.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update the reference doc**

In `docs/reference/piano/chess.md`, section `## The game history`, replace the first paragraph's path sentence and the scorecard sentence:

- Change "Every game played on this piano is archived under `data/household/history/gaming/pianochess/YYYY-MM-DD/`" to "Every game played on this piano is archived under `data/household/gaming/log/chess/YYYY-MM-DD/`".
- Replace "This is separate from the player's own scorecard (`apps/chess/games/`), which only exists for games that finished, and it answers a different question: *how is this child actually doing, over months?*" with "It is the only per-game record. A player's ladder (`apps/chess/ladder.yml`) and rivalry memory (`apps/chess/rivalries.yml`) are derived from finished games, and the archive answers the question neither can: *how is this child actually doing, over months?*"

Insert this subsection directly before `### Dialogue evidence`:

```markdown
### Rebuilding derived records

`cli/chess-backfill.cli.mjs` repairs everything derived from the archive. It moves any games still
in the pre-reorganisation directory (`gaming/log/pianochess/`) into the current one, renaming the
oldest `user-timestamp.yml` files to the current scheme so filename filters find them. It retires
per-player scorecards (`apps/chess/games/`, no longer written) once the archive is shown to hold
each game; one it cannot match stays where it is and is named in the report. Then it replays every
finished game through the live ladder and rivalry rules and rewrites each player's `ladder.yml` and
`rivalries.yml`.

The replay never takes a rung away. A game played at a level proves that level was unlocked, and
the stored level is never lowered. A player with finished games but no `apps/chess/` directory is
reported and left alone.

It is a dry run unless given `--write`, and nothing is deleted: moved files land in
`data/_deleteme/<date>-chess-record-consolidation/`. Writes must be made as the app's user, so run
it inside the container, where created paths take their parent directory's owner:

    sudo docker exec {env.docker_container} node cli/chess-backfill.cli.mjs --data data
    sudo docker exec {env.docker_container} node cli/chess-backfill.cli.mjs --data data --write

It is safe to run again. A second write finds nothing to move and rewrites identical files.
```

- [ ] **Step 6: Commit**

```bash
git add cli/chess-backfill.cli.mjs cli/chess-backfill.cli.test.mjs docs/reference/piano/chess.md
git commit -m "feat(chess): backfill CLI consolidates the archive and rebuilds derived records

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 7: Result card shows standing

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chessStandingLines.js`
- Create: `frontend/src/modules/Piano/PianoChessGame/chessStandingLines.test.js`
- Create: `frontend/src/modules/Piano/PianoChessGame/ChessResult.test.jsx`
- Modify: `frontend/src/modules/Piano/game-platform/host/BoardGameResult.jsx`
- Modify: `frontend/src/modules/Piano/game-platform/host/BoardGameResult.test.jsx`
- Modify: `frontend/src/modules/Piano/game-platform/host/boardGameCeremony.scss`
- Modify: `frontend/src/modules/Piano/PianoChessGame/ChessResult.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.js`
- Modify: `frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.test.jsx`
- Modify: `docs/reference/piano/chess.md`

**Interfaces:**
- Consumes: the `POST /games` response from Task 4, `{ ladder: { persisted, promoted, counted, not_counted, up_next, status }, head_to_head }`.
- Produces: `ladderOutcome` from `useChessPersistenceLifecycle` becomes `{ ...response.ladder, head_to_head: response.head_to_head ?? null }`.
- Produces: `standingLines({ result, ladder }) -> string[]` and `headToHeadLine(headToHead) -> string|null`.
- Produces: `BoardGameResult` accepts `notes?: string[]`, rendered as `ul.pg-result__notes` after the promotion line.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/modules/Piano/PianoChessGame/chessStandingLines.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { headToHeadLine, standingLines } from './chessStandingLines.js';

const ladder = (over = {}) => ({
  persisted: true, promoted: false, counted: true, not_counted: null,
  up_next: { level: 2, name: 'Kakuna' }, status: { wins: 3, needed: 5, at_top: false },
  head_to_head: { opponent: { name: 'Weedle' }, win: 6, loss: 1, draw: 0 },
  ...over,
});

describe('headToHeadLine', () => {
  it('counts wins and losses, and draws only when there were any', () => {
    expect(headToHeadLine({ opponent: { name: 'Weedle' }, win: 1, loss: 0, draw: 0 })).toBe('You vs Weedle: 1 win, 0 losses');
    expect(headToHeadLine({ opponent: { name: 'Weedle' }, win: 2, loss: 1, draw: 2 })).toBe('You vs Weedle: 2 wins, 1 loss, 2 draws');
  });

  it('says nothing without a named opponent', () => {
    expect(headToHeadLine(null)).toBe(null);
    expect(headToHeadLine({ opponent: {}, win: 1, loss: 0, draw: 0 })).toBe(null);
  });
});

describe('standingLines', () => {
  it('says nothing for a guest or a game that did not save', () => {
    expect(standingLines({ result: 'win', ladder: null })).toEqual([]);
    expect(standingLines({ result: 'win', ladder: ladder({ persisted: false }) })).toEqual([]);
  });

  it('gives the record and the progress after a counted game', () => {
    expect(standingLines({ result: 'win', ladder: ladder() })).toEqual([
      'You vs Weedle: 6 wins, 1 loss',
      '3 of 5 wins toward Kakuna',
    ]);
  });

  it('names the rule a help-heavy win broke', () => {
    const cases = [
      ['best_moves', 14, 0, '14 best-move requests, 0 allowed'],
      ['best_moves', 1, 0, '1 best-move request, 0 allowed'],
      ['hints', 3, 1, '3 hints, 1 allowed'],
      ['takebacks', 2, 1, '2 takebacks, 1 allowed'],
    ];
    for (const [reason, used, allowed, words] of cases) {
      const lines = standingLines({ result: 'win', ladder: ladder({ counted: false, not_counted: { reason, used, allowed } }) });
      expect(lines[1]).toBe(`This win didn't count toward Kakuna: ${words}.`);
    }
  });

  it('calls a win against an already-beaten opponent practice', () => {
    const lines = standingLines({ result: 'win', ladder: ladder({ counted: false, not_counted: { reason: 'other_level', level: 0 } }) });
    expect(lines[1]).toBe("Practice game. It doesn't count toward Kakuna.");
  });

  it('does not explain why a loss did not count', () => {
    const lines = standingLines({ result: 'loss', ladder: ladder({ counted: false, not_counted: { reason: 'hints', used: 3, allowed: 1 } }) });
    expect(lines).toEqual(['You vs Weedle: 6 wins, 1 loss', '3 of 5 wins toward Kakuna']);
  });

  it('leaves progress to the promotion banner when this game promoted', () => {
    expect(standingLines({ result: 'win', ladder: ladder({ promoted: true }) })).toEqual(['You vs Weedle: 6 wins, 1 loss']);
  });

  it('has no progress line at the top of the ladder', () => {
    const top = ladder({ up_next: null, status: { wins: 5, needed: 5, at_top: true }, counted: false, not_counted: { reason: 'hints', used: 3, allowed: 1 } });
    expect(standingLines({ result: 'win', ladder: top })).toEqual([
      'You vs Weedle: 6 wins, 1 loss',
      "This win didn't count: 3 hints, 1 allowed.",
    ]);
  });
});
```

Create `frontend/src/modules/Piano/PianoChessGame/ChessResult.test.jsx`:

```jsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChessResult } from './ChessResult.jsx';

describe('ChessResult', () => {
  it('shows the head-to-head record, why a win did not count, and the climb', () => {
    const { getByText } = render(
      <ChessResult
        result="win"
        outcome="checkmate"
        opponent={{ name: 'Weedle' }}
        level={1}
        record={{ moves: 31, help: { hints: 11, best_moves: 14, takebacks: 1 } }}
        ladder={{
          persisted: true, promoted: false, counted: false,
          not_counted: { reason: 'best_moves', used: 14, allowed: 0 },
          up_next: { level: 2, name: 'Kakuna' },
          status: { wins: 2, needed: 5, at_top: false },
          head_to_head: { opponent: { id: 'pokemon:level-2', name: 'Weedle' }, win: 6, loss: 0, draw: 0 },
        }}
        onPlayAgain={vi.fn()}
      />,
    );
    expect(getByText('You vs Weedle: 6 wins, 0 losses')).toBeTruthy();
    expect(getByText("This win didn't count toward Kakuna: 14 best-move requests, 0 allowed.")).toBeTruthy();
    expect(getByText('2 of 5 wins toward Kakuna')).toBeTruthy();
  });
});
```

Append inside the `describe` block of `BoardGameResult.test.jsx`:

```jsx
  it('lists standing notes, and renders no list without them', () => {
    const { getByText, container, rerender } = render(
      <BoardGameResult result="win" opponent={{ name: 'Pip' }} notes={['You vs Pip: 3 wins, 0 losses']} onPlayAgain={() => {}} />,
    );
    expect(getByText('You vs Pip: 3 wins, 0 losses')).toBeTruthy();
    rerender(<BoardGameResult result="win" opponent={{ name: 'Pip' }} onPlayAgain={() => {}} />);
    expect(container.querySelector('.pg-result__notes')).toBe(null);
  });
```

In `useChessPersistenceLifecycle.test.jsx`, change the assertion in "persists and archives one completed game from one set of facts" to:

```js
    await waitFor(() => expect(result.current.ladderOutcome).toEqual({ promoted: true, head_to_head: null }));
```

Append inside its `describe` block:

```jsx
  it('keeps the head-to-head record with the ladder outcome', async () => {
    api.saveGameRecord.mockImplementationOnce(async () => ({
      ladder: { promoted: false, counted: false },
      head_to_head: { opponent: { name: 'Weedle' }, win: 6, loss: 0, draw: 0 },
    }));
    const { result } = renderPlayedGame();
    await waitFor(() => expect(result.current.ladderOutcome?.head_to_head).toMatchObject({ win: 6 }));
    expect(result.current.ladderOutcome.counted).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessStandingLines.test.js frontend/src/modules/Piano/PianoChessGame/ChessResult.test.jsx frontend/src/modules/Piano/game-platform/host/BoardGameResult.test.jsx frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.test.jsx`
Expected: FAIL. The module is missing, no notes render, and `head_to_head` is absent from the outcome.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Piano/PianoChessGame/chessStandingLines.js`:

```js
/**
 * What the result card says about where this game left the player.
 *
 * Three facts, each only when it is true and useful. The record against this
 * opponent, because beating someone six times is worth seeing. Why a win did
 * not count, because a child who won and did not move up deserves the rule
 * that decided it. And how far along the climb they are. A loss that did not
 * count is not explained, because being told a loss "didn't count" reads as
 * a consolation nobody asked for.
 */

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const HELP_WORDS = Object.freeze({
  best_moves: (count) => plural(count, 'best-move request', 'best-move requests'),
  hints: (count) => plural(count, 'hint', 'hints'),
  takebacks: (count) => plural(count, 'takeback', 'takebacks'),
});

export function headToHeadLine(headToHead) {
  const name = headToHead?.opponent?.name;
  if (!name) return null;
  const parts = [
    plural(Number(headToHead.win) || 0, 'win', 'wins'),
    plural(Number(headToHead.loss) || 0, 'loss', 'losses'),
  ];
  const draws = Number(headToHead.draw) || 0;
  if (draws > 0) parts.push(plural(draws, 'draw', 'draws'));
  return `You vs ${name}: ${parts.join(', ')}`;
}

function notCountedLine(notCounted, nextName) {
  const toward = nextName ? ` toward ${nextName}` : '';
  if (notCounted.reason === 'other_level') return `Practice game. It doesn't count${toward}.`;
  const words = HELP_WORDS[notCounted.reason];
  if (!words) return null;
  return `This win didn't count${toward}: ${words(Number(notCounted.used) || 0)}, ${Number(notCounted.allowed) || 0} allowed.`;
}

export function standingLines({ result, ladder }) {
  if (!ladder || ladder.persisted === false) return [];
  const lines = [];
  const record = headToHeadLine(ladder.head_to_head);
  if (record) lines.push(record);
  // The banner already says a new opponent is unlocked, and the progress
  // numbers now describe a climb that has not started.
  if (ladder.promoted) return lines;
  const nextName = ladder.up_next?.name || null;
  if (result === 'win' && ladder.not_counted) {
    const line = notCountedLine(ladder.not_counted, nextName);
    if (line) lines.push(line);
  }
  const status = ladder.status;
  if (status && !status.at_top && nextName) lines.push(`${status.wins} of ${status.needed} wins toward ${nextName}`);
  return lines;
}

export default { standingLines, headToHeadLine };
```

In `BoardGameResult.jsx`, add `notes = null` to the props:

```jsx
export default function BoardGameResult({
  result, opponent, level, speech = null, promoted = false, message = null,
  metrics = null, notes = null, onPlayAgain, classPrefix = null, decoration = null,
}) {
```

Directly after the `{promoted && ...}` line, add:

```jsx
        {notes?.length > 0 && (
          <ul className={`pg-result__notes${classPrefix ? ` ${classPrefix}__notes` : ''}`}>
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
```

In `boardGameCeremony.scss`, after the `.pg-result__promoted` rule, add:

```scss
.pg-result__notes { display:grid; gap:.2rem; margin:.25rem 0 0; padding:0; list-style:none; color:var(--piano-muted,#9a9aa6); }
```

In `ChessResult.jsx`, add the import below `import { formatThink } from './chessClock.js';`:

```jsx
import { standingLines } from './chessStandingLines.js';
```

Inside `ChessResult`, after `const promoted = ladder?.promoted === true;`, add:

```jsx
  const notes = standingLines({ result, ladder });
```

Pass it to `BoardGameResult` by adding `notes={notes}` after `metrics={metrics}`.

In `useChessPersistenceLifecycle.js`, replace:

```js
          if (saved?.ladder) setLadderState({ gameId, value: saved.ladder });
```

with:

```js
          if (!saved?.ladder) return;
          // The head-to-head record rides with the ladder outcome: the result
          // card reads both, and only a saved game has either.
          setLadderState({ gameId, value: { ...saved.ladder, head_to_head: saved.head_to_head ?? null } });
          loggerRef.current.info?.('game-standing', {
            gameId,
            promoted: !!saved.ladder.promoted,
            counted: saved.ladder.counted ?? null,
            notCounted: saved.ladder.not_counted?.reason ?? null,
            headToHead: saved.head_to_head ? `${saved.head_to_head.win}-${saved.head_to_head.loss}-${saved.head_to_head.draw}` : null,
          });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ frontend/src/modules/Piano/game-platform/host/`
Expected: PASS.

- [ ] **Step 5: Document the standing lines**

In `docs/reference/piano/chess.md`, insert directly before `## Motion, and what it costs`:

```markdown
### Standing on the result card

Under the tallies, the result card says where the game left the player, from the `POST /games`
answer (see [piano-games.md](piano-games.md#the-game-record)):

- **The head-to-head record** against this opponent, counting this game: "You vs Weedle: 6 wins,
  0 losses". Draws appear only when there were any.
- **Why a win did not count**, naming the first broken help ceiling in the order best moves,
  hints, takebacks: "This win didn't count toward Kakuna: 14 best-move requests, 0 allowed."
  A win against an opponent already beaten reads "Practice game." A loss is never explained.
- **The climb**: "2 of 5 wins toward Kakuna". Dropped when the game promoted, because the banner
  says so, and at the top of the ladder.

Guests see none of it; they have no ladder and no rivalry memory.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chessStandingLines.js frontend/src/modules/Piano/PianoChessGame/chessStandingLines.test.js \
  frontend/src/modules/Piano/PianoChessGame/ChessResult.jsx frontend/src/modules/Piano/PianoChessGame/ChessResult.test.jsx \
  frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.js frontend/src/modules/Piano/PianoChessGame/useChessPersistenceLifecycle.test.jsx \
  frontend/src/modules/Piano/game-platform/host/BoardGameResult.jsx frontend/src/modules/Piano/game-platform/host/BoardGameResult.test.jsx \
  frontend/src/modules/Piano/game-platform/host/boardGameCeremony.scss docs/reference/piano/chess.md
git commit -m "feat(chess): the result card shows the head-to-head record and why a win didn't count

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```

---

### Task 8: Verify, merge, deploy, run the backfill

**Files:**
- Modify: `docs/_archive/deleted-branches.md`

- [ ] **Step 1: Run every touched test file, including the ones the gate does not walk**

```bash
npx vitest run shared/gaming/rulesets/chess/ cli/chess-backfill.cli.test.mjs cli/chess-review.cli.test.mjs \
  backend/src/3_applications/chess/ backend/src/3_applications/piano-games/ backend/src/4_api/v1/routers/chess.test.mjs \
  backend/src/4_api/v1/routers/lib/chessGameFilename.test.mjs frontend/src/modules/Piano/PianoChessGame/ \
  frontend/src/modules/Piano/game-platform/host/
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 2: Run the repo gate and capture its real exit code**

```bash
npm run test:unit:vitest > /tmp/chess-records-gate.log 2>&1; echo "exit=$?"; tail -20 /tmp/chess-records-gate.log
```

Expected: `exit=0`. If it fails, compare the failures against a run on `main`. A failure that also occurs on `main` is baseline noise. Any failure that does not must be fixed before continuing.

- [ ] **Step 3: Merge into main**

```bash
cd /opt/Code/DaylightStation
git merge --no-ff feat/chess-record-consolidation -m "Merge feat/chess-record-consolidation: one chess archive, rebuilt derived records, standing on the result card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
git log -1 --format=%H
```

The main checkout may hold unrelated uncommitted docs from another session. Leave them alone. The merge only needs them not to overlap.

- [ ] **Step 4: Gate, build, gate again, deploy**

Follow `CLAUDE.local.md`. Each command runs only if the previous one succeeded.

```bash
./scripts/deploy-gate.sh && ./scripts/build-daylight.sh && ./scripts/deploy-gate.sh \
  && sudo docker stop {env.docker_container} && sudo docker rm {env.docker_container} && sudo deploy-daylight
```

If either gate exits 1, stop and wait for the room to clear before retrying.

- [ ] **Step 5: Confirm the deployed commit**

```bash
curl -s http://localhost:{env.ports.app}/build.txt
```

Expected: the merge commit hash from Step 3.

- [ ] **Step 6: Dry run the backfill against live data**

```bash
sudo docker exec {env.docker_container} node cli/chess-backfill.cli.mjs --data data
```

The report must satisfy all of these before writing:

- Zero conflicts. The old archive directory reports about 47 files to move, with 24 renamed from old names.
- Every scorecard is held by the archive. Any that is not will be kept in place and named.
- The learner's ladder goes from level 1, 2 of 5 wins, 11 results, to level 1, 2 of 5 wins, 11 results.
- their Caterpie record goes to 5-0-0 and their Weedle record stays 5-0-0.
- No player's level decreases.
- No line in the report contains `DECREASE`.
- `withoutGameId` is 0, or every such file is accounted for as already archived.

If any of these is false, stop and investigate before continuing.

- [ ] **Step 7: Write**

```bash
./scripts/piano-kiosk-idle.sh && sudo docker exec {env.docker_container} node cli/chess-backfill.cli.mjs --data data --write
```

- [ ] **Step 8: Verify the result on disk and through the API**

```bash
sudo docker exec {env.docker_container} sh -c '
  ls data/household/gaming/log/ ;
  find data/household/gaming/log/chess -type f ! -name "*_level*" | wc -l ;
  ls -ln data/users/{learner}/apps/chess/ ;
  find data/household/gaming/log/chess -maxdepth 1 -type d ! -user node | wc -l ;
  grep -c "at: \"20" data/users/{learner}/apps/chess/ladder.yml ;
  ls data/_deleteme/ | grep chess-record-consolidation'
curl -s "http://localhost:{env.ports.app}/api/v1/piano-games/chess/ladder?user={learner}" | jq '{unlocked_through, status}'
```

Expected:

- The log directory no longer lists `pianochess`.
- Zero archive files lack `_level` in their name.
- The learner's chess files are owned by uid and gid 1000, and zero day directories are owned by anyone but `node`.
- Every ladder result carries a timestamp.
- The `_deleteme` folder exists.
- The API reports `unlocked_through: 1` with `wins: 2, needed: 5`.
- For every player, the ladder wins and every rivalry W/L/D on disk after the write match that
  player's "after" values from the Step 6 dry-run report exactly — the write must reproduce the
  plan it was gated on, not something computed fresh from a changed archive.

- [ ] **Step 9: Remove the worktree and record the branch**

```bash
cd /opt/Code/DaylightStation
HASH=$(git rev-parse feat/chess-record-consolidation)
echo "| $(date +%F) | feat/chess-record-consolidation | ${HASH:0:8} | Chess record consolidation, backfill CLI, result-card standing |" >> docs/_archive/deleted-branches.md
git worktree remove .claude/worktrees/chess-records
git branch -d feat/chess-record-consolidation
git add docs/_archive/deleted-branches.md
git commit -m "docs(archive): record feat/chess-record-consolidation before deletion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01We3gwXWG2YKrQaDvfTMuGm"
```
