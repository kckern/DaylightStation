import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INITIAL_FEN, applyMove, describePosition, legalMoves } from './engine.mjs';
import { DIFFICULTIES, chooseMove, evaluatePosition, playOpponentMove } from './opponent.mjs';

describe('chess opponent', () => {
  it('answers with a legal move', () => {
    const reply = chooseMove(INITIAL_FEN);
    const legal = legalMoves(INITIAL_FEN).map((move) => move.san);
    assert.ok(legal.includes(reply.san), `${reply.san} is not legal`);
  });

  it('is deterministic for a position and seed', () => {
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      const first = chooseMove(INITIAL_FEN, { difficulty });
      const second = chooseMove(INITIAL_FEN, { difficulty });
      assert.equal(first.san, second.san, `${difficulty} must not drift`);
    }
  });

  it('counts material from the asked side', () => {
    assert.equal(evaluatePosition(INITIAL_FEN, 'w'), 0, 'the opening is level');
    // White is a queen up.
    const fen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    assert.equal(evaluatePosition(fen, 'w'), 900);
    assert.equal(evaluatePosition(fen, 'b'), -900);
  });

  it('takes free material', () => {
    // Black queen on d4 is hanging to the pawn on e3.
    const fen = '4k3/8/8/8/3q4/4P3/8/4K3 w - - 0 1';
    assert.equal(chooseMove(fen, { difficulty: 'steady' }).san, 'exd4');
  });

  it('finds mate in one', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1';
    const reply = chooseMove(fen, { difficulty: 'steady' });
    assert.equal(describePosition(applyMove(fen, reply.san).fen).outcome, 'checkmate');
  });

  it('returns null when the side to move has no reply', () => {
    const checkmated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    assert.equal(chooseMove(checkmated), null);
    assert.equal(playOpponentMove(checkmated).move, null);
  });

  it('advances the position through the convenience wrapper', () => {
    const result = playOpponentMove(INITIAL_FEN);
    assert.equal(result.error, null);
    assert.notEqual(result.fen, INITIAL_FEN);
    assert.equal(describePosition(result.fen).turn, 'b');
  });
});
