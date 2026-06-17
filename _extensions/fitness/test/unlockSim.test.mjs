import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSimCandidate } from '../src/unlockSim.mjs';

const CANDIDATES = [
  { uuid: 'hw-0001', username: 'test-user-a' },
  { uuid: 'sim-test-0001', username: 'test-user-b' },
  { uuid: 'hw-0002', username: 'test-user-c' }
];

test('requestedUuid present in candidates → returns that candidate', () => {
  const chosen = selectSimCandidate(CANDIDATES, 'hw-0002');
  assert.deepEqual(chosen, { uuid: 'hw-0002', username: 'test-user-c' });
});

test('requestedUuid absent → returns the sim- candidate when one exists', () => {
  const chosen = selectSimCandidate(CANDIDATES, 'does-not-exist');
  assert.deepEqual(chosen, { uuid: 'sim-test-0001', username: 'test-user-b' });
});

test('no requestedUuid → returns the sim- candidate when one exists', () => {
  const chosen = selectSimCandidate(CANDIDATES);
  assert.deepEqual(chosen, { uuid: 'sim-test-0001', username: 'test-user-b' });
});

test('no sim- candidate → returns the first', () => {
  const noSim = [
    { uuid: 'hw-0001', username: 'test-user-a' },
    { uuid: 'hw-0002', username: 'test-user-c' }
  ];
  const chosen = selectSimCandidate(noSim);
  assert.deepEqual(chosen, { uuid: 'hw-0001', username: 'test-user-a' });
});

test('empty candidates → null', () => {
  assert.equal(selectSimCandidate([]), null);
});

test('null candidates → null', () => {
  assert.equal(selectSimCandidate(null), null);
  assert.equal(selectSimCandidate(undefined), null);
});
