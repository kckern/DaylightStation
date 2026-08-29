import { describe, expect, it } from 'vitest';
import { createGame, playMove } from './chess/engine.mjs';
import { chessCommentary, chessNotableFacts } from './chess/dialogueAdapter.mjs';
import { checkersCommentary, checkersNotableFacts } from './checkers/commentary.mjs';
import { legalMoves, replayGame as replayCheckers } from './checkers/engine.mjs';
import { connectFourCommentary, connectFourNotableFacts } from './connect-four/commentary.mjs';

describe('board-game commentary adapters', () => {
  it('replays Chess and rejects a forged terminal state', () => {
    const game = playMove(playMove(createGame(), 'e4').game, 'e5').game;
    expect(chessCommentary(game, { sessionId: 'g', ply: 2, playerSide: 'w' })).toMatchObject({
      event: { actor: 'opponent' }, eventId: 'g:2:chess-turn',
    });
    expect(chessCommentary({ ...game, fen: 'forged' }, { sessionId: 'g', ply: 2, playerSide: 'w' })).toBeNull();
    expect(chessNotableFacts({ outcome: 'checkmate', moves: [{ san: 'Qh5#' }] })).toContain('checkmate');
  });

  it('replays Checkers moves and rejects a forged square', () => {
    const initial = replayCheckers({ moves: [] });
    const first = legalMoves(initial.board, initial.turn, initial.forcedFrom)[0];
    expect(checkersCommentary({ moves: [first] }, { sessionId: 'g', ply: 1, playerSide: 2 })).toBeTruthy();
    expect(checkersCommentary({ moves: [{ from: 99, to: 2 }] }, { sessionId: 'g', ply: 1 })).toBeNull();
    expect(checkersNotableFacts({ moves: [first] })).toEqual(['1 capture']);
  });

  it('replays Connect Four without exposing its submitted column', () => {
    const facts = connectFourCommentary({ moves: [3, 2] }, { sessionId: 'g', ply: 2, playerSide: 1 });
    expect(facts).toMatchObject({ event: { actor: 'opponent' }, eventId: 'g:2:connect-four-turn' });
    expect(JSON.stringify(facts.event)).not.toContain('3');
    expect(connectFourCommentary({ moves: [8] }, { sessionId: 'g', ply: 1 })).toBeNull();
    expect(connectFourNotableFacts({ moves: [0, 1, 0, 1, 0, 1, 0] })).toEqual(['four-in-a-row']);
  });
});
