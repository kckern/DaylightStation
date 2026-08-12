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
