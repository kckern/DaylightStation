import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INITIAL_FEN, applyMove, attackersOf, createGame, describeGame, describePosition,
  gameFromPgn, gameToPgn, isPromotion, isValidFen, legalDestinations, legalMoves, playMove, undoMove,
} from './engine.mjs';

describe('chess engine', () => {
  it('opens with twenty legal moves and advances the FEN', () => {
    assert.equal(legalMoves(INITIAL_FEN).length, 20);
    const result = applyMove(INITIAL_FEN, 'e4');
    assert.equal(result.error, null);
    assert.equal(result.move.san, 'e4');
    assert.match(result.fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3/);
  });

  it('accepts coordinate moves as well as SAN', () => {
    assert.equal(applyMove(INITIAL_FEN, { from: 'g1', to: 'f3' }).move.san, 'Nf3');
  });

  it('reports illegal input as an error instead of throwing', () => {
    for (const bad of ['e9', { from: 'e2', to: 'e5' }, null, 42]) {
      const result = applyMove(INITIAL_FEN, bad);
      assert.ok(result.error, `expected an error for ${JSON.stringify(bad)}`);
      assert.equal(result.move, null);
      assert.equal(result.fen, INITIAL_FEN, 'a rejected move must not advance the position');
    }
    assert.equal(applyMove('not-a-fen', 'e4').error.code, 'invalid_fen');
    assert.equal(isValidFen('not-a-fen'), false);
  });

  it('detects checkmate and names the winner', () => {
    let game = createGame();
    for (const san of ['f3', 'e5', 'g4', 'Qh4#']) game = playMove(game, san).game;
    const status = describeGame(game);
    assert.equal(status.game_over, true);
    assert.equal(status.outcome, 'checkmate');
    assert.equal(status.winner, 'b');
    assert.equal(status.result, '0-1');
  });

  it('detects stalemate as a draw with no winner', () => {
    const status = describePosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(status.outcome, 'stalemate');
    assert.equal(status.winner, null);
    assert.equal(status.result, '1/2-1/2');
  });

  it('sees threefold repetition only when history is present', () => {
    let game = createGame();
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game = playMove(game, san).game;
    assert.equal(describeGame(game).outcome, 'threefold_repetition');
    // The same position judged without its history cannot know, and says so.
    const positionOnly = describePosition(game.fen);
    assert.equal(positionOnly.outcome, null);
    assert.equal(positionOnly.repetition_checked, false);
  });

  it('flags promotions and requires the promotion piece', () => {
    const fen = '8/P6k/8/8/8/8/8/7K w - - 0 1';
    assert.equal(isPromotion(fen, 'a7', 'a8'), true);
    assert.equal(isPromotion(INITIAL_FEN, 'e2', 'e4'), false);
    assert.equal(applyMove(fen, { from: 'a7', to: 'a8', promotion: 'q' }).move.promotion, 'q');
  });

  it('handles castling as a single move', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const result = applyMove(fen, { from: 'e1', to: 'g1' });
    assert.equal(result.move.san, 'O-O');
    assert.match(result.fen, /^r3k2r\/8\/8\/8\/8\/8\/8\/R4RK1/);
  });

  it('groups legal destinations by origin square', () => {
    assert.deepEqual(legalDestinations(INITIAL_FEN, 'e2'), { e2: ['e3', 'e4'] });
    assert.equal(Object.keys(legalDestinations(INITIAL_FEN)).length, 10);
  });

  it('replays, undoes and round-trips through PGN', () => {
    let game = createGame();
    for (const san of ['e4', 'e5', 'Nf3']) game = playMove(game, san).game;
    assert.deepEqual(game.moves, ['e4', 'e5', 'Nf3']);

    const undone = undoMove(game);
    assert.deepEqual(undone.moves, ['e4', 'e5']);
    assert.equal(undone.fen, applyMove(applyMove(INITIAL_FEN, 'e4').fen, 'e5').fen);
    assert.deepEqual(undoMove(createGame()).moves, [], 'undo on a fresh game is a no-op');

    const restored = gameFromPgn(gameToPgn(game, { Event: 'Ruleset round trip' }));
    assert.deepEqual(restored.moves, game.moves);
    assert.equal(restored.fen, game.fen);
  });

  it('lists attackers for threat overlays', () => {
    // Attack, not reach: the e2 pawn can move to e4 but only guards d3 and f3.
    assert.deepEqual(attackersOf(INITIAL_FEN, 'f3', 'w').sort(), ['e2', 'g1', 'g2']);
    assert.deepEqual(attackersOf(INITIAL_FEN, 'e4', 'w'), []);
    assert.deepEqual(attackersOf('bogus', 'e4', 'w'), []);
  });

  it('rejects a game record whose history does not replay', () => {
    assert.equal(describeGame({ initial_fen: INITIAL_FEN, fen: INITIAL_FEN, moves: ['e9'] }), null);
    assert.equal(playMove({ initial_fen: 'bogus', fen: 'bogus', moves: [] }, 'e4').error.code, 'invalid_game');
  });
});
