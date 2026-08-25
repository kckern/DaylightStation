import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, applySequence, createCube, inverseMove, isSolved, normalizeMove, scramble } from './engine.mjs';

test('a turn followed by its inverse restores the cube', () => {
  for (const move of ['U', 'R', 'F', 'D', 'L', 'B', "R'", 'F2']) {
    assert.deepEqual(applyMove(applyMove(createCube(), move), inverseMove(move)), createCube());
  }
});

test('four quarter turns restore the cube', () => {
  for (const move of ['U', 'R', 'F', 'D', 'L', 'B']) assert.deepEqual(applySequence(createCube(), [move, move, move, move]), createCube());
});

test('a deterministic scramble is reproducible and not solved', () => {
  assert.deepEqual(scramble(42), scramble(42));
  assert.equal(isSolved(applySequence(createCube(), scramble(42))), false);
});

test('a scramble never repeats or immediately reverses a face', () => {
  const opposite = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
  const moves = scramble(77, 60).map((move) => move[0]);
  for (let index = 1; index < moves.length; index += 1) {
    assert.notEqual(moves[index], moves[index - 1]);
    assert.notEqual(moves[index], opposite[moves[index - 1]]);
  }
});

test('wide, slice, and whole-cube notation has legal inverses', () => {
  for (const move of ['r', 'Rw', 'M', 'E', 'S', 'x', 'y', 'z']) {
    const normalized = normalizeMove(move);
    assert.ok(normalized);
    assert.ok(isSolved(applySequence(createCube(), [normalized, inverseMove(normalized)])), move);
  }
});
