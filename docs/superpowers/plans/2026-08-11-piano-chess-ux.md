# Piano Chess UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Piano Chess a real difficulty ladder driven by a server-side Stockfish, a config file pair a player can change from inside the game, and a keyboard strip that tells the player what the game heard.

**Architecture:** A long-lived Stockfish wasm runs in a Node `worker_thread` behind `StockfishEngineAdapter`, which falls back to the existing homegrown minimax if the worker fails. A thin `/api/v1/chess` router exposes one move endpoint and a config endpoint. Config is a household `chess.yml` merged under a per-user override; the in-game panel writes only the user layer. The frontend asks the API for the opponent's reply and gains two feedback surfaces that need no new backend work.

**Tech Stack:** Node 20 (ESM `.mjs`), Express, `stockfish@18` (lite-single wasm), React 18, Vitest, `js-yaml`, Docker (node:20-alpine).

**Design spec:** `docs/superpowers/specs/2026-08-11-piano-chess-ux-design.md`

## Global Constraints

- Backend is ESM `.mjs`; frontend is `.jsx`/`.js`. Tests are colocated `*.test.mjs` / `*.test.jsx` and run with `npx vitest run <path>`.
- Never use raw `console.log/warn/error` for diagnostics. Backend: the injected `logger`. Frontend: `frontend/src/lib/logging/Logger.js` via `getLogger().child({ component })`.
- A rung sets **either `skill` or `elo`, never both.** `elo` implies `UCI_LimitStrength true`; `skill` implies `UCI_LimitStrength false`. A rung carrying both logs a warning and honours `elo`.
- Stockfish's `UCI_Elo` floor is **1320** (max 3190). An `elo` below 1320 is clamped up and warned about.
- Search timeout is `movetime_ms + 1500`. A timed-out search must be **stopped** and its id retired before the next search is posted; a `bestmove` whose id does not match the live request is discarded. Skipping either desyncs every later reply onto the previous position.
- The engine must never block play: on any engine failure or timeout, fall back to `chooseMove` from `shared/gaming/chess/opponent.mjs` and report `engine: 'fallback'`. The fallback's difficulty is **mapped from the chosen rung**, never hardcoded — a child on the bottom rung must not silently meet the strongest homegrown level.
- `shared/gaming/chess/engine.mjs` exports **`isValidFen(fen)` returning a boolean**. It does *not* export `validateFen` — that is chess.js's, imported privately at the top of the file. Do not `import { validateFen }` from it.
- The piano user is a **string id** (`currentUser`), with `currentProfile` the resolved `{ id, name }`. There is no `user_id` field anywhere in the piano user model. Guests must never reach per-user endpoints — gate every per-user read/write with `isPersistentUser` from `frontend/src/modules/Piano/PianoKiosk/pianoUser.js`.
- `dataService.user.write` **overwrites the whole file**. Any "write the user layer" operation must read, merge, then write.
- Only the **user** config layer is writable from the game. The household file is never written by the API.
- Do not assert specific engine moves in tests — Stockfish changes its mind between versions. Assert legality, latency budget, and fallback behaviour.
- Touch UI rule: discrete tap targets, no sliders.

---

### Task 1: Stockfish worker and engine adapter

**Files:**
- Modify: `package.json` (add `stockfish` dependency)
- Modify: `docker/Dockerfile` (prune to the single lite build)
- Create: `backend/src/1_adapters/chess/stockfishWorker.mjs`
- Create: `backend/src/1_adapters/chess/StockfishEngineAdapter.mjs`
- Test: `backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs`

**Interfaces:**
- Consumes: `chooseMove(fen, { difficulty, seed })` from `shared/gaming/chess/opponent.mjs`, which returns a move object `{ from, to, san, promotion? }` or `null` when the game is over.
- Produces: `createStockfishEngine({ workerPath?, logger, timeoutMarginMs? })` returning `{ chooseMove({ fen, rung, gameId }), dispose() }`. `chooseMove` resolves `{ from, to, san, promotion?, engine, thinkingMs }` where `engine` is `'stockfish'` or `'fallback'`, or `null` if the position has no legal moves. `rung` is `{ id, label, movetime_ms, skill? , elo? }`.

- [ ] **Step 1: Add the dependency and prune the image**

```bash
npm install stockfish@18 --save
```

The Dockerfile is **single-stage**. A prune in its own later `RUN` would only write
whiteouts — the 251MB stays in the install layer forever and the image gets *bigger*. The
prune must be appended to the **same `RUN` as the install**, so the layer is never
committed fat. Find the existing `npm ci`/`npm install` command in the Dockerfile and
extend that same command:

```dockerfile
# ... existing npm ci commands, then, chained onto the SAME RUN:
 && SF=/usr/src/app/node_modules/stockfish/bin \
 && test -f "$SF/stockfish-18-lite-single.js" \
 && test -f "$SF/stockfish-18-lite-single.wasm" \
 && find "$SF" -type f ! -name 'stockfish-18-lite-single.*' -delete \
 && du -sh "$SF"
```

Stockfish ships every build variant; chess needs only the single-threaded lite build
(~7MB). The `test -f` guards make a missing file fail the build rather than ship an image
whose chess silently runs on the fallback engine. Note the package's `postinstall` leaves
`bin/stockfish.js`/`.wasm` symlinks pointing at the deleted full build; `find -type f`
does not remove them, and `require('stockfish')()` with no argument will therefore be
broken in the image. Always pass `'lite-single'`, as the worker does.

- [ ] **Step 2: Write the failing adapter test**

Create `backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs`:

```javascript
import { describe, expect, it, afterAll } from 'vitest';
import { legalMoves } from '../../../../shared/gaming/chess/engine.mjs';
import { createStockfishEngine, fallbackDifficultyFor } from './StockfishEngineAdapter.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATED = '7k/5KQ1/8/8/8/8/8/8 b - - 0 1'; // black is checkmated: no legal moves
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const rung = { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 100 };

const engine = createStockfishEngine({ logger: silentLogger });
afterAll(() => engine.dispose());

describe('StockfishEngineAdapter', () => {
  it('returns a legal move for the starting position', async () => {
    const move = await engine.chooseMove({ fen: START, rung, gameId: 'g1' });
    expect(move.engine).toBe('stockfish');
    const legal = legalMoves(START).map((m) => `${m.from}${m.to}`);
    expect(legal).toContain(`${move.from}${move.to}`);
  });

  it('answers within the movetime budget plus the margin', async () => {
    const started = Date.now();
    await engine.chooseMove({ fen: START, rung, gameId: 'g2' });
    expect(Date.now() - started).toBeLessThan(rung.movetime_ms + 1500);
  });

  it('serializes concurrent searches instead of interleaving them', async () => {
    const moves = await Promise.all([
      engine.chooseMove({ fen: START, rung, gameId: 'g3' }),
      engine.chooseMove({ fen: START, rung, gameId: 'g3' }),
      engine.chooseMove({ fen: START, rung, gameId: 'g3' }),
    ]);
    for (const move of moves) expect(move.from).toBeTruthy();
  });

  it('returns null when the side to move has no legal moves', async () => {
    expect(await engine.chooseMove({ fen: MATED, rung, gameId: 'g4' })).toBeNull();
  });

  it('falls back to the homegrown engine when the worker cannot start', async () => {
    const broken = createStockfishEngine({ workerPath: '/nonexistent/worker.mjs', logger: silentLogger });
    const move = await broken.chooseMove({ fen: START, rung, gameId: 'g5' });
    expect(move.engine).toBe('fallback');
    expect(legalMoves(START).map((m) => `${m.from}${m.to}`)).toContain(`${move.from}${move.to}`);
    broken.dispose();
  });
});

describe('fallbackDifficultyFor', () => {
  it('keeps a gentle rung gentle when the engine is unreachable', () => {
    expect(fallbackDifficultyFor({ id: 'first-moves' }, { skill: 0 })).toBe('beginner');
  });

  it('maps the middle of the ladder to the middle homegrown level', () => {
    expect(fallbackDifficultyFor({ id: 'steady' }, { skill: 8 })).toBe('learner');
  });

  it('gives the top rungs the strongest homegrown level', () => {
    expect(fallbackDifficultyFor({ id: 'sharp' }, { skill: 14 })).toBe('steady');
    expect(fallbackDifficultyFor({ id: 'ruthless' }, { elo: 1800 })).toBe('steady');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs`
Expected: FAIL — cannot resolve `./StockfishEngineAdapter.mjs`.

- [ ] **Step 4: Write the worker**

Create `backend/src/1_adapters/chess/stockfishWorker.mjs`:

```javascript
import { createRequire } from 'node:module';
import { parentPort } from 'node:worker_threads';

/**
 * The engine, isolated from the event loop.
 *
 * A Stockfish search pins a thread for its whole movetime. On the main thread
 * that starves everything the backend serves — fitness, the player, screens —
 * in ~44ms chunks, so the engine lives here instead. UCI in, bestmove out.
 */
const require = createRequire(import.meta.url);
const initEngine = require('stockfish');

let engine = null;
let pending = null; // { id } of the search the main thread is still waiting on

function handleLine(raw) {
  const line = String(raw);
  if (!line.startsWith('bestmove')) return;
  const uci = line.split(/\s+/)[1] || '';
  // A bestmove with no live request is the tail of an abandoned search. Dropping
  // it is the whole defence against one timeout shifting every later reply onto
  // the previous position.
  if (!pending) return;
  const { id } = pending;
  pending = null;
  parentPort.postMessage({ type: 'bestmove', id, uci });
}

async function boot() {
  engine = await initEngine('lite-single');
  engine.listener = handleLine;
  engine.sendCommand('uci');
  engine.sendCommand('isready');
  parentPort.postMessage({ type: 'ready' });
}

let lastGameId = null;

parentPort.on('message', (msg) => {
  if (!engine) return;
  // Abandon: the main thread gave up on this search. Retire the id and tell the
  // engine to stop, so its late bestmove is dropped by handleLine above and the
  // next search starts from a quiet engine.
  if (msg.type === 'abandon') {
    if (pending?.id === msg.id) pending = null;
    engine.sendCommand('stop');
    return;
  }
  if (msg.type !== 'search') return;
  pending = { id: msg.id };
  // A new game gets a clean transposition table; the same game does not, so the
  // engine keeps what it learned from the position it just looked at.
  if (msg.gameId !== lastGameId) {
    engine.sendCommand('ucinewgame');
    lastGameId = msg.gameId;
  }
  if (Number.isFinite(msg.elo)) {
    engine.sendCommand('setoption name UCI_LimitStrength value true');
    engine.sendCommand(`setoption name UCI_Elo value ${msg.elo}`);
  } else {
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.sendCommand(`setoption name Skill Level value ${msg.skill}`);
  }
  engine.sendCommand(`position fen ${msg.fen}`);
  engine.sendCommand(`go movetime ${msg.movetimeMs}`);
});

boot().catch((error) => {
  parentPort.postMessage({ type: 'boot-failed', message: error?.message || String(error) });
});
```

- [ ] **Step 5: Write the adapter**

Create `backend/src/1_adapters/chess/StockfishEngineAdapter.mjs`:

```javascript
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { applyMove, legalMoves } from '../../../../shared/gaming/chess/engine.mjs';
import { chooseMove as homegrownChooseMove } from '../../../../shared/gaming/chess/opponent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELO_FLOOR = 1320;
const ELO_CEILING = 3190;

/** UCI ('e2e4', 'e7e8q') -> the move object the game state layer expects. */
function fromUci(fen, uci) {
  if (!uci || uci === '(none)' || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const result = applyMove(fen, { from, to, ...(promotion ? { promotion } : {}) });
  if (!result?.move) return null;
  return { from, to, ...(promotion ? { promotion } : {}), san: result.move.san };
}

/**
 * Resolve a rung to engine options. skill and elo are different mechanisms and
 * cannot both apply: UCI_Elo makes the engine target a rating and ignore Skill
 * Level entirely, so a rung carrying both is a config error.
 */
export function engineOptionsForRung(rung, logger) {
  const movetimeMs = Number(rung?.movetime_ms) > 0 ? Number(rung.movetime_ms) : 200;
  const hasElo = Number.isFinite(Number(rung?.elo));
  const hasSkill = Number.isFinite(Number(rung?.skill));
  if (hasElo && hasSkill) {
    logger?.warn?.('chess.rung.skill-and-elo', { rung: rung.id, honoured: 'elo' });
  }
  if (hasElo) {
    const raw = Number(rung.elo);
    const elo = Math.min(ELO_CEILING, Math.max(ELO_FLOOR, raw));
    if (elo !== raw) logger?.warn?.('chess.rung.elo-clamped', { rung: rung.id, requested: raw, elo });
    return { movetimeMs, elo };
  }
  return { movetimeMs, skill: hasSkill ? Math.min(20, Math.max(0, Number(rung.skill))) : 3 };
}

/**
 * Which homegrown level stands in when the engine is unreachable.
 *
 * The bundled engine's rungs are beginner/learner/steady. Handing a child on
 * "First moves" the strongest of the three because a wasm failed to load is a
 * worse failure than no opponent at all: the rail still says First moves.
 */
export function fallbackDifficultyFor(rung, options) {
  if (Number.isFinite(options?.elo)) return 'steady';
  const skill = Number.isFinite(options?.skill) ? options.skill : 3;
  if (skill <= 2) return 'beginner';
  if (skill <= 10) return 'learner';
  return 'steady';
}

export function createStockfishEngine({
  workerPath = path.join(HERE, 'stockfishWorker.mjs'),
  logger = null,
  timeoutMarginMs = 1500,
} = {}) {
  let worker = null;
  let workerUsable = true;
  let queue = Promise.resolve();
  let nextId = 1;
  const waiting = new Map();

  function ensureWorker() {
    if (worker || !workerUsable) return worker;
    try {
      worker = new Worker(workerPath);
      worker.on('message', (msg) => {
        if (msg.type === 'bestmove') waiting.get(msg.id)?.resolve(msg.uci);
        if (msg.type === 'boot-failed') {
          workerUsable = false;
          logger?.warn?.('chess.engine.boot-failed', { message: msg.message });
          for (const entry of waiting.values()) entry.resolve(null);
        }
      });
      worker.on('error', (error) => {
        // Recoverable: drop the worker and let the next search respawn it. A
        // process-lifetime latch would mean one transient crash silently demotes
        // chess to the fallback engine until the next deploy.
        logger?.warn?.('chess.engine.worker-error', { message: error?.message });
        for (const entry of waiting.values()) entry.resolve(null);
        worker?.terminate?.();
        worker = null;
      });
      worker.unref?.();
    } catch (error) {
      workerUsable = false;
      logger?.warn?.('chess.engine.worker-spawn-failed', { message: error?.message });
      worker = null;
    }
    return worker;
  }

  function search({ fen, gameId, options }) {
    const live = ensureWorker();
    if (!live) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        // Tell the engine to stop and retire the id BEFORE the queue releases the
        // next search, or that search inherits this one's late bestmove.
        live.postMessage({ type: 'abandon', id });
        logger?.warn?.('chess.engine.timeout', { movetimeMs: options.movetimeMs });
        resolve(null);
      }, options.movetimeMs + timeoutMarginMs);
      waiting.set(id, {
        resolve: (uci) => { clearTimeout(timer); waiting.delete(id); resolve(uci); },
      });
      live.postMessage({ type: 'search', id, fen, gameId, ...options });
    });
  }

  return {
    /** Resolves the opponent's reply, or null when there are no legal moves. */
    async chooseMove({ fen, rung, gameId }) {
      if (legalMoves(fen).length === 0) return null;
      const options = engineOptionsForRung(rung, logger);
      const startedAt = Date.now();
      // Serialized: one board in the house, so a queue beats a pool and keeps
      // latency predictable.
      const run = queue.then(() => search({ fen, gameId, options }));
      queue = run.catch(() => {});
      const uci = await run;
      const move = uci ? fromUci(fen, uci) : null;
      if (move) {
        const thinkingMs = Date.now() - startedAt;
        logger?.info?.('chess.engine.move', { rung: rung?.id, thinkingMs, engine: 'stockfish' });
        return { ...move, engine: 'stockfish', thinkingMs };
      }
      logger?.warn?.('chess.engine.fallback', { rung: rung?.id, reason: workerUsable ? 'no_bestmove' : 'worker_unavailable' });
      const fallback = homegrownChooseMove(fen, {
        difficulty: fallbackDifficultyFor(rung, options),
        seed: fen.length,
      });
      if (!fallback) return null;
      return {
        from: fallback.from,
        to: fallback.to,
        ...(fallback.promotion ? { promotion: fallback.promotion } : {}),
        san: fallback.san,
        engine: 'fallback',
        thinkingMs: Date.now() - startedAt,
      };
    },
    dispose() {
      worker?.terminate?.();
      worker = null;
      waiting.clear();
    },
  };
}

export default { createStockfishEngine, engineOptionsForRung };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docker/Dockerfile backend/src/1_adapters/chess/
git commit -m "feat(chess): server-side Stockfish behind a worker-thread adapter"
```

---

### Task 2: Chess config service

**Files:**
- Create: `backend/src/3_applications/chess/ChessConfigService.mjs`
- Test: `backend/src/3_applications/chess/ChessConfigService.test.mjs`
- Create: `data/household/config/chess.yml` (via `docker exec`, see Step 5 — the data volume is not writable from the repo)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createChessConfigService({ configService, dataService, logger })` returning `{ read(userId), writeUserLayer(userId, patch), resolveRung(config, rungId) }`. `read` resolves the merged config object. `resolveRung(config, rungId)` returns the rung object, falling back to the middle rung with a warning when `rungId` is unknown.

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/chess/ChessConfigService.test.mjs`:

```javascript
import { describe, expect, it, vi } from 'vitest';
import { createChessConfigService, mergeChessConfig, resolveRung } from './ChessConfigService.mjs';

const HOUSE = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
  opponent_delay_ms: 700,
  feedback: { hint_level: 'after-mistake', toast: true },
};

describe('mergeChessConfig', () => {
  it('returns the household config when the user has no overrides', () => {
    expect(mergeChessConfig(HOUSE, null)).toEqual(HOUSE);
  });

  it('lets a user override a single key without losing the rest', () => {
    const merged = mergeChessConfig(HOUSE, { default_rung: 'steady' });
    expect(merged.default_rung).toBe('steady');
    expect(merged.opponent_delay_ms).toBe(700);
    expect(merged.rungs).toHaveLength(3);
  });

  it('merges the feedback block key by key', () => {
    const merged = mergeChessConfig(HOUSE, { feedback: { hint_level: 'off' } });
    expect(merged.feedback).toEqual({ hint_level: 'off', toast: true });
  });

  it('replaces the ladder wholesale rather than merging it element-wise', () => {
    const merged = mergeChessConfig(HOUSE, { rungs: [{ id: 'only', label: 'Only', skill: 5, movetime_ms: 100 }] });
    expect(merged.rungs).toHaveLength(1);
    expect(merged.rungs[0].id).toBe('only');
  });
});

describe('resolveRung', () => {
  it('finds a rung by id', () => {
    expect(resolveRung(HOUSE, 'steady').skill).toBe(8);
  });

  it('falls back to the middle rung and warns when the id is unknown', () => {
    const logger = { warn: vi.fn(), info() {}, error() {}, debug() {} };
    const rung = resolveRung(HOUSE, 'nonsense', logger);
    expect(rung.id).toBe('learner');
    expect(logger.warn).toHaveBeenCalledWith('chess.config.unknown-rung', expect.objectContaining({ requested: 'nonsense' }));
  });
});

describe('createChessConfigService', () => {
  const silent = { warn() {}, info() {}, error() {}, debug() {} };

  it('writes only the user layer, never the household file', async () => {
    const writes = [];
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE,
      readUserConfig: () => ({}),
      writeUserConfig: (userId, data) => { writes.push({ userId, data }); },
      logger: silent,
    });
    await service.writeUserLayer('felix', { default_rung: 'steady' });
    expect(writes).toEqual([{ userId: 'felix', data: { default_rung: 'steady' } }]);
  });

  it('merges a patch into the existing override instead of replacing the file', async () => {
    // The datastore overwrites whole files, so a second setting must not erase
    // the first. One tap picks a rung, the next picks a hint level; both persist.
    let stored = { default_rung: 'steady' };
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE,
      readUserConfig: () => stored,
      writeUserConfig: (_userId, data) => { stored = data; },
      logger: silent,
    });
    await service.writeUserLayer('felix', { feedback: { hint_level: 'off' } });
    expect(stored).toEqual({ default_rung: 'steady', feedback: { hint_level: 'off' } });
  });

  it('refuses to write without a user, so guests never create a profile', async () => {
    const writeUserConfig = vi.fn();
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE, readUserConfig: () => ({}), writeUserConfig, logger: silent,
    });
    await expect(service.writeUserLayer(null, { default_rung: 'steady' })).rejects.toThrow();
    expect(writeUserConfig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run backend/src/3_applications/chess/ChessConfigService.test.mjs`
Expected: FAIL — cannot resolve `./ChessConfigService.mjs`.

- [ ] **Step 3: Write the service**

Create `backend/src/3_applications/chess/ChessConfigService.mjs`:

```javascript
/**
 * Chess configuration: household defaults under a per-user override.
 *
 * The ladder is replaced wholesale rather than merged element-wise — a
 * half-merged ladder (rung 2 from the user, rung 3 from the house) is never
 * what anyone means.
 */

const MERGE_BLOCKS = ['feedback'];

export function mergeChessConfig(household, user) {
  const base = household || {};
  if (!user || typeof user !== 'object') return { ...base };
  const merged = { ...base, ...user };
  for (const block of MERGE_BLOCKS) {
    if (base[block] || user[block]) {
      merged[block] = { ...(base[block] || {}), ...(user[block] || {}) };
    }
  }
  return merged;
}

/** A typo in YAML must not take the game down, so an unknown rung lands mid-ladder. */
export function resolveRung(config, rungId, logger = null) {
  const rungs = Array.isArray(config?.rungs) ? config.rungs : [];
  if (rungs.length === 0) return null;
  const found = rungs.find((rung) => rung.id === rungId);
  if (found) return found;
  const middle = rungs[Math.floor(rungs.length / 2)];
  logger?.warn?.('chess.config.unknown-rung', { requested: rungId, fallback: middle.id });
  return middle;
}

export function createChessConfigService({
  readHouseholdConfig,
  readUserConfig,
  writeUserConfig,
  logger = null,
}) {
  return {
    async read(userId) {
      const household = await readHouseholdConfig();
      const user = userId ? await readUserConfig(userId) : null;
      return mergeChessConfig(household, user);
    },
    /**
     * Merge a patch into the user's override.
     *
     * The datastore writes whole files, so this must read first: the panel emits
     * one sparse patch per tap, and a straight write would make each setting
     * erase the one before it.
     */
    async writeUserLayer(userId, patch) {
      if (!userId) throw new Error('chess config: a user is required to write an override');
      const existing = (await readUserConfig(userId)) || {};
      const next = mergeChessConfig(existing, patch || {});
      await writeUserConfig(userId, next);
      logger?.info?.('chess.config.user-saved', { userId, keys: Object.keys(patch || {}) });
      return next;
    },
    resolveRung: (config, rungId) => resolveRung(config, rungId, logger),
  };
}

export default { createChessConfigService, mergeChessConfig, resolveRung };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/3_applications/chess/ChessConfigService.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Create the household config file**

The data volume is not writable from the repo checkout, so write it through the container (never `sed -i` on YAML — write the whole file):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/chess.yml << 'EOF'
default_rung: learner
rungs:
  - id: first-moves
    label: First moves
    skill: 0
    movetime_ms: 100
  - id: learner
    label: Learner
    skill: 3
    movetime_ms: 200
  - id: steady
    label: Steady
    skill: 8
    movetime_ms: 300
  - id: sharp
    label: Sharp
    skill: 14
    movetime_ms: 500
  - id: ruthless
    label: Ruthless
    elo: 1800
    movetime_ms: 800
opponent_delay_ms: 700
shuffle_each_turn: true
feedback:
  hint_level: after-mistake
  flash_rejected: true
  toast: true
EOF"
# The container runs docker exec as root, so hand the file back to the app user.
sudo docker exec daylight-station sh -c 'chown node:node data/household/config/chess.yml'
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/chess/
git commit -m "feat(chess): household config with per-user overrides"
```

---

### Task 3: Chess API router

**Files:**
- Create: `backend/src/4_api/v1/routers/chess.mjs`
- Test: `backend/src/4_api/v1/routers/chess.test.mjs`
- Modify: `backend/src/app.mjs` (import near the other router imports ~line 246-252; register `v1Routers.chess` near the gaming registration ~line 1681)

**Interfaces:**
- Consumes: `createStockfishEngine(...)` from Task 1; `createChessConfigService(...)` and `resolveRung` from Task 2.
- Produces: `createChessRouter({ engine, configService, logger })` returning an Express router mounted at `/api/v1/chess` with `POST /move`, `GET /config`, `PUT /config`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/4_api/v1/routers/chess.test.mjs`:

```javascript
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createChessRouter } from './chess.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CONFIG = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
};
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function appWith({ engine, configService }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chess', createChessRouter({ engine, configService, logger: silentLogger }));
  return app;
}

const stubConfig = (overrides = {}) => ({
  read: async () => CONFIG,
  writeUserLayer: vi.fn(async () => {}),
  resolveRung: (config, id) => config.rungs.find((r) => r.id === id) || config.rungs[1],
  ...overrides,
});

describe('POST /api/v1/chess/move', () => {
  it('returns the engine move for a legal position', async () => {
    const engine = { chooseMove: async () => ({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish', thinkingMs: 12 }) };
    const res = await request(appWith({ engine, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: START, rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
  });

  it('rejects an invalid FEN before it reaches the engine', async () => {
    const chooseMove = vi.fn();
    const res = await request(appWith({ engine: { chooseMove }, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: 'not-a-fen', rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(400);
    expect(chooseMove).not.toHaveBeenCalled();
  });

  it('reports game over as a null move rather than an error', async () => {
    const engine = { chooseMove: async () => null };
    const res = await request(appWith({ engine, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: START, rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(200);
    expect(res.body.move).toBeNull();
  });
});

describe('/api/v1/chess/config', () => {
  it('serves the merged config', async () => {
    const res = await request(appWith({ engine: {}, configService: stubConfig() }))
      .get('/api/v1/chess/config?user=felix');
    expect(res.status).toBe(200);
    expect(res.body.default_rung).toBe('learner');
  });

  it('writes the user layer on PUT', async () => {
    const configService = stubConfig();
    const res = await request(appWith({ engine: {}, configService }))
      .put('/api/v1/chess/config?user=felix').send({ default_rung: 'steady' });
    expect(res.status).toBe(200);
    expect(configService.writeUserLayer).toHaveBeenCalledWith('felix', { default_rung: 'steady' });
  });

  it('refuses to write without a user', async () => {
    const configService = stubConfig();
    const res = await request(appWith({ engine: {}, configService }))
      .put('/api/v1/chess/config').send({ default_rung: 'steady' });
    expect(res.status).toBe(400);
    expect(configService.writeUserLayer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs`
Expected: FAIL — cannot resolve `./chess.mjs`.

- [ ] **Step 3: Write the router**

Create `backend/src/4_api/v1/routers/chess.mjs`:

```javascript
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { isValidFen } from '#shared/gaming/chess/engine.mjs';

/**
 * Chess API: one move endpoint and the config pair.
 *
 * One request per move — there is nothing to stream until a live eval bar
 * exists, and adding one later does not disturb this contract.
 */
export function createChessRouter({ engine, configService, logger = null }) {
  const router = express.Router();

  router.post('/move', asyncHandler(async (req, res) => {
    const { fen, rung: rungId, gameId } = req.body || {};
    if (!isValidFen(fen)) return res.status(400).json({ error: 'invalid_fen' });
    const config = await configService.read(req.query.user || null);
    const rung = configService.resolveRung(config, rungId || config.default_rung);
    const move = await engine.chooseMove({ fen, rung, gameId: gameId || 'default' });
    if (!move) return res.json({ move: null });
    return res.json(move);
  }));

  router.get('/config', asyncHandler(async (req, res) => {
    res.json(await configService.read(req.query.user || null));
  }));

  router.put('/config', asyncHandler(async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user_required' });
    await configService.writeUserLayer(userId, req.body || {});
    res.json(await configService.read(userId));
  }));

  return router;
}

export default createChessRouter;
```

**Do not import `validateFen` here.** `engine.mjs` imports chess.js's `validateFen`
privately (line 1) and uses `.ok` internally at lines 53 and 76, but what it *exports* is
`isValidFen(fen)`, which returns a plain boolean (line 75). Importing `validateFen` from
that module throws at import time and takes the whole app down at registration.

Verify before writing: `grep -n "^export" shared/gaming/chess/engine.mjs`.

Import style: backend modules reach shared code through the `#shared/*` alias and pull
`asyncHandler` from `#system/http/middleware/index.mjs` — see
`backend/src/4_api/v1/routers/donow.mjs:7` for the established pattern. Do not hand-roll
a local `asyncHandler` or count `../` levels.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Register the router in app.mjs**

Add the import beside the other router imports (near line 246):

```javascript
import { createChessRouter } from './4_api/v1/routers/chess.mjs';
import { createStockfishEngine } from './1_adapters/chess/StockfishEngineAdapter.mjs';
import { createChessConfigService } from './3_applications/chess/ChessConfigService.mjs';
```

Register beside the gaming router (near line 1681). Read and write the config files through the same `configService`/`dataService` helpers the neighbouring registrations use — `getHouseholdAppConfig(null, 'chess')` for the household layer and a YAML read/write under `users/{id}/apps/chess/config.yml` for the user layer:

```javascript
const chessEngine = createStockfishEngine({ logger: rootLogger.child({ module: 'chess-engine' }) });
server?.once?.('close', () => chessEngine.dispose());
v1Routers.chess = createChessRouter({
  engine: chessEngine,
  configService: createChessConfigService({
    readHouseholdConfig: () => configService.getHouseholdAppConfig(null, 'chess'),
    readUserConfig: (userId) => dataService.user.read('apps/chess/config', userId) || {},
    writeUserConfig: (userId, data) => dataService.user.write('apps/chess/config', data, userId),
    logger: rootLogger.child({ module: 'chess-config' }),
  }),
  logger: rootLogger.child({ module: 'chess-api' }),
});
```

`dataService.user.read/write(relativePath, [data,] username)` resolve to
`{dataDir}/users/{username}/{relativePath}.yml` — see `DataService.mjs:123-168`. Pass the
path without the `.yml` suffix, as the other call sites do.

- [ ] **Step 6: Verify the route is live**

Run: `node backend/index.js` (or restart the dev server) then:

```bash
curl -s localhost:3112/api/v1/chess/config | head -20
curl -s -X POST localhost:3112/api/v1/chess/move -H 'Content-Type: application/json' \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","rung":"learner","gameId":"smoke"}'
```

Expected: the config JSON, then a move with `"engine":"stockfish"`. If it says `"fallback"`, the wasm did not load — fix that before continuing, because every later task assumes a working engine.

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/chess.mjs backend/src/4_api/v1/routers/chess.test.mjs backend/src/app.mjs
git commit -m "feat(chess): /api/v1/chess move and config endpoints"
```

---

### Task 4: Point the game at the server engine

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chessApi.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessApi.test.js`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (the opponent effect, currently ~line 179-189, and the `DIFFICULTIES` import on line 2)

**Interfaces:**
- Consumes: `POST /api/v1/chess/move` and `GET /api/v1/chess/config` from Task 3.
- Produces: `fetchChessConfig(userId)` resolving the merged config; `requestOpponentMove({ fen, rung, gameId, userId })` resolving `{ from, to, san, engine } | null`; `saveChessConfig(userId, patch)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoChessGame/chessApi.test.js`:

```javascript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchChessConfig, requestOpponentMove, saveChessConfig } from './chessApi.js';

beforeEach(() => { globalThis.fetch = vi.fn(); });

describe('requestOpponentMove', () => {
  it('posts the position and returns the move', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ from: 'e7', to: 'e5', san: 'e5', engine: 'stockfish' }) });
    const move = await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1', userId: 'felix' });
    expect(move).toMatchObject({ from: 'e7', to: 'e5' });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/api/v1/chess/move');
    expect(JSON.parse(init.body)).toMatchObject({ fen: 'x', rung: 'learner', gameId: 'g1' });
  });

  it('returns null when the server says the game is over', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ move: null }) });
    expect(await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1' })).toBeNull();
  });

  it('returns null when the request fails so the caller can fall back locally', async () => {
    globalThis.fetch.mockRejectedValue(new Error('offline'));
    expect(await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1' })).toBeNull();
  });
});

describe('fetchChessConfig', () => {
  it('returns null on failure rather than throwing into render', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchChessConfig('felix')).toBeNull();
  });
});

describe('saveChessConfig', () => {
  it('PUTs the patch for the user', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ default_rung: 'steady' }) });
    await saveChessConfig('felix', { default_rung: 'steady' });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('user=felix');
    expect(init.method).toBe('PUT');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessApi.test.js`
Expected: FAIL — cannot resolve `./chessApi.js`.

- [ ] **Step 3: Write the client**

Create `frontend/src/modules/Piano/PianoChessGame/chessApi.js`:

```javascript
import getLogger from '../../../lib/logging/Logger.js';

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'chess-api' });
  return cachedLogger;
}

const withUser = (path, userId) => (userId ? `${path}${path.includes('?') ? '&' : '?'}user=${encodeURIComponent(userId)}` : path);

/** Resolves null on any failure: the caller falls back to the local engine. */
export async function requestOpponentMove({ fen, rung, gameId, userId = null }) {
  try {
    const res = await fetch(withUser('/api/v1/chess/move', userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, rung, gameId }),
    });
    if (!res.ok) { logger().warn('chess.move.request-failed', { status: res.status }); return null; }
    const body = await res.json();
    return body && body.from ? body : null;
  } catch (error) {
    logger().warn('chess.move.request-error', { error: error.message });
    return null;
  }
}

export async function fetchChessConfig(userId = null) {
  try {
    const res = await fetch(withUser('/api/v1/chess/config', userId));
    if (!res.ok) { logger().warn('chess.config.fetch-failed', { status: res.status }); return null; }
    return await res.json();
  } catch (error) {
    logger().warn('chess.config.fetch-error', { error: error.message });
    return null;
  }
}

export async function saveChessConfig(userId, patch) {
  try {
    const res = await fetch(withUser('/api/v1/chess/config', userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { logger().warn('chess.config.save-failed', { status: res.status }); return null; }
    return await res.json();
  } catch (error) {
    logger().warn('chess.config.save-error', { error: error.message });
    return null;
  }
}

export default { requestOpponentMove, fetchChessConfig, saveChessConfig };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessApi.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Use it in the opponent effect**

In `PianoChessGame.jsx`, replace the body of the opponent-reply effect (currently calling `chooseMove` directly) so it asks the server first and keeps the local engine as the fallback. The delay stays — the reply must still read as a reply, not a flicker:

```javascript
useEffect(() => {
  if (game.status?.game_over || game.status?.turn === playerColor) return undefined;
  let cancelled = false;
  const timer = setTimeout(async () => {
    const fen = gameRef.current.game.fen;
    const served = await requestOpponentMove({ fen, rung: rungId, gameId, userId });
    // The server is the strong opponent; the bundled engine is what keeps the
    // game playable when it cannot be reached.
    const reply = served
      || chooseMove(fen, { difficulty: localFallbackDifficulty, seed: gameRef.current.history.length });
    if (cancelled || !reply) return;
    const { state } = commitMove(gameRef.current, reply.from, reply.to, reply.promotion);
    setGame(state);
    logger().info('opponent-replied', { san: reply.san, engine: served ? served.engine : 'local' });
  }, opponentDelayMs);
  return () => { cancelled = true; clearTimeout(timer); };
}, [game.status, playerColor, rungId, gameId, opponentDelayMs, currentUser]);
```

`rungId` and `opponentDelayMs` come from the config loaded in Task 7; until then default
them to `'learner'` and `700`.

**`currentUser` is not currently a prop of this component.** `GameHost` already passes it
(`Games.jsx`), so add it to the prop list alongside `onDeactivate` and `gameConfig`, and
derive the id the way the rest of the kiosk does — the piano user is a **string id**, and
guests must never touch per-user endpoints:

```javascript
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';
// ...
export function PianoChessGame({ onDeactivate = null, gameConfig = null, currentUser = null, /* ...existing props */ }) {
  // currentUser may arrive as the resolved profile object or the bare id.
  const userSlug = typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null;
  const userId = isPersistentUser(userSlug) ? userSlug : null;
```

`gameId` must be **state that changes on restart**, not a per-mount constant — otherwise
"Play again" reuses the id and the engine keeps the finished game in its table:

```javascript
const [gameId, setGameId] = useState(() => `chess-${Date.now()}`);
// inside restart(): setGameId(`chess-${Date.now()}`);
```

`localFallbackDifficulty` maps the active rung the same way the server adapter does, so a
dropped request does not change who the player is facing:

```javascript
const rung = chessConfig?.rungs?.find((r) => r.id === rungId);
const localFallbackDifficulty = Number.isFinite(rung?.elo) ? 'steady'
  : (rung?.skill ?? 3) <= 2 ? 'beginner'
    : (rung?.skill ?? 3) <= 10 ? 'learner' : 'steady';
```

- [ ] **Step 6: Thread promotion through commitMove**

`commitMove(state, from, to)` hardcodes `PROMOTION_PIECE = 'q'` (`chessGameState.js:21,174`),
so the server's underpromotions are silently converted to queens — the board then plays a
different move than the engine chose while logging the engine's SAN. Add an optional
fourth argument, defaulting to today's behaviour so the human-move call sites are
untouched:

```javascript
export function commitMove(state, from, to, promotion = PROMOTION_PIECE) {
  const result = playMove(state.game, { from, to, promotion });
```

Add a test to `chessGameState.test.js` that an underpromotion is honoured:

```javascript
it('honours an explicit underpromotion instead of always queening', () => {
  // White pawn on e7, black king tucked away; e8=N is legal.
  const state = createChessGameState({ fen: '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1' });
  const { state: next } = commitMove(state, 'e7', 'e8', 'n');
  expect(next.history.at(-1).san).toContain('=N');
});
```

- [ ] **Step 7: Verify in the browser**

Load `https://daylightlocal.kckern.net/piano/games/chess`, play a move, and confirm in the backend log that `chess.engine.move` fires with `engine: 'stockfish'`:

```bash
sudo docker logs --since 60s daylight-station 2>&1 | grep chess.engine
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "feat(chess): play against the server engine, fall back locally"
```

---

### Task 5: Keyboard strip chord read-out

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/ChordReadout.jsx`
- Test: `frontend/src/modules/Piano/PianoChessGame/ChordReadout.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (the `<footer className="piano-chess__keys">` block, currently the last element before the closing div)
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.scss`

**Interfaces:**
- Consumes: the component's existing `heldNotes`, `cursorChord` (`{ symbol }` or null, from `squareToChord`) and `cursor` (square string or null). It does **not** call `identifyChord` — that returns `{ square, candidates, pitch_classes }` (`chordAddress.js:200`), not a display symbol, and is scheme-scoped.
- Produces: `<ChordReadout heldNotes={number[]} chord={{symbol}|null} square={string|null} connected={boolean} settling={boolean} />`.

**This replaces the existing read-out, it does not add a second one.** `PianoChessGame.jsx:245-250`
already renders `piano-chess__midi` in the left rail with the same four states. Delete that
block when mounting this, and move its `.piano-chess__midi*` styles or drop them.

**The `settling` prop is load-bearing.** `cursor` is only set after the 140ms settle
window fires a `preview` event, so a read-out that branches "has a square, else not a
square" would call *every valid chord* unrecognised for the whole settle — the exact
ambiguity this component exists to remove. Pass `settling` true while the held set is
non-empty and no square has resolved yet.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoChessGame/ChordReadout.test.jsx`:

```javascript
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChordReadout from './ChordReadout.jsx';

describe('ChordReadout', () => {
  it('says it is listening when no keys are down', () => {
    render(<ChordReadout heldNotes={[]} chord={null} square={null} connected />);
    expect(screen.getByText(/listening/i)).toBeTruthy();
  });

  it('names the chord and the square it addresses', () => {
    render(<ChordReadout heldNotes={[60, 64, 67]} chord={{ symbol: 'C' }} square="e4" connected />);
    expect(screen.getByText('C')).toBeTruthy();
    expect(screen.getByText('e4')).toBeTruthy();
  });

  it('says the held set is not a square only once it has settled', () => {
    render(<ChordReadout heldNotes={[60, 61, 62]} chord={null} square={null} connected settling={false} />);
    expect(screen.getByText(/not a square/i)).toBeTruthy();
  });

  it('does not call a chord unrecognised while it is still settling', () => {
    // The cursor only names a square after the 140ms settle. Calling every valid
    // chord "not a square" for that window is the bug this component must not have.
    render(<ChordReadout heldNotes={[60, 64, 67]} chord={null} square={null} connected settling />);
    expect(screen.queryByText(/not a square/i)).toBeNull();
  });

  it('reports a disconnected piano rather than pretending to listen', () => {
    render(<ChordReadout heldNotes={[]} chord={null} square={null} connected={false} />);
    expect(screen.getByText(/not connected/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ChordReadout.test.jsx`
Expected: FAIL — cannot resolve `./ChordReadout.jsx`.

- [ ] **Step 3: Write the component**

Create `frontend/src/modules/Piano/PianoChessGame/ChordReadout.jsx`:

```javascript
/**
 * What the game heard.
 *
 * Without this, a board that does not respond is ambiguous three ways: the game
 * misheard the chord, heard a chord that is not a square, or heard the right
 * square and refused the move. This says which.
 */
export default function ChordReadout({
  heldNotes = [], chord = null, square = null, connected = true, settling = false,
}) {
  const held = heldNotes.length;
  let state = 'idle';
  if (!connected) state = 'offline';
  else if (chord && square) state = 'square';
  else if (held >= 3 && settling) state = 'settling';
  else if (held >= 3) state = 'unmapped';
  else if (held > 0) state = 'partial';

  return (
    <div className={`chess-readout chess-readout--${state}`} aria-live="polite">
      <span className="chess-readout__chord">{chord?.symbol ?? (held > 0 ? `${held} note${held === 1 ? '' : 's'}` : '—')}</span>
      <span className="chess-readout__says">
        {state === 'offline' && 'Piano not connected'}
        {state === 'idle' && 'Listening'}
        {state === 'partial' && 'Keep holding — a square is three notes'}
        {state === 'settling' && 'Reading…'}
        {state === 'unmapped' && 'Not a square on this board'}
        {state === 'square' && 'names'}
      </span>
      {state === 'square' && <span className="chess-readout__square">{square}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ChordReadout.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount it above the keyboard and style it**

In `PianoChessGame.jsx`, put the readout inside the keyboard footer, above the keys:

```jsx
<footer className="piano-chess__keys">
  <ChordReadout
    heldNotes={heldNotes}
    chord={cursorChord}
    square={cursor}
    connected={connected}
    settling={heldNotes.length >= 3 && !cursor}
  />
  <PianoKeyboard activeNotes={activeNotes} startNote={36} endNote={84} />
</footer>
```

Then delete the `piano-chess__midi` block from the left rail (`PianoChessGame.jsx:241-246`),
which this supersedes.

Add to `PianoChessGame.scss`:

```scss
/* The read-out rides above the keys, where the player's eyes already are when
   they are wondering why nothing happened. */
.chess-readout {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.6rem;
  padding-block-end: 0.35rem;
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  color: var(--pc-ivory-dim);
}

.chess-readout__chord,
.chess-readout__square {
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--pc-brass);
}

.chess-readout--unmapped .chess-readout__chord { color: var(--pc-felt); }
.chess-readout--offline { color: rgb(203 191 168 / 45%); }
```

- [ ] **Step 6: Run the chess suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "feat(chess): the keyboard strip says what the game heard"
```

---

### Task 6: Ghost preview on the target square

**Files:**
- Modify: `frontend/src/modules/Chess/ChessBoard.jsx` (accept a `ghost` prop and render it)
- Modify: `frontend/src/modules/Chess/ChessBoard.scss`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (pass `ghost`)
- Test: `frontend/src/modules/Chess/ChessBoard.test.jsx` (extend)

**Interfaces:**
- Consumes: the board's existing `fen`, `selected` and `cursorSquare` props.
- Produces: `ChessBoard` accepts `ghost={{ square: string, piece: string }|null}` and renders `.chess-board__piece--ghost` on that square.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Chess/ChessBoard.test.jsx`:

```javascript
describe('ghost preview', () => {
  it('renders a translucent piece on the previewed destination', () => {
    const { container } = render(
      <ChessBoard
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        ghost={{ square: 'e4', piece: 'wP' }}
      />,
    );
    const ghost = container.querySelector('.chess-board__piece--ghost');
    expect(ghost).not.toBeNull();
    expect(ghost.closest('[data-square]')?.dataset.square).toBe('e4');
  });

  it('renders no ghost when there is nothing to preview', () => {
    const { container } = render(
      <ChessBoard fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" ghost={null} />,
    );
    expect(container.querySelector('.chess-board__piece--ghost')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Chess/ChessBoard.test.jsx`
Expected: FAIL — no `.chess-board__piece--ghost` in the DOM.

- [ ] **Step 3: Render the ghost**

In `ChessBoard.jsx`, accept `ghost = null` in the props and, inside the square render, add the ghost image alongside the real piece. Reuse whatever the component already uses to resolve a piece to its asset — do not introduce a second lookup:

```jsx
{ghost?.square === square && (
  <img className="chess-board__piece chess-board__piece--ghost" src={pieceSource(ghost.piece)} alt="" aria-hidden="true" />
)}
```

The resolver is `pieceSource(code)` from `frontend/src/modules/Chess/pieceAssets.js:66` —
whatever the component already imports for real pieces. Do **not** gate the ghost on the
square being empty: a capture is exactly the preview a player most wants. Squares already
carry `data-square` (`ChessBoard.jsx:58`), so the test's locator works as written.

Add to `ChessBoard.scss`:

```scss
/* The move you are aiming at, before you let go. Committing on release should
   feel aimed rather than hoped-for. */
.chess-board__piece--ghost {
  opacity: 0.38;
  filter: none;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Chess/ChessBoard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Feed the ghost from the game**

In `PianoChessGame.jsx`, compute the preview from state that already exists — the selected origin and the live cursor square — and pass it to the board:

`position.mjs` exports `fenToPosition(fen)`, which returns square → piece **code**
(`{ e4: 'wP' }`, `position.mjs:57-79`) — exactly what the board's `pieceSource(code)`
resolver accepts. Use it; do not inline FEN parsing, and do not reach for `toPieceCode`
(the codes are already codes):

```javascript
import { fenToPosition } from '@shared-gaming/chess/position.mjs';
// ...
// Only while a piece is held and the cursor names a different square. Capture
// targets get a ghost too — most previews the player cares about are captures.
const heldPiece = game.origin ? fenToPosition(game.game.fen)?.[game.origin] : null;
const ghost = heldPiece && cursor && cursor !== game.origin
  ? { square: cursor, piece: heldPiece }
  : null;
```

- [ ] **Step 6: Run both suites**

Run: `npx vitest run frontend/src/modules/Chess/ frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Chess/ frontend/src/modules/Piano/PianoChessGame/
git commit -m "feat(chess): ghost preview on the square you are aiming at"
```

---

### Task 7: In-game settings panel

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.jsx`
- Test: `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (load config on mount, hold `rungId`, open the panel from the right rail)
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.scss`
- Modify: `docs/reference/piano/piano-games.md` (document the config pair and the ladder)

**Interfaces:**
- Consumes: `fetchChessConfig`, `saveChessConfig` from Task 4; the config shape from Task 2.
- Produces: `<ChessSettingsPanel config={} rungId={} onChange={(patch) => void} onClose={() => void} />`. `onChange` receives a sparse patch in config shape, e.g. `{ default_rung: 'steady' }` or `{ feedback: { hint_level: 'off' } }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`:

```javascript
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChessSettingsPanel from './ChessSettingsPanel.jsx';

const CONFIG = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
  feedback: { hint_level: 'after-mistake' },
};

describe('ChessSettingsPanel', () => {
  it('offers every rung from the config as a tap target', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    for (const label of ['First moves', 'Learner', 'Steady']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('marks the active rung', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="steady" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Steady' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('emits a sparse patch when a rung is chosen', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Steady' }));
    expect(onChange).toHaveBeenCalledWith({ default_rung: 'steady' });
  });

  it('emits a nested patch when the hint level changes', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /always/i }));
    expect(onChange).toHaveBeenCalledWith({ feedback: { hint_level: 'always' } });
  });

  it('uses no sliders — every control is a discrete tap target', () => {
    const { container } = render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`
Expected: FAIL — cannot resolve `./ChessSettingsPanel.jsx`.

- [ ] **Step 3: Write the panel**

Create `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.jsx`:

```javascript
/**
 * Settings, in the game, in the player's hands.
 *
 * Hint level is one three-way control over the two legality cues, because "how
 * much does the board show me" is one question to a player and two booleans to
 * the code. Refusal loudness (flash, toast) is a different question and stays
 * in YAML.
 */
const HINT_LEVELS = [
  { id: 'off', label: 'Off' },
  { id: 'after-mistake', label: 'After a mistake' },
  { id: 'always', label: 'Always' },
];

export default function ChessSettingsPanel({ config, rungId, onChange, onClose }) {
  const rungs = Array.isArray(config?.rungs) ? config.rungs : [];
  const hint = config?.feedback?.hint_level ?? 'after-mistake';

  return (
    <section className="chess-settings" aria-label="Chess settings">
      <header className="chess-settings__head">
        <h2 className="chess-settings__title">Settings</h2>
        <button type="button" className="chess-settings__close" onClick={onClose}>Done</button>
      </header>

      <h3 className="chess-settings__group">Opponent</h3>
      <div className="chess-settings__row">
        {rungs.map((rung) => (
          <button
            key={rung.id}
            type="button"
            className={`chess-settings__opt${rung.id === rungId ? ' is-active' : ''}`}
            aria-pressed={rung.id === rungId}
            onClick={() => onChange({ default_rung: rung.id })}
          >
            {rung.label}
          </button>
        ))}
      </div>

      <h3 className="chess-settings__group">Show legal moves</h3>
      <div className="chess-settings__row">
        {HINT_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            className={`chess-settings__opt${level.id === hint ? ' is-active' : ''}`}
            aria-pressed={level.id === hint}
            onClick={() => onChange({ feedback: { hint_level: level.id } })}
          >
            {level.label}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it into the game**

In `PianoChessGame.jsx`: load the config on mount, keep `rungId` in state seeded from `config.default_rung`, open the panel from a button in the right rail, and persist every patch to the user layer while applying it immediately.

```javascript
const [chessConfig, setChessConfig] = useState(null);
const [rungId, setRungId] = useState('learner');
const [settingsOpen, setSettingsOpen] = useState(false);
// Same derivation as Task 4 — string id, guests excluded. Define it once in the
// component and use it for both the move request and the config calls.
const userSlug = typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null;
const userId = isPersistentUser(userSlug) ? userSlug : null;

useEffect(() => {
  let cancelled = false;
  fetchChessConfig(userId).then((loaded) => {
    if (cancelled || !loaded) return;
    setChessConfig(loaded);
    setRungId(loaded.default_rung || 'learner');
  });
  return () => { cancelled = true; };
}, [userId]);

const applySetting = useCallback((patch) => {
  setChessConfig((prev) => ({ ...(prev || {}), ...patch, feedback: { ...(prev?.feedback || {}), ...(patch.feedback || {}) } }));
  if (patch.default_rung) setRungId(patch.default_rung);
  if (userId) saveChessConfig(userId, patch);
}, [userId]);
```

**Translate the config at the boundary.** The YAML is snake_case; the component's cue
flags are camelCase (`DEFAULT_FEEDBACK` at `PianoChessGame.jsx:34-39`). Nothing else in
the component may read snake_case keys, or the two spellings will drift:

```javascript
// chess.yml (snake_case, hint_level) -> the component's cue flags (camelCase).
const HINT_CUES = {
  off: { highlightSources: false, highlightTargets: false, gateOnMistake: false },
  'after-mistake': { highlightSources: true, highlightTargets: true, gateOnMistake: true },
  always: { highlightSources: true, highlightTargets: true, gateOnMistake: false },
};

export function cuesFromConfig(config) {
  const feedback = config?.feedback || {};
  const hint = HINT_CUES[feedback.hint_level] || HINT_CUES['after-mistake'];
  return {
    ...hint,
    flashRejected: feedback.flash_rejected !== false,
    toast: feedback.toast !== false,
  };
}
```

Put `cuesFromConfig` in `PianoChessGame/chessCues.js` with its own unit test covering all
three hint levels plus the default when `hint_level` is missing or unknown.

The gating condition from the shipped code becomes: show sources/targets when
`cues.highlightSources && (!cues.gateOnMistake || showLegality)`.

Derive `opponentDelayMs` from `chessConfig?.opponent_delay_ms ?? 700`, and
`shuffleEachTurn` from `chessConfig?.shuffle_each_turn` (falling back to the existing
`gameConfig` prop when the config has not loaded), so the panel's shuffle control is not
decorative.

The panel needs **four** controls, per the spec: rung, hint level, shuffle (on/off), and
opponent delay (discrete choices — 300 / 700 / 1200 ms — never a slider). Extend the
component and its test beyond the two shown above.

Also update the rail's difficulty label: it currently renders
`DIFFICULTIES[difficulty]?.label` from the homegrown ladder (`PianoChessGame.jsx:295`),
which will show stale or missing labels once rungs come from config. Render the active
rung's `label` instead, and drop the now-unused `DIFFICULTIES` import if nothing else
uses it.

Add panel styles to `PianoChessGame.scss` following the existing rail conventions
(discrete buttons, brass active state).

- [ ] **Step 6: Update the reference doc**

Add a section to `docs/reference/piano/piano-games.md` covering: the `chess.yml` ladder and what `skill` versus `elo` mean, the per-user override path, the hint levels, and the fact that the opponent is served by the backend with a local fallback.

- [ ] **Step 7: Run everything and commit**

Run: `npx vitest run frontend/src/modules/Piano/ frontend/src/modules/Chess/ backend/src/1_adapters/chess/ backend/src/3_applications/chess/ backend/src/4_api/v1/routers/chess.test.mjs`
Expected: PASS.

```bash
git add frontend/src/modules/Piano/PianoChessGame/ docs/reference/piano/piano-games.md
git commit -m "feat(chess): in-game settings panel writing the user config layer"
```

---

## Deployment

After Task 7, build and deploy per `CLAUDE.local.md`, and **check the deploy gate first** — never redeploy while a fitness session is active or a video is playing:

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear means zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. Then:

```bash
sudo docker build --no-cache -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date +"%Y-%m-%d %H:%M:%S %Z")" \
  --build-arg COMMIT_HASH="$(git rev-parse HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Verify the engine is really the wasm and not the fallback:

```bash
sudo docker logs --since 120s daylight-station 2>&1 | grep chess.engine
```
