import { describe, expect, it, vi } from 'vitest';
import { INITIAL_FEN } from '../shared/gaming/chess/engine.mjs';
import { parseArgs, renderBoard, playTurn } from './chess.cli.mjs';

describe('parseArgs', () => {
  it('defaults to the local dev backend and the learner rung', () => {
    const opts = parseArgs([]);
    expect(opts.rung).toBe('learner');
    expect(opts.host).toContain('http');
    expect(opts.color).toBe('w');
  });

  it('reads host, rung, user and colour', () => {
    const opts = parseArgs(['--host', 'http://x:1', '--rung', 'sharp', '--user', 'kckern', '--color', 'b']);
    expect(opts).toMatchObject({ host: 'http://x:1', rung: 'sharp', user: 'kckern', color: 'b' });
  });

  it('rejects a flag with no value rather than silently taking the next flag', () => {
    expect(() => parseArgs(['--rung', '--json'])).toThrow();
  });
});

describe('renderBoard', () => {
  it('draws eight ranks with file labels and the pieces in their squares', () => {
    const out = renderBoard(INITIAL_FEN, { orientation: 'w' });
    const lines = out.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(9); // 8 ranks + a file label row
    expect(out).toContain('a');
    expect(out).toContain('8');
  });

  it('flips the board for black', () => {
    const white = renderBoard(INITIAL_FEN, { orientation: 'w' }).trim().split('\n')[0];
    const black = renderBoard(INITIAL_FEN, { orientation: 'b' }).trim().split('\n')[0];
    expect(white).not.toBe(black);
  });
});

describe('playTurn', () => {
  const deps = () => ({
    requestMove: vi.fn(async () => ({ from: 'e7', to: 'e5', san: 'e5', engine: 'stockfish', thinkingMs: 42 })),
  });

  it('plays a legal SAN move and then the engine reply', async () => {
    const d = deps();
    const result = await playTurn({ fen: INITIAL_FEN, rung: 'learner' }, 'e4', d);
    expect(result.accepted).toBe(true);
    expect(result.playerSan).toBe('e4');
    expect(result.reply).toMatchObject({ san: 'e5', engine: 'stockfish' });
    expect(result.fen).not.toBe(INITIAL_FEN);
    expect(d.requestMove).toHaveBeenCalledOnce();
  });

  it('accepts coordinate notation as well as SAN', async () => {
    const result = await playTurn({ fen: INITIAL_FEN, rung: 'learner' }, 'g1f3', deps());
    expect(result.accepted).toBe(true);
    expect(result.playerSan).toBe('Nf3');
  });

  it('rejects an illegal move without advancing the position or calling the server', async () => {
    const d = deps();
    const result = await playTurn({ fen: INITIAL_FEN, rung: 'learner' }, 'e5', d);
    expect(result.accepted).toBe(false);
    expect(result.fen).toBe(INITIAL_FEN);
    expect(d.requestMove).not.toHaveBeenCalled();
  });

  it('surfaces a fallback reply rather than hiding it', async () => {
    const d = { requestMove: vi.fn(async () => ({ from: 'e7', to: 'e5', san: 'e5', engine: 'fallback', thinkingMs: 3 })) };
    const result = await playTurn({ fen: INITIAL_FEN, rung: 'learner' }, 'e4', d);
    expect(result.reply.engine).toBe('fallback');
  });

  it('ends the game instead of asking the server for a move when the player mates', async () => {
    // Fool's mate: after 1.f3 e5 2.g4, Qh4# ends it.
    const d = deps();
    const mateIn1 = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const result = await playTurn({ fen: mateIn1, rung: 'learner' }, 'Qh4#', d);
    expect(result.accepted).toBe(true);
    expect(result.gameOver).toBe(true);
    expect(d.requestMove).not.toHaveBeenCalled();
  });
});
