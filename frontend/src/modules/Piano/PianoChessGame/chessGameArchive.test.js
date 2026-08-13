import { describe, expect, it } from 'vitest';
import { INITIAL_FEN, createGame, playMove } from '@shared-gaming/chess/engine.mjs';
import { buildGameArchive, localDateStamp } from './chessGameArchive.js';
import { createChessGameState, commitMove } from './chessGameState.js';
import { DEFAULT_STAFF_SCHEME } from './staffAddress.js';

/** A real game state carried forward by real moves — never a hand-built fake. */
function played(moves, options = {}) {
  let state = createChessGameState({ seed: 1, shuffleEachTurn: false, ...options });
  for (const [from, to] of moves) state = commitMove(state, from, to).state;
  return state;
}

const inputs = (game, extra = {}) => ({
  game,
  gameId: 'g-1',
  userId: 'milo',
  rungId: 'learner',
  hints: 1,
  bestMoves: 0,
  startedAt: Date.UTC(2026, 7, 12, 17, 0, 0),
  endedAt: Date.UTC(2026, 7, 12, 17, 9, 30),
  ...extra,
});

describe('the household game archive', () => {
  it('records an unfinished game, which is the case it exists for', () => {
    const game = played([['e2', 'e4'], ['e7', 'e5']]);
    const archive = buildGameArchive(inputs(game, { endedBy: 'left' }));
    expect(archive.completed).toBe(false);
    expect(archive.ended_by).toBe('left');
    expect(archive.result).toBe(null);
    expect(archive.move_count).toBe(2);
  });

  it('is replayable: the start position plus every move in both notations', () => {
    const game = played([['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]);
    const archive = buildGameArchive(inputs(game));
    expect(archive.initial_fen).toBe(INITIAL_FEN);
    expect(archive.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(archive.moves.map((m) => [m.from, m.to])).toEqual([['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]);
    // Actually replay it, the way the engine will: start from the recorded
    // position, play the recorded moves, and land on the recorded end position.
    // This is the whole promise of the archive, so it is asserted by doing it.
    let replay = createGame({ fen: archive.initial_fen });
    for (const move of archive.moves) {
      const step = playMove(replay, { from: move.from, to: move.to });
      expect(step.error, `move ${move.ply} ${move.san} did not replay`).toBeFalsy();
      expect(step.move.san).toBe(move.san);
      replay = step.game;
    }
    expect(replay.fen).toBe(archive.final_fen);
    expect(archive.final_fen).not.toBe(archive.initial_fen);
  });

  it('keeps the music, which no PGN can hold', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game));
    // The two addresses that performed the move, origin then destination.
    expect(archive.moves[0].played).toEqual(['Em', 'Eadd9']);
    expect(archive.addressing).toBe('chords');
  });

  it('says which vocabulary the addresses are in, or they cannot be read back', () => {
    const game = played([['e2', 'e4']], { scheme: DEFAULT_STAFF_SCHEME });
    const archive = buildGameArchive(inputs(game, { addressing: 'staff' }));
    expect(archive.addressing).toBe('staff');
    // Two staff notes, not a chord — 'G/E' means something entirely different
    // from 'Em', and only the vocabulary field tells them apart.
    expect(archive.moves[0].played[0]).toMatch(/\//);
  });

  it('records a finished game as won, lost or drawn', () => {
    // Fool's mate: Black delivers it, so a White player has lost.
    const game = played([['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]);
    expect(game.status.game_over).toBe(true);
    const archive = buildGameArchive(inputs(game, { endedBy: 'game_over' }));
    expect(archive.completed).toBe(true);
    expect(archive.outcome).toBe('checkmate');
    expect(archive.result).toBe('loss');
  });

  it('files the game under the day it was played, in local time', () => {
    const game = played([['e2', 'e4']]);
    const startedAt = new Date(2026, 7, 12, 22, 30).getTime();
    expect(buildGameArchive(inputs(game, { startedAt })).played_on).toBe('2026-08-12');
    expect(localDateStamp(new Date(2026, 0, 3, 9, 0).getTime())).toBe('2026-01-03');
  });

  it('is not written for a game nobody played', () => {
    expect(buildGameArchive(inputs(played([])))).toBe(null);
  });

  it('carries the help tally, so a game won on hints is not read as one that was not', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game, { hints: 3, bestMoves: 2 }));
    expect(archive.help).toEqual({ hints: 3, best_moves: 2 });
  });

  it('keeps a guest game, with a null player rather than no record', () => {
    const game = played([['e2', 'e4']]);
    expect(buildGameArchive(inputs(game, { userId: null })).user_id).toBe(null);
  });
});
