import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';
import { legalMoves } from '../../../../shared/gaming/rulesets/chess/engine.mjs';
import { createStockfishEngine, engineOptionsForRung, fallbackDifficultyFor, isHomegrownRung } from './StockfishEngineAdapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOT_FAILING_WORKER = path.join(HERE, '__fixtures__', 'bootFailingWorker.mjs');

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

  it('does not pay the full timeout on a second search after the worker fails to boot', async () => {
    // The worker spawns fine (unlike the /nonexistent/worker.mjs case above) but
    // posts 'boot-failed' immediately, mirroring a real WASM load failure. The
    // fix under test: the adapter must terminate + null that dead handle, or
    // ensureWorker() hands it back to the next search, which posts into a port
    // nobody is listening on anymore and only gives up after
    // movetime_ms + timeoutMarginMs (1600ms here) — the exact per-move latency
    // tax the 'exit' handler already exists to avoid.
    const broken = createStockfishEngine({ workerPath: BOOT_FAILING_WORKER, logger: silentLogger });

    // MEASURED AGAINST A CONTROL, NOT A STOPWATCH (2026-08-26). This assertion
    // used to be `elapsedSecond < 800` — half the full timeout, in absolute
    // milliseconds. It passed alone and failed inside the gate, where ~1400
    // files share half the cores: a starved run measured 2121ms for a search
    // that never waited on the timer at all. Note that 2121 is LONGER than the
    // 1600ms timeout being guarded against, so no absolute threshold can tell
    // "paid the timer" apart from "was denied a CPU" — the number it needs is
    // not available in wall-clock terms.
    //
    // The FIRST search is the control. It runs on the same engine, the same
    // fixture and the same starved machine, and it also ends in `fallback` —
    // but it is the call that DETECTS the boot failure, so it is the one that
    // legitimately pays worker spawn. The second must not cost meaningfully
    // more than that, and "meaningfully" is denominated in the timeout itself
    // rather than in milliseconds. Contention inflates both measurements
    // together and cancels out; a returned regression adds the whole timer to
    // one side only.
    const startedFirst = Date.now();
    const first = await broken.chooseMove({ fen: START, rung, gameId: 'g6' });
    const elapsedFirst = Date.now() - startedFirst;
    expect(first.engine).toBe('fallback');

    const startedSecond = Date.now();
    const second = await broken.chooseMove({ fen: START, rung, gameId: 'g6' });
    const elapsedSecond = Date.now() - startedSecond;
    expect(second.engine).toBe('fallback');

    // `timeoutMarginMs` defaults to 1500 in the adapter, so a search that fell
    // through to the timer pays `movetime_ms + 1500`. Half of that is far more
    // than the spawn-free second call can legitimately differ by, and far less
    // than the timer would add.
    const fullTimeoutMs = rung.movetime_ms + 1500;
    expect(elapsedSecond).toBeLessThan(elapsedFirst + (fullTimeoutMs / 2));

    broken.dispose();
  });
});

describe('engineOptionsForRung', () => {
  it('treats a null elo as absent rather than as elo 0 clamped to the floor', () => {
    // Number(null) === 0, which is finite — so without an explicit null/undefined
    // check, a YAML rung with an empty `elo:` key (parsed as null) would be read
    // as elo-mode and clamped to the 1320 floor instead of falling through to
    // skill mode.
    const options = engineOptionsForRung({ id: 'x', elo: null, skill: 5, movetime_ms: 100 }, silentLogger);
    expect(options).toEqual({ movetimeMs: 100, skill: 5 });
  });

  it('treats a null skill as absent and falls back to the default skill', () => {
    const options = engineOptionsForRung({ id: 'x', skill: null, movetime_ms: 100 }, silentLogger);
    expect(options).toEqual({ movetimeMs: 100, skill: 3 });
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

describe('isHomegrownRung', () => {
  it('routes only rungs that ask for the teaching opponent', () => {
    expect(isHomegrownRung({ engine: 'homegrown', depth: 1 })).toBe(true);
    expect(isHomegrownRung({ engine: 'stockfish', skill: 8 })).toBe(false);
    // An old rung with no `engine` predates the split and means Stockfish.
    expect(isHomegrownRung({ skill: 3, movetime_ms: 200 })).toBe(false);
    expect(isHomegrownRung(null)).toBe(false);
  });
});

describe('the homegrown tier', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('answers a homegrown rung without ever starting a Stockfish worker', async () => {
    // Pointed at a worker path that cannot exist: if the adapter reached for
    // Stockfish at all, this would fall back or fail rather than answer.
    const engine = createStockfishEngine({ workerPath: '/nonexistent/worker.mjs' });
    const move = await engine.chooseMove({
      fen: START,
      rung: { id: 'level-0', engine: 'homegrown', depth: 1, blunder_rate: 0 },
      gameId: 'g1',
    });
    expect(move).toBeTruthy();
    expect(move.engine).toBe('homegrown');
    expect(legalMoves(START).map((m) => m.san)).toContain(move.san);
    engine.dispose();
  });

  it('is deterministic, so a rung plays the same way twice', async () => {
    const engine = createStockfishEngine({ workerPath: '/nonexistent/worker.mjs' });
    const rung = { id: 'level-2', engine: 'homegrown', depth: 1, blunder_rate: 0.2 };
    const first = await engine.chooseMove({ fen: START, rung, gameId: 'a' });
    const second = await engine.chooseMove({ fen: START, rung, gameId: 'b' });
    expect(first.san).toBe(second.san);
    engine.dispose();
  });

  it('returns null in a finished position rather than inventing a move', async () => {
    const mated = '3r1rk1/2p5/6p1/p1p3Kq/4P3/2P2b2/PP6/RNR5 w - - 2 26';
    const engine = createStockfishEngine({ workerPath: '/nonexistent/worker.mjs' });
    const move = await engine.chooseMove({
      fen: mated,
      rung: { engine: 'homegrown', depth: 1, blunder_rate: 0 },
      gameId: 'g1',
    });
    expect(move).toBeNull();
    engine.dispose();
  });
});
