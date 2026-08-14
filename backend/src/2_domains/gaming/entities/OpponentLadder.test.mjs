import test from 'node:test';
import assert from 'node:assert/strict';
import { OpponentLadder } from './OpponentLadder.mjs';

const opponents = Array.from({ length: 7 }, (_, index) => ({ id: `level-${index + 1}`, name: `Level ${index + 1}` }));

test('clamps requested opponents to the unlocked rung', () => {
  const ladder = new OpponentLadder({ opponents, progress: { unlockedThrough: 2 } });
  assert.equal(ladder.resolve(7).level, 2);
});

test('promotes after three wins in a five-game series', () => {
  let ladder = new OpponentLadder({ opponents });
  ladder = ladder.record('win', 1).record('loss', 1).record('win', 1).record('draw', 1).record('win', 1);
  assert.equal(ladder.unlockedThrough, 2);
  assert.deepEqual(ladder.series, []);
});

test('does not promote wins recorded against a lower rung', () => {
  let ladder = new OpponentLadder({ opponents, progress: { unlockedThrough: 3 } });
  ladder = ladder.record('win', 1).record('win', 1).record('win', 1);
  assert.equal(ladder.unlockedThrough, 3);
});
