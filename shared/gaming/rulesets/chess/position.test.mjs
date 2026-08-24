import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INITIAL_FEN, applyMove } from './engine.mjs';
import {
  SQUARES, countMaterial, diffPositions, fenToPosition, orderedSquares,
  positionToFen, squareColor, squareDistance,
} from './position.mjs';

const positionAfter = (fen, ...moves) => fenToPosition(moves.reduce((current, move) => applyMove(current, move).fen, fen));

describe('chess position projection', () => {
  it('covers the board once, a8 first', () => {
    assert.equal(SQUARES.length, 64);
    assert.equal(new Set(SQUARES).size, 64);
    assert.equal(SQUARES[0], 'a8');
    assert.equal(SQUARES.at(-1), 'h1');
    assert.deepEqual(orderedSquares('black'), [...SQUARES].reverse());
  });

  it('parses a FEN into a flat piece map', () => {
    const position = fenToPosition(INITIAL_FEN);
    assert.equal(Object.keys(position).length, 32);
    assert.equal(position.e1, 'wK');
    assert.equal(position.d8, 'bQ');
    assert.equal(position.e4, undefined);
  });

  it('round-trips a position back to a placement field', () => {
    assert.equal(positionToFen(fenToPosition(INITIAL_FEN)), INITIAL_FEN.split(' ')[0]);
    const after = applyMove(INITIAL_FEN, 'e4').fen;
    assert.equal(positionToFen(fenToPosition(after)), after.split(' ')[0]);
  });

  it('rejects malformed input rather than guessing', () => {
    for (const bad of ['', 'rnbq/8', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w - - 0 1', null]) {
      assert.equal(fenToPosition(bad), null);
    }
    assert.equal(positionToFen({ e4: 'xx' }), null);
    assert.equal(positionToFen(null), null);
  });

  it('names square colours and distances', () => {
    assert.equal(squareColor('a1'), 'dark');
    assert.equal(squareColor('h1'), 'light');
    assert.equal(squareColor('zz'), null);
    assert.equal(squareDistance('e2', 'e4'), 2);
    assert.equal(squareDistance('a1', 'h8'), 7);
  });

  it('diffs a quiet move into a single move operation', () => {
    const before = fenToPosition(INITIAL_FEN);
    const after = positionAfter(INITIAL_FEN, 'e4');
    assert.deepEqual(diffPositions(before, after), [{ type: 'move', piece: 'wP', from: 'e2', to: 'e4' }]);
  });

  it('diffs a capture into a move plus a clear', () => {
    const start = applyMove(applyMove(INITIAL_FEN, 'e4').fen, 'd5').fen;
    const operations = diffPositions(fenToPosition(start), positionAfter(start, 'exd5'));
    assert.deepEqual(operations, [
      { type: 'move', piece: 'wP', from: 'e4', to: 'd5' },
      { type: 'clear', piece: 'bP', from: 'd5' },
    ]);
  });

  it('diffs castling into two simultaneous moves', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const operations = diffPositions(fenToPosition(fen), positionAfter(fen, { from: 'e1', to: 'g1' }));
    assert.deepEqual(operations.sort((a, b) => a.from.localeCompare(b.from)), [
      { type: 'move', piece: 'wK', from: 'e1', to: 'g1' },
      { type: 'move', piece: 'wR', from: 'h1', to: 'f1' },
    ]);
  });

  it('diffs a promotion into a clear plus an add', () => {
    const fen = '8/P6k/8/8/8/8/8/7K w - - 0 1';
    const operations = diffPositions(fenToPosition(fen), positionAfter(fen, { from: 'a7', to: 'a8', promotion: 'q' }));
    assert.deepEqual(operations, [
      { type: 'add', piece: 'wQ', to: 'a8' },
      { type: 'clear', piece: 'wP', from: 'a7' },
    ]);
  });

  it('is deterministic and empty for identical positions', () => {
    assert.deepEqual(diffPositions(fenToPosition(INITIAL_FEN), fenToPosition(INITIAL_FEN)), []);
    const before = fenToPosition(INITIAL_FEN);
    const after = positionAfter(INITIAL_FEN, 'Nf3');
    assert.deepEqual(diffPositions(before, after), diffPositions(before, after));
  });

  it('counts material', () => {
    const counts = countMaterial(fenToPosition(INITIAL_FEN));
    assert.equal(counts.wP, 8);
    assert.equal(counts.bK, 1);
    assert.equal(counts.wQ, 1);
  });
});
