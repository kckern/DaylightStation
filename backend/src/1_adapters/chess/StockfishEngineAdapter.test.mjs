import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';
import { legalMoves } from '../../../../shared/gaming/chess/engine.mjs';
import { createStockfishEngine, engineOptionsForRung, fallbackDifficultyFor } from './StockfishEngineAdapter.mjs';

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
    const first = await broken.chooseMove({ fen: START, rung, gameId: 'g6' });
    expect(first.engine).toBe('fallback');

    const startedSecond = Date.now();
    const second = await broken.chooseMove({ fen: START, rung, gameId: 'g6' });
    const elapsedSecond = Date.now() - startedSecond;
    expect(second.engine).toBe('fallback');
    // Generous relative to the ~1600ms full timeout this would otherwise pay,
    // while leaving headroom for CI jitter around the boot-failed round trip.
    expect(elapsedSecond).toBeLessThan(800);

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
